const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fs = require('fs');
const pool = require('../db');

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
const LEGACY_CATALOG = path.resolve(__dirname, '..', '..', 'db', 'seed', 'courses.json');

// 원문 "구분" 코드 → student_courses.category(졸업요건 계산용 5종 ENUM) 정규화.
// 계필/계기(수학1·일반물리학1 등 계열 기초 과학/수학)는 db/curriculum/*.md의 학과 커리큘럼
// 표에도 원래 빠져있던 항목이라(전공 카탈로그로 취급 안 함) 교양선택으로 분류 — 전공필수로
// 잘못 잡으면 졸업요건 진단의 "기본전공 19학점"이 부풀려짐.
// 기초/심화/응용(2026 공학3계열)은 curriculum_requirements.json상 전공필수36+전공선택36으로
// 나뉘지만 원문 어디에도 세부 과목별 필수/선택 구분이 없어(공학3계열_컴퓨터소프트웨어공학전공_2026.md
// "남은 미확보 항목" 참고) 전공선택으로 보수적으로 매핑 — 전공필수로 잘못 잡으면 "전공필수
// 미충족"으로 오판정될 위험이 더 크다고 판단.
// 교직(교직과정 이수자 전용 특수 과목)은 표준 5종 어디에도 안 맞아 일반선택으로 매핑.
const CATEGORY_MAP = {
  교필: '교양필수',
  교선: '교양선택',
  기전: '전공필수',
  선전: '전공선택',
  일선: '일반선택',
  계필: '교양선택',
  계기: '교양선택',
  기초: '전공선택',
  심화: '전공선택',
  응용: '전공선택',
  교직: '일반선택',
};

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
function parseTimeRaw(timeRaw) {
  if (!timeRaw) return [];
  const result = [];
  const re = /([월화수목금])(\d+)/g;
  let m;
  while ((m = re.exec(timeRaw))) {
    const [, day, digits] = m;
    for (const ch of digits) result.push({ day, period: Number(ch) });
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

function parseDatasetKey(key) {
  // "컴퓨터·소프트웨어공학과_2017_1" -> { deptKey, year, semester }
  const m = key.match(/^(.+)_(\d{4})_(\d)$/);
  if (!m) return null;
  return { deptKey: m[1], year: Number(m[2]), semester: Number(m[3]) };
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

async function seedScrapedData(byKey) {
  const deptIdCache = new Map();
  const trackIdCache = new Map();
  const touchedDeptYearSem = new Set();

  for (const [key, rows] of Object.entries(byKey)) {
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

    if (!deptIdCache.has(departmentName)) {
      deptIdCache.set(departmentName, await findDepartmentId(departmentName));
    }
    const departmentId = deptIdCache.get(departmentName);
    if (!departmentId) {
      console.warn(`[SKIP] ${key}: DB에 학과 없음 (${departmentName})`);
      continue;
    }

    const touchKey = `${departmentId}-${parsed.year}-${parsed.semester}`;
    if (!touchedDeptYearSem.has(touchKey)) {
      await pool.query('DELETE FROM course_offerings WHERE department_id = ? AND year = ? AND semester = ?', [
        departmentId,
        parsed.year,
        parsed.semester,
      ]);
      touchedDeptYearSem.add(touchKey);
    }

    let count = 0;
    for (const r of rows) {
      const trackName = inferTrackName(r.courseCode);
      const trackCacheKey = `${departmentId}-${trackName}`;
      if (trackName && !trackIdCache.has(trackCacheKey)) {
        trackIdCache.set(trackCacheKey, await findTrackId(departmentId, trackName));
      }
      const trackId = trackName ? trackIdCache.get(trackCacheKey) : null;

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
    const latestSemester = findLatestSemester(byKey);

    const { deptIdCache } = await seedScrapedData(byKey);
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

run();
