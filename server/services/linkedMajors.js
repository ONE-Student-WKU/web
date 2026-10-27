const pool = require('../db');
const { normalizeCourseName } = require('./courseNameMatch');

/**
 * server/services/linkedMajors.js
 * 연계·복합전공과 사업단 마이크로디그리 — 학생이 고르는 목록, 고른 값 저장, 과목 맞추기(#412 1·2단계).
 *
 * 규정(2026 교육과정 책자 Ⅴ·Ⅵ장, db/regulations/전공선택/2026_연계복합전공_이수안내.md·2026_마이크로디그리_이수안내.md)
 *  - 연계·복합전공: 3~6개 학과 과목으로 짠 하나의 전공. 복수전공으로 하면 전공별 이수학점(36·48), 부전공으로 하면 21학점(자기 전공 외 과목).
 *    주전공(또는 복수전공)과 과목명이 같으면 최소전공인정학점의 1/3까지 중복 인정, 교양은 9학점까지 연계전공 학점으로 인정(교양과 중복 인정 안 됨),
 *    한 학과(부) 교육과정은 16학점까지.
 *  - 마이크로디그리: 2026 책자는 모든 과정이 12학점이다(옛 2025 표의 과정별 학점은 쓰지 않는다 — 2026-10-27 결정).
 *    졸업학점에 따로 더해지지 않는다(들은 과목이 MD 조건도 채운다). 학과·전공별 MD(광역계열)는 아직 데이터가 없다(3단계).
 *
 * 학생이 고른 값은 id가 아니라 이름으로 저장한다 — 재시딩(seed:linked-majors)이 행을 지우고 다시 넣어 id가 바뀐다.
 */

// 연계전공 자료에 섞여 들어온 학부(연계·복합전공이 아님 — 2026-10-27 결정으로 목록에서 뺀다).
const EXCLUDED_LINKED_MAJORS = Object.freeze(['자율융합학부']);
const LINKED_MINOR_CREDITS = 21;
const LINKED_LIBERAL_MAX = 9;
const MICRO_DEGREE_CREDITS = 12;
const MAX_MICRO_DEGREES = 10;
const MAJOR_CATEGORIES = new Set(['전공필수', '전공선택', '전공기초']);

async function listLinkedMajors() {
  const [rows] = await pool.query(
    'SELECT name, program_group, required_credits FROM linked_majors WHERE name NOT IN (?) ORDER BY program_group, name',
    [EXCLUDED_LINKED_MAJORS]
  );
  return rows.map((r) => ({ name: r.name, programGroup: r.program_group, requiredCredits: r.required_credits == null ? null : Number(r.required_credits) }));
}

async function listMicroDegrees() {
  const [rows] = await pool.query('SELECT name, program_group FROM micro_degrees ORDER BY program_group, name');
  return rows.map((r) => ({ name: r.name, programGroup: r.program_group, requiredCredits: MICRO_DEGREE_CREDITS }));
}

/** 연계전공 하나와 과목(정규화한 과목명 — 전공 과목과 교양 과목을 나눈다). 없거나 제외 목록이면 null. */
async function findLinkedMajor(name) {
  if (!name || EXCLUDED_LINKED_MAJORS.includes(name)) return null;
  const [[major]] = await pool.query('SELECT id, name, program_group, required_credits FROM linked_majors WHERE name = ?', [name]);
  if (!major) return null;
  const [courses] = await pool.query('SELECT course_name, category, credits FROM linked_major_courses WHERE linked_major_id = ?', [major.id]);
  const majorNames = new Set();
  const liberalNames = new Set();
  for (const c of courses) (MAJOR_CATEGORIES.has(c.category) ? majorNames : liberalNames).add(normalizeCourseName(c.course_name));
  return {
    name: major.name,
    programGroup: major.program_group,
    requiredCredits: major.required_credits == null ? null : Number(major.required_credits),
    majorNames,
    liberalNames,
  };
}

