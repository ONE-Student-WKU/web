const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { getGraduationStatus } = require('../services/graduationService');
const { resolveRegulation } = require('../services/regulationEngine');
const { loadData } = require('../services/regulationEngine/dbProvider');

/**
 * server/test/regulationEngine.parity.test.js
 * 규정 판단 엔진(졸업요건 행 선택·완화·재배분)이 기존 graduationService와 같은 숫자를 내는지 검증한다.
 * 왜 필요한가: 같은 규칙을 두 곳에 구현해 뒀으므로(이번 파트에서는 graduationService를 건드리지 않음) 한쪽만 고쳐지면
 * 조용히 어긋난다. 이 테스트가 어긋남을 잡는다 — Part 2에서 graduationService가 엔진을 쓰도록 바꾸면 이 테스트는 필요 없어진다.
 * 전제: 시드 데이터(departments, curriculum_requirements). DB에 임시 학생 1명을 만들고 끝나면 지운다.
 *
 * 같은 숫자가 나오리라 기대하지 않는 영역(엔진이 의도적으로 다르게 계산)은 비교에서 뺀다:
 *  - 편입생 총 요구학점(엔진은 단정하지 않고 null)
 *  - 교양 인정 상한(엔진은 2021학번 이하 상한 없음 + 추정, graduationService는 전 학번 52 — earned 계산 쪽이라 요건 행과 무관)
 *  - 1·2학년 전과 + 컷오프 이전(엔진만 일반선택 재배분) — rules.test.js가 따로 검증
 */

const ASOF = '2026-10-05';
let studentId;
let departments;

before(async () => {
  const [result] = await pool.query(
    "INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())",
    [`parity-test-${Date.now()}@example.test`, `parity${Date.now()}`]
  );
  studentId = result.insertId;
  [departments] = await pool.query(
    `SELECT d.id, d.name, MIN(r.min_admission_year) AS min_year, MAX(r.max_admission_year) AS max_year
     FROM departments d JOIN curriculum_requirements r ON r.department_id = d.id
     WHERE r.category IN ('교양필수', '교양선택', '전공필수', '전공선택', '전공') AND r.enrollment_type IS NULL
     GROUP BY d.id, d.name`
  );
});

after(async () => {
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

const engineLoader = (ctx) => loadData(ctx, { withHistory: false });

async function setStudent({ departmentId, admissionYear, enrollmentType, mc }) {
  await pool.query(
    `UPDATE students SET department_id = ?, admission_year = ?, enrollment_type = ?,
       major_change_grade = ?, major_change_year = ?, major_change_semester = ? WHERE id = ?`,
    [departmentId, admissionYear, enrollmentType, mc ? mc.grade : null, mc ? mc.year : null, mc ? mc.semester : null, studentId]
  );
}

const pairs = (list) => list.map((c) => `${c.category}:${c.requiredCredits}`).sort();
const certPairs = (list) => list.map((c) => `${c.category}:${[...c.requiredCourses].sort().join('|')}`).sort();

async function compare(label, dept, admissionYear, enrollmentType, mc, { skipTotal = false } = {}) {
  await setStudent({ departmentId: dept.id, admissionYear, enrollmentType, mc });
  const legacy = await getGraduationStatus(studentId);
  const engine = await resolveRegulation(
    { admissionYear, enrollmentType, departmentId: dept.id, asOfDate: ASOF, majorChange: mc },
    { loadData: engineLoader }
  );
  const req = engine.rules.find((r) => r.id === 'REQUIREMENTS');
  assert.ok(req.value, `${label}: 엔진이 요건 값을 못 만들었어요 (${req.flags.map((f) => f.code)})`);
  assert.deepEqual(pairs(req.value.categories), pairs(legacy.categories.map((c) => ({ category: c.category, requiredCredits: c.requiredCredits }))), `${label}: 카테고리별 요구학점`);
  assert.deepEqual(certPairs(req.value.certifications), certPairs(legacy.certifications), `${label}: 졸업논문/인증제 요건`);
  if (!skipTotal) assert.equal(req.value.totalRequiredCredits, legacy.totalRequiredCredits, `${label}: 총 요구학점`);
}

const yearsOf = (d) => [...new Set([Math.max(d.min_year ?? 2017, 2017), Math.min(d.max_year ?? 2026, 2026)])];

test('패리티: 일반 재학생 — 전 학과 × 자료가 있는 첫/마지막 학번', async () => {
  let n = 0;
  for (const d of departments) {
    for (const y of yearsOf(d)) { await compare(`${d.name} ${y} GENERAL`, d, y, 'GENERAL', null); n++; }
  }
  assert.ok(n > 200, `비교 건수 ${n}`);
});

test('패리티: 3학년 전과 — 컷오프 이전(2021-2) / 이후(2022-2 경계 포함) × 전 학과', async () => {
  for (const d of departments) {
    for (const y of yearsOf(d)) {
      if (y <= 2021) await compare(`${d.name} ${y} 전과3 2021-2`, d, y, 'MAJOR_CHANGE', { grade: 3, year: 2021, semester: 2 });
      const year = Math.max(2022, y);
      await compare(`${d.name} ${y} 전과3 ${year}-2`, d, y, 'MAJOR_CHANGE', { grade: 3, year, semester: 2 });
    }
  }
});

test('패리티: 1·2학년 전과(컷오프 이후) × 전 학과', async () => {
  for (const d of departments) {
    for (const y of yearsOf(d)) await compare(`${d.name} ${y} 전과1`, d, y, 'MAJOR_CHANGE', { grade: 1, year: Math.max(2022, y), semester: 2 });
  }
});

test('패리티: 편입생(편입 학년 미입력 = 3학년 가정) — 총 요구학점은 제외하고 카테고리 비교', async () => {
  for (const d of departments) {
    for (const y of yearsOf(d)) await compare(`${d.name} ${y} 편입`, d, y, 'TRANSFER_ADMISSION', null, { skipTotal: true });
  }
});

test('의도된 차이: 1·2학년 전과 + 컷오프 이전 — graduationService는 총량이 부풀고, 엔진은 일반선택을 재배분해 136을 보존한다', async () => {
  // 2021학번(교양 23)이 2022-1학기(컷오프 이전)에 2학년으로 전과: 전공 완화 없음(75), 교양은 29 고정(+6).
  // graduationService는 재배분을 3·4학년 전과에만 적용해서 총 요구학점이 75+29+38=142가 된다.
  // 엔진은 "완화/고정으로 바뀐 만큼을 일반선택이 흡수한다"는 원리를 전과생 전체에 적용해 136이다(DECISIONS.md D-07).
  // Part 2에서 graduationService를 엔진으로 교체하면 이 단언 중 legacy 쪽이 바뀌는 게 정상이다.
  const d = departments.find((x) => x.name === '컴퓨터·소프트웨어공학과');
  const mc = { grade: 2, year: 2022, semester: 1 };
  await setStudent({ departmentId: d.id, admissionYear: 2021, enrollmentType: 'MAJOR_CHANGE', mc });
  const legacy = await getGraduationStatus(studentId);
  const engine = await resolveRegulation({ admissionYear: 2021, enrollmentType: 'MAJOR_CHANGE', departmentId: d.id, asOfDate: ASOF, majorChange: mc }, { loadData: engineLoader });
  assert.equal(legacy.totalRequiredCredits, 142);
  assert.equal(engine.rules.find((r) => r.id === 'REQUIREMENTS').value.totalRequiredCredits, 136);
});
