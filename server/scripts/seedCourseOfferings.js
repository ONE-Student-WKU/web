const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fs = require('fs');
const pool = require('../db');
const { CATEGORY_MAP } = require('../services/categoryMap');

/**
 * server/scripts/seedCourseOfferings.js
 * db/curriculum/_source/전공시간표_2017-2026.json(원광대 공개 전공시간표 조회 스크래핑 원본,
 * 2026-08-15 확보)을 course_offerings/course_offering_schedules로 구조화해서 저장한다.
 *
 * 기존 courses.json(현재 학기 단일 스냅샷) 카탈로그를 대체 — course_id가 이제 "특정 학기에
 * 실제 개설된 분반"을 가리키게 되어, 카탈로그 검색을 과거 학기(2017-1~)까지 확장할 수 있다.
 *
 * 재시딩 시 idempotent하게 만들기 위해, 대상 (department_id, year, semester) 조합의 기존
 * 행을 지우고 다시 넣는다 — seedCurriculum.js와 동일한 패턴.
 */

const RAW_SOURCE = path.resolve(__dirname, '..', '..', 'db', 'curriculum', '_source', '전공시간표_2017-2026.json');
// 전 학과 2026-2학기 시간표(사람이 공개 조회 화면을 직접 조회해 PDF로 저장한 것을 정리, 2026-10-13).
// 학과·전공(트랙)이 항목마다 명시돼 있다. 같은 학과·학기가 RAW_SOURCE에도 있으면(컴소공·공학3계열 2026-2) 이쪽이 더 최신이라 이쪽을 쓴다.
const ALL_DEPARTMENTS_SOURCE = path.resolve(__dirname, '..', '..', 'db', 'curriculum', '_source', '전공시간표_2026-2_전학과.json');
const LEGACY_CATALOG = path.resolve(__dirname, '..', '..', 'db', 'seed', 'courses.json');

// 원문 "구분" 코드 → student_courses.category 매핑은 services/categoryMap.js로 공유
// (server/services/pdfImportService.js도 동일 테이블을 씀).

const DEPARTMENT_NAME_BY_KEY_PREFIX = {
  '컴퓨터·소프트웨어공학과': '컴퓨터·소프트웨어공학과',
  공학3계열: '공학3계열',
};

// 공학3계열 3·4학년부터는 트랙별로 학수번호 체계가 갈린다(M09/M10=컴퓨터·소프트웨어공학전공,
// M11=게임콘텐츠학전공 — 공학3계열_게임콘텐츠학전공_2026.md의 "M11019 캡스톤디자인1" 확인).
// 1·2학년 계열공통 과목(L00xxx 등)은 트랙이 없어 NULL.
function inferTrackName(courseCode) {
  if (!courseCode) return null;
  if (/^M11/.test(courseCode)) return '게임콘텐츠학전공';
  if (/^M09|^M10/.test(courseCode)) return '컴퓨터·소프트웨어공학전공';
  return null;
}

// "월34화56" -> [{day:'월',period:3},{day:'월',period:4},{day:'화',period:5},{day:'화',period:6}]
// 10교시부터는 학교 시간표 표기가 "10" 다음에 끝자리만 찍힌다: "910" = 9·10, "9101" = 9·10·11, "1012" = 10·11·12
// (2026-2 전 학과 시간표에서 "9101"은 28건 모두 3학점, "1012"는 4건 모두 3학점, "910"은 12건 모두 2학점 — 교시 수 = 학점).
// 예전처럼 한 글자씩 읽으면 "9101"이 9·1·0·1교시가 되어 1교시가 두 번 나온다.
// 토·일은 앱 시간표(월~금)에 칸이 없어 나누지 않는다(원문 time_raw에는 남는다).
function parseTimeRaw(timeRaw) {
  if (!timeRaw) return [];
  const result = [];
  const re = /([월화수목금])(\d+)/g;
  let m;
  while ((m = re.exec(timeRaw))) {
    const [, day, digits] = m;
    let reachedTen = false;
    for (let i = 0; i < digits.length; i++) {
      if (digits[i] === '1' && digits[i + 1] === '0') {
        result.push({ day, period: 10 });
        reachedTen = true;
        i++;
      } else {
        result.push({ day, period: reachedTen ? 10 + Number(digits[i]) : Number(digits[i]) });
      }
    }
  }
  return result;
}

function toIntOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function toDecimalOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function findDepartmentId(name) {
  const [rows] = await pool.query('SELECT id FROM departments WHERE name = ?', [name]);
  return rows[0]?.id || null;
}