/** 고른 이름이 모두 있는 마이크로디그리인가(저장 전 검증). */
async function microDegreesExist(names) {
  if (names.length === 0) return true;
  const [rows] = await pool.query('SELECT name FROM micro_degrees WHERE name IN (?)', [names]);
  return new Set(rows.map((r) => r.name)).size === new Set(names).size;
}

/** 요청 값 검증. 오류 코드 또는 null. */
function validateMicroDegreeList(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) return 'INVALID_MICRO_DEGREES';
  if (new Set(value).size > MAX_MICRO_DEGREES) return 'TOO_MANY_MICRO_DEGREES';
  return null;
}

async function getStudentMicroDegrees(studentId) {
  const [rows] = await pool.query('SELECT micro_degree_name FROM student_micro_degrees WHERE student_id = ? ORDER BY id', [studentId]);
  return rows.map((r) => r.micro_degree_name);
}

async function setStudentMicroDegrees(studentId, names) {
  const unique = [...new Set(names.map((n) => n.trim()))];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM student_micro_degrees WHERE student_id = ?', [studentId]);
    for (const name of unique) await conn.query('INSERT INTO student_micro_degrees (student_id, micro_degree_name) VALUES (?, ?)', [studentId, name]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 고른 마이크로디그리마다 이수 학점(순수 함수). 과목명(정규화)으로 맞춘다 — 학수번호가 없는 과목(직접 입력·성적표)이 많다.
 * 졸업학점에는 영향이 없어 한 과목이 여러 과정에 함께 세어져도 된다(과정마다 따로 보여 줄 뿐이다).
 * @param {Array<{ name, programGroup, courseNames: Set<string> }>} programs
 * @param {Array<{ name, credits }>} courses 이수 과목(F·NP·재수강으로 대체된 기록 제외, 수강 중 포함)
 */
function evaluateMicroDegrees(programs, courses) {
  return programs.map((p) => {
    const matched = courses.filter((c) => p.courseNames.has(normalizeCourseName(String(c.name || ''))));
    const earned = matched.reduce((s, c) => s + Number(c.credits), 0);
    return {
      name: p.name,
      programGroup: p.programGroup,
      required: MICRO_DEGREE_CREDITS,
      earned,
      satisfied: earned >= MICRO_DEGREE_CREDITS,
      courses: matched.map((c) => ({ name: c.name, credits: Number(c.credits) })),
      // 목록에서 사라진 과정(재시딩으로 이름이 바뀜 등)은 과목을 맞출 수 없다 — 화면이 "과정 정보를 찾을 수 없어요"로 알린다.
      missing: p.missing || false,
    };
  });
}

async function loadMicroDegreePrograms(names) {
  if (names.length === 0) return [];
  const [rows] = await pool.query(
    `SELECT m.name, m.program_group, c.course_name FROM micro_degrees m LEFT JOIN micro_degree_courses c ON c.micro_degree_id = m.id WHERE m.name IN (?)`,
    [names]
  );
  const byName = new Map();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, { name: r.name, programGroup: r.program_group, courseNames: new Set() });
    if (r.course_name) byName.get(r.name).courseNames.add(normalizeCourseName(r.course_name));
  }
  return names.map((n) => byName.get(n) || { name: n, programGroup: null, courseNames: new Set(), missing: true });
}

async function getMicroDegreeStatus(studentId, courses) {
  const names = await getStudentMicroDegrees(studentId);
  if (names.length === 0) return [];
  return evaluateMicroDegrees(await loadMicroDegreePrograms(names), courses);
}

module.exports = {
  EXCLUDED_LINKED_MAJORS, LINKED_MINOR_CREDITS, LINKED_LIBERAL_MAX, MICRO_DEGREE_CREDITS, MAX_MICRO_DEGREES,
  listLinkedMajors, listMicroDegrees, findLinkedMajor, microDegreesExist, validateMicroDegreeList,
  getStudentMicroDegrees, setStudentMicroDegrees, evaluateMicroDegrees, getMicroDegreeStatus,
};
