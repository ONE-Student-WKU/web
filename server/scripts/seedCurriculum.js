const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fs = require('fs');
const pool = require('../db');

/**
 * server/scripts/seedCurriculum.js
 * db/curriculum/*.md의 학년/학기별 편성표를 curriculum_courses에 구조화된 행으로 저장한다.
 *
 * RAG 임베딩(seedRegulations.js)이 아니라 SQL 조건 조회로 처리하는 이유: "1학년 2학기에
 * 무슨 과목 있어?" 같은 나열형 질문은 유사도 top-K 특성상 일부 과목이 누락되는 문제가
 * 실측으로 반복 확인됨(regulationService.js 개편 이력 참고). 조건에 맞는 행 전부를
 * 빠짐없이 보장하려면 정형 테이블 조회가 맞는 접근.
 *
 * (name, section) 같은 자연키가 없어(같은 과목이 여러 학번 파일에 등장) 재시딩 시 중복을
 * 막기 위해 대상 department_id(+track_id)의 기존 행을 지우고 다시 넣는 방식으로 idempotent하게 만든다.
 */

const CURRICULUM_ROOT = path.resolve(__dirname, '..', '..', 'db', 'curriculum');

function isTableLine(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}
function isTableSeparatorLine(line) {
  const trimmed = line.trim();
  return /^[\s|:-]+$/.test(trimmed) && trimmed.includes('-');
}
function splitTableCells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function parseCredits(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// 헤더가 [학기, 구분, 학수번호, 교과목, 학점]인 표(구학과 파일) — 학년은 표가 아니라
// "## N학년" 섹션 제목에서 온다.
function parseGradeHeadingTable(headingText, lines, tableStart) {
  const grade = Number((headingText.match(/(\d)학년/) || [])[1]);
  if (!grade) return [];

  const header = splitTableCells(lines[tableStart]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const rows = [];
  let i = tableStart + 2;
  while (i < lines.length && isTableLine(lines[i])) {
    const cells = splitTableCells(lines[i]);
    rows.push({
      grade,
      semester: cells[idx['학기']],
      category: cells[idx['구분']],
      courseCode: cells[idx['학수번호']] || null,
      courseName: cells[idx['교과목']],
      courseNameEn: null,
      credits: parseCredits(cells[idx['학점']]),
      remarks: null,
    });
    i++;
  }
  return rows;
}

// 헤더에 [학년, 학기, ...]가 다 들어있는 표(2026 공학3계열 파일) — "전공과목 이수표" 섹션만 대상.
function parseGradeColumnTable(lines, tableStart) {
  const header = splitTableCells(lines[tableStart]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const rows = [];
  let i = tableStart + 2;
  while (i < lines.length && isTableLine(lines[i])) {
    const cells = splitTableCells(lines[i]);
    rows.push({
      grade: Number(cells[idx['학년']]),
      semester: cells[idx['학기']],
      category: cells[idx['구분']],
      courseCode: cells[idx['학수번호']] || null,
      courseName: cells[idx['교과목(국문)']],
      courseNameEn: cells[idx['교과목(영문)']] || null,
      credits: parseCredits(cells[idx['학점']]),
      remarks: cells[idx['비고']] || null,
    });
    i++;
  }
  return rows;
}

// 구학과 파일: "## N학년" 섹션 반복, 각 섹션 안의 표 하나.
function parseOldDeptFile(filePath) {
  // db/curriculum/*.md가 CRLF라 '\n'로만 split하면 각 줄 끝에 '\r'이 남아 $ 앵커 매치가
  // 깨진다(예: "## 1학년\r" 은 /^##\s+(.+)$/에 안 걸림) — 미리 LF로 정규화한다.
  const content = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  const lines = content.split('\n');
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^##\s+(.+)$/);
    if (!headingMatch || !/\d학년/.test(headingMatch[1])) continue;

    let tableStart = -1;
    for (let j = i + 1; j < lines.length && !/^##\s/.test(lines[j]); j++) {
      if (isTableLine(lines[j])) {
        tableStart = j;
        break;
      }
    }
    if (tableStart === -1 || !isTableSeparatorLine(lines[tableStart + 1] || '')) continue;

    rows.push(...parseGradeHeadingTable(headingMatch[1].trim(), lines, tableStart));
  }
  return rows;
}

// 2026 공학3계열 파일: "## 전공과목 이수표" 섹션의 표만 대상 (마이크로디그리 섹션은 별도
// 인증 프로그램이라 학과 편성표와 성격이 달라 이번 스코프에서 제외).
function parseNewTrackFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  const lines = content.split('\n');

  const headingIdx = lines.findIndex((l) => /^##\s+전공과목 이수표/.test(l));
  if (headingIdx === -1) return [];

  let tableStart = -1;
  for (let j = headingIdx + 1; j < lines.length && !/^##\s/.test(lines[j]); j++) {
    if (isTableLine(lines[j])) {
      tableStart = j;
      break;
    }
  }
  if (tableStart === -1 || !isTableSeparatorLine(lines[tableStart + 1] || '')) return [];

  return parseGradeColumnTable(lines, tableStart);
}

// 파일 -> {department, track, minAdmissionYear, maxAdmissionYear, parse} 매핑.
// db/regulations/졸업/이수학점_총괄표.md 근거: 구학과는 ~2025학번, 공학3계열은 2026학번부터.
const FILE_CONFIGS = [
  {
    fileName: '컴퓨터소프트웨어공학과_교육과정.md',
    department: '컴퓨터·소프트웨어공학과',
    track: null,
    minAdmissionYear: null,
    maxAdmissionYear: 2025,
    parse: parseOldDeptFile,
  },
  {
    fileName: '공학3계열_컴퓨터소프트웨어공학전공_2026.md',
    department: '공학3계열',
    track: '컴퓨터·소프트웨어공학전공',
    minAdmissionYear: 2026,
    maxAdmissionYear: null,
    parse: parseNewTrackFile,
  },
  {
    fileName: '공학3계열_게임콘텐츠학전공_2026.md',
    department: '공학3계열',
    track: '게임콘텐츠학전공',
    minAdmissionYear: 2026,
    maxAdmissionYear: null,
    parse: parseNewTrackFile,
  },
];

async function findDepartmentId(name) {
  const [rows] = await pool.query('SELECT id FROM departments WHERE name = ?', [name]);
  return rows[0]?.id || null;
}

async function findTrackId(departmentId, name) {
  if (!name) return null;
  const [rows] = await pool.query('SELECT id FROM tracks WHERE department_id = ? AND name = ?', [departmentId, name]);
  return rows[0]?.id || null;
}

async function seedFile(config) {
  const departmentId = await findDepartmentId(config.department);
  if (!departmentId) {
    console.warn(`[SKIP] ${config.fileName}: 학과를 찾을 수 없음 (${config.department}) — seed.js를 먼저 실행하세요`);
    return 0;
  }
  const trackId = await findTrackId(departmentId, config.track);
  if (config.track && !trackId) {
    console.warn(`[SKIP] ${config.fileName}: 트랙을 찾을 수 없음 (${config.track})`);
    return 0;
  }

  const filePath = path.join(CURRICULUM_ROOT, config.fileName);
  const rows = config.parse(filePath);
  if (rows.length === 0) {
    console.warn(`[SKIP] ${config.fileName}: 파싱된 행이 없음`);
    return 0;
  }

  await pool.query(
    trackId
      ? 'DELETE FROM curriculum_courses WHERE department_id = ? AND track_id = ?'
      : 'DELETE FROM curriculum_courses WHERE department_id = ? AND track_id IS NULL',
    trackId ? [departmentId, trackId] : [departmentId]
  );

  for (const row of rows) {
    await pool.query(
      `INSERT INTO curriculum_courses
        (department_id, track_id, min_admission_year, max_admission_year, grade, semester,
         category, course_code, course_name, course_name_en, credits, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        departmentId,
        trackId,
        config.minAdmissionYear,
        config.maxAdmissionYear,
        row.grade,
        row.semester,
        row.category,
        row.courseCode,
        row.courseName,
        row.courseNameEn,
        row.credits,
        row.remarks,
      ]
    );
  }
  console.log(`[OK] ${config.fileName}: ${rows.length}개 과목`);
  return rows.length;
}

async function run() {
  try {
    let total = 0;
    for (const config of FILE_CONFIGS) {
      total += await seedFile(config);
    }
    console.log(`curriculum_courses 시딩 완료: 총 ${total}개 과목`);
  } catch (err) {
    console.error('시딩 실패:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