async function findTrackId(departmentId, name) {
  if (!name) return null;
  const [rows] = await pool.query('SELECT id FROM tracks WHERE department_id = ? AND name = ?', [departmentId, name]);
  return rows[0]?.id || null;
}

// 2026-09 계절학기 지원 도입으로 course_offerings.semester 체계가 학사력 시간순
// (1=1학기, 2=여름 계절학기, 3=2학기, 4=겨울 계절학기)으로 바뀌었다(db/migrate.js의
// ensureSeasonSemesterRenumbering 참고). 원본 스크래핑 소스(전공시간표_2017-2026.json)의
// 파일명 키는 옛 체계(1,2)로 박혀 있고 계절학기 데이터 자체가 없어 이 스크립트가 계절학기를
// 직접 다룰 일은 없지만, 재시딩(이 스크립트는 재실행 가능하게 설계됨) 시 옛 숫자를 그대로
// 넣으면 이미 재배정된 DB의 새 체계와 충돌한다(옛 "2"가 새 체계에서는 여름 계절학기를
// 뜻하므로) — 그래서 여기서 새 체계로 변환해서 쓴다.
const LEGACY_SEMESTER_TO_CURRENT = { 1: 1, 2: 3 };

function parseDatasetKey(key) {
  // "컴퓨터·소프트웨어공학과_2017_1" -> { deptKey, year, semester }
  const m = key.match(/^(.+)_(\d{4})_(\d)$/);
  if (!m) return null;
  const semester = LEGACY_SEMESTER_TO_CURRENT[Number(m[3])];
  if (!semester) {
    console.warn(`[SKIP] ${key}: 알 수 없는 학기 값(${m[3]}) — 원본 소스는 1/2만 있어야 함`);
    return null;
  }
  return { deptKey: m[1], year: Number(m[2]), semester };
}

// 현재 학기 정확한 값을 알 수 없어(서버는 클라이언트의 getCurrentYearSemester 학사력 추정
// 로직을 공유하지 않음) 스크래핑된 데이터 중 가장 최근 (year,semester)를 "현재 학기"로 삼아
// courses.json의 시간표 미확보 수동 보정 항목(1~2학년 저학년 필수과목 등, 아직 실제로
// 개설되지 않아 스크래핑에 안 잡힘)을 그 학기에 얹는다.
function findLatestSemester(byKey) {
  let latest = null;
  for (const key of Object.keys(byKey)) {
    const parsed = parseDatasetKey(key);
    if (!parsed) continue;
    if (!latest || parsed.year > latest.year || (parsed.year === latest.year && parsed.semester > latest.semester)) {
      latest = parsed;
    }
  }
  return latest;
}

async function insertOffering(row) {
  const [result] = await pool.query(
    `INSERT INTO course_offerings
      (department_id, track_id, year, semester, grade, raw_category, category, course_code, course_name,
       section, credits, professor, room, competency, time_raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.departmentId,
      row.trackId,
      row.year,
      row.semester,
      row.grade,
      row.rawCategory,
      row.category,
      row.courseCode,
      row.courseName,
      row.section,
      row.credits,
      row.professor,
      row.room,
      row.competency,
      row.timeRaw,
    ]
  );

  const scheduleSlots = parseTimeRaw(row.timeRaw);
  for (const slot of scheduleSlots) {
    await pool.query('INSERT INTO course_offering_schedules (offering_id, day, period) VALUES (?, ?, ?)', [
      result.insertId,
      slot.day,
      slot.period,
    ]);
  }
}

// 두 원본을 같은 모양의 묶음 목록으로 만든다(순수 함수 — DB 없이 테스트).
//  - 전 학과 원본: 항목마다 학과·트랙이 있다. 사이트가 같은 학과를 옛 대학·새 대학 아래 둘 다 보여 줘(예: 간호학과 — 의과대학·간호대학)
//    같은 학과·학기 묶음이 여러 개일 수 있다. 둘 다 그 학과의 실제 개설이라 모두 넣고, 같은 분반의 중복은 insert 단계에서 거른다.
//  - 옛 원본(컴소공·공학3계열 2017~2026): 같은 학과·학기가 전 학과 원본에 있으면 같은 분반(학수번호+분반)은 전 학과 원본을 쓰고,
//    전 학과 원본에 없는 분반만 보충한다. 전 학과 원본의 컴소공 2026-2는 PDF를 덜 받아 3학년 과목 전부(데이터베이스·컴퓨터네트워크·
//    기업연계프로젝트1 등)와 졸업논문이 빠져 있었다(18행, 옛 원본 52행 — 2026-10-26 점검). 통째로 건너뛰면 3학년이 이번 학기 과목을 못 찾는다.
function buildDatasets(legacyByKey, allDepartments) {
  const datasets = [];
  const coveredSections = new Map(); // `학과|연도|학기` → 전 학과 원본에 있는 `학수번호-분반` 집합
  for (const e of (allDepartments && allDepartments.entries) || []) {
    const semester = LEGACY_SEMESTER_TO_CURRENT[Number(e.semester)];
    if (!e.department || !semester) continue;
    const coverKey = `${e.department}|${e.year}|${semester}`;
    if (!coveredSections.has(coverKey)) coveredSections.set(coverKey, new Set());
    for (const r of e.rows) coveredSections.get(coverKey).add(`${r.courseCode}-${r.section}`);
    datasets.push({ label: `${e.college || ''} > ${e.printedName}`, departmentName: e.department, trackName: e.track || null, year: e.year, semester, rows: e.rows });
  }
  for (const [key, rows] of Object.entries(legacyByKey || {})) {
    const parsed = parseDatasetKey(key);
    if (!parsed) {
      console.warn(`[SKIP] 키 형식을 못 알아봄: ${key}`);
      continue;
    }
    const departmentName = DEPARTMENT_NAME_BY_KEY_PREFIX[parsed.deptKey];
    if (!departmentName) {
      console.warn(`[SKIP] ${key}: 학과 매핑 없음 (${parsed.deptKey})`);
      continue;
    }
    const covered = coveredSections.get(`${departmentName}|${parsed.year}|${parsed.semester}`);
    if (covered) {
      const missing = rows.filter((r) => !covered.has(`${r.courseCode}-${r.section}`));
      if (missing.length) {
        datasets.push({ label: `${key} (전 학과 원본에 없는 분반 보충)`, departmentName, trackName: null, year: parsed.year, semester: parsed.semester, rows: missing });
      }
      continue;
    }
    datasets.push({ label: key, departmentName, trackName: null, year: parsed.year, semester: parsed.semester, rows });
  }
  return datasets;
}

async function seedScrapedData(datasets) {
  const deptIdCache = new Map();
  const trackIdCache = new Map();
  const touchedDeptYearSem = new Set();
  const insertedSections = new Set();

  // 1단계: 이번에 넣을 (학과, 연도, 학기)의 기존 행을 넣기 전에 모두 지운다.
  // uq_course_offerings에는 학과가 없어서, 학과 차례가 올 때마다 지우면 재시딩(두 번째 실행부터)에서 아직 안 지운 다른 학과의
  // 같은 분반 행(이전 실행에서 그 학과에 붙은 행)과 부딪혀 Duplicate entry로 실패했다. 이 실패로 재시딩 크론이 이 단계에서 멈춰
  // 뒤의 규정 재임베딩이 2026-10-13부터 실행되지 않았다(#375).
  for (const { label: key, departmentName, year, semester } of datasets) {
    if (!deptIdCache.has(departmentName)) {
      deptIdCache.set(departmentName, await findDepartmentId(departmentName));
    }
    const departmentId = deptIdCache.get(departmentName);
    if (!departmentId) {
      console.warn(`[SKIP] ${key}: DB에 학과 없음 (${departmentName})`);
      continue;
    }
    const touchKey = `${departmentId}-${year}-${semester}`;
    if (touchedDeptYearSem.has(touchKey)) continue;
    await pool.query('DELETE FROM course_offerings WHERE department_id = ? AND year = ? AND semester = ?', [departmentId, year, semester]);
    touchedDeptYearSem.add(touchKey);
  }

  // 2단계: 넣는다.
  for (const { label: key, departmentName, trackName: fixedTrackName, ...parsed } of datasets) {
    const departmentId = deptIdCache.get(departmentName);
    if (!departmentId) continue;

    let count = 0;
    for (const r of parsed.rows) {
      const trackName = fixedTrackName || inferTrackName(r.courseCode);
      const trackCacheKey = `${departmentId}-${trackName}`;
      if (trackName && !trackIdCache.has(trackCacheKey)) {
        trackIdCache.set(trackCacheKey, await findTrackId(departmentId, trackName));
      }
      const trackId = trackName ? trackIdCache.get(trackCacheKey) : null;
      if (trackName && !trackId) console.warn(`[WARN] ${key}: DB에 트랙 없음 (${departmentName} ${trackName}) — 트랙 없이 넣음`);

      // 같은 분반은 학과와 관계없이 한 번만 넣는다 — uq_course_offerings(연도·학기·학수번호·과목명·분반·교수·시간)에 학과가 없고,
      // 과목 검색(courseService)도 학과로 거르지 않아 한 분반이 한 행이어야 검색 결과가 겹치지 않는다. 사이트는 같은 분반을
      // 여러 학과 시간표에 함께 보여 준다(2026-2: 1,852개 중 16개, 대부분 교양 공통 과목·개편 전후 대학의 같은 학과) — 처음 나온 학과에 붙는다.
      const sectionKey = [parsed.year, parsed.semester, r.courseCode || '', r.courseName.trim(), r.section || '', r.professor || '', r.time || ''].join('|');
      if (insertedSections.has(sectionKey)) continue;
      insertedSections.add(sectionKey);

      const rawCategory = (r.category || '').trim() || null;
      await insertOffering({
        departmentId,
        trackId,
        year: parsed.year,
        semester: parsed.semester,
        grade: toIntOrNull(r.grade),
        rawCategory,
        category: rawCategory ? CATEGORY_MAP[rawCategory] || null : null,
        courseCode: r.courseCode || null,
        courseName: r.courseName.trim(),
        section: r.section || null,
        credits: toDecimalOrNull(r.credits),
        professor: r.professor || null,
        room: r.room || null,
        competency: r.competency || null,
        timeRaw: r.time || null,
      });
      count++;
    }
    console.log(`[OK] ${key}: ${count}행`);
  }

  return { deptIdCache };
}

// courses.json에 있지만 스크래핑 데이터 어디에도 이름이 안 나오는 항목 — 아직 실제 개설되지
// 않은(고학년이 안 됨) 저학년 필수과목을 커리큘럼 기준으로 미리 등록해둔 것들이라, "현재 학기"
// 카탈로그로 그대로 이관해서 이 정보를 잃지 않게 한다. 시간표는 원래도 없었으니 그대로 없음.
async function seedLegacyOnlyEntries(latestSemester, deptIdCache) {
  if (!fs.existsSync(LEGACY_CATALOG) || !latestSemester) return 0;

  const legacy = JSON.parse(fs.readFileSync(LEGACY_CATALOG, 'utf-8'));
  // "최신 학기에 없으면" 이 아니라 "스크래핑 데이터 어디에도 없으면"이어야 한다 — 1학기에만
  // 개설되는 저학년 필수과목(대학생활과자기혁신 등)은 최신 학기가 2학기일 때 그 안에서만
  // 찾으면 항상 "없다"고 오판해 이미 정상 데이터가 있는 과목을 시간표 없는 상태로 중복
  // 삽입하는 버그가 있었다(실측으로 확인, 2026-08-15).
  const [existingRows] = await pool.query('SELECT DISTINCT course_name FROM course_offerings');
  const existingNames = new Set(existingRows.map((r) => r.course_name));

  // 공학3계열이 신설 학과라 이 저학년 보정 항목들의 실제 출처(구학과 카탈로그였음)와 무관하게
  // 지금 시점 1학년 재학생은 전부 공학3계열 소속이므로 그쪽으로 이관한다.
  const departmentId = deptIdCache.get('공학3계열');
  if (!departmentId) return 0;

  let count = 0;
  for (const c of legacy) {
    if (existingNames.has(c.name.trim())) continue;
    await insertOffering({
      departmentId,
      trackId: null,
      year: latestSemester.year,
      semester: latestSemester.semester,
      grade: null,
      // courses.json의 category는 원문 구분 코드가 아니라 이미 정규화된 5종 값이라 그대로 씀.
      rawCategory: null,
      category: c.category,
      courseCode: null,
      courseName: c.name.trim(),
      section: null,
      credits: toDecimalOrNull(c.credits),
      professor: c.professor || null,
      room: null,
      competency: null,
      timeRaw: null,
    });
    count++;
  }
  return count;
}

async function run() {
  try {
    const byKey = JSON.parse(fs.readFileSync(RAW_SOURCE, 'utf-8'));
    const allDepartments = fs.existsSync(ALL_DEPARTMENTS_SOURCE) ? JSON.parse(fs.readFileSync(ALL_DEPARTMENTS_SOURCE, 'utf-8')) : null;
    const latestSemester = findLatestSemester(byKey);

    const { deptIdCache } = await seedScrapedData(buildDatasets(byKey, allDepartments));
    const legacyCount = await seedLegacyOnlyEntries(latestSemester, deptIdCache);
    console.log(`[OK] courses.json 전용 보정 항목 이관: ${legacyCount}건 (${latestSemester.year}-${latestSemester.semester}학기로)`);

    console.log('course_offerings 시딩 완료');
  } catch (err) {
    console.error('시딩 실패:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) run();

module.exports = { buildDatasets, parseDatasetKey, parseTimeRaw, seedScrapedData };
