const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { getGraduationStatus } = require('../services/graduationService');
const { resolveRegulation } = require('../services/regulationEngine');
const { loadData } = require('../services/regulationEngine/dbProvider');
const { NON_DEGREE_DEPARTMENTS } = require('../services/regulationEngine/constants');
const { canTakeTeachingCourse } = require('../services/teachingCourse');

/**
 * server/test/regulationEngine.parity.test.js
 * 졸업진단(graduationService)이 보여주는 요건이 규정 판단 엔진의 판단과 같은지 검증한다.
 *
 * 파트 3에서 바뀐 의미: 예전에는 같은 규칙이 graduationService와 엔진 두 곳에 따로 구현돼 있어 "두 구현의 숫자가 같은가"를
 * 봤다. 이제 graduationService는 엔진 결과를 받아 이수 현황만 계산하므로(DECISIONS D-32), 이 테스트는 그 **연결부**(엔진
 * 결과 → 진단 행 변환: 카테고리·졸업논문/인증제·총량)가 값을 잃거나 바꾸지 않는지를 전 학과·학번·입학유형에서 확인한다.
 * 연결 전후 실제 숫자 차이(1·2학년 전과 컷오프 이전 등)는 D-32 표에 기록했다.
 * 전제: 시드 데이터(departments, curriculum_requirements). DB에 임시 학생 1명을 만들고 끝나면 지운다.
 *
 * 편입생 총 요구학점은 비교하지 않는다: 엔진은 단정하지 않고 null, 진단은 화면 호환을 위해 카테고리 합을 보여주되
 * regulation.totalDefinitive=false로 "확정 아님"을 표시한다.
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
  // 자율전공학부처럼 졸업요건 진단 대상이 아닌 학과(1학년 과정 행만 있음)는 엔진이 의도적으로 요건 값을 만들지 않는다
  // (NON_DEGREE_DEPARTMENT, GRADUATION_AUDIT_2026-10-12 3절) — graduation.audit.test.js가 따로 검증한다.
  departments = departments.filter((d) => !NON_DEGREE_DEPARTMENTS.includes(d.name));
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
  // 교직기본이수는 진단이 학생의 교직 여부로 거른다(D-67): 편입생·3학년 이상 전과생은 교직을 이수할 수 없어 진단에서 빠진다.
  const teachingAllowed = canTakeTeachingCourse({ enrollmentType, majorChangeGrade: mc ? mc.grade : null });
  const engineCerts = req.value.certifications.filter((c) => teachingAllowed || c.category !== '교직기본이수');
  assert.deepEqual(certPairs(engineCerts), certPairs(legacy.certifications), `${label}: 졸업논문/인증제 요건`);
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

// 의·치·한의예(학)과·약학대학으로는 전과할 수 없어(시행규칙 제111조 제4호) 엔진이 판정하지 않는다 — 전과 패리티에서 뺀다(2026-10-17).
const { MAJOR_CHANGE_CLOSED_DEPARTMENTS } = require('../services/regulationEngine/constants');
const { PREMED_DEPARTMENTS } = require('../services/regulationEngine/profileCaveats');
const openForMajorChange = (list) => list.filter((d) => !MAJOR_CHANGE_CLOSED_DEPARTMENTS.includes(d.name));

test('패리티: 3학년 전과 — 컷오프 이전(2021-2) / 이후(2022-2 경계 포함) × 전 학과', async () => {
  for (const d of openForMajorChange(departments)) {
    for (const y of yearsOf(d)) {
      if (y <= 2021) await compare(`${d.name} ${y} 전과3 2021-2`, d, y, 'MAJOR_CHANGE', { grade: 3, year: 2021, semester: 2 });
      const year = Math.max(2022, y);
      await compare(`${d.name} ${y} 전과3 ${year}-2`, d, y, 'MAJOR_CHANGE', { grade: 3, year, semester: 2 });
    }
  }
});

test('패리티: 1·2학년 전과(컷오프 이후) × 전 학과', async () => {
  for (const d of openForMajorChange(departments)) {
    for (const y of yearsOf(d)) await compare(`${d.name} ${y} 전과1`, d, y, 'MAJOR_CHANGE', { grade: 1, year: Math.max(2022, y), semester: 2 });
  }
});

test('패리티: 편입생(편입 학년 미입력 = 3학년 가정) — 총 요구학점은 제외하고 카테고리 비교', async () => {
  // 예과에는 편입학이 없어(학칙 제36조) 엔진이 판정하지 않는다(TRANSFER_INTO_PREMED_NOT_OFFERED).
  for (const d of departments.filter((x) => !PREMED_DEPARTMENTS.includes(x.name))) {
    for (const y of yearsOf(d)) await compare(`${d.name} ${y} 편입`, d, y, 'TRANSFER_ADMISSION', null, { skipTotal: true });
  }
});

test('파트 3 동작 변경: 1·2학년 전과 + 컷오프 이전 — 졸업진단도 일반선택을 재배분해 136을 보존한다(예전 142)', async () => {
  // 2021학번(교양 23)이 2022-1학기(컷오프 이전)에 2학년으로 전과: 전공 완화 없음(75), 교양은 29 고정(+6).
  // 예전 graduationService는 재배분을 3·4학년 전과에만 적용해서 총 요구학점이 75+29+38=142였다.
  // 엔진은 "완화/고정으로 바뀐 만큼을 일반선택이 흡수한다"는 원리를 전과생 전체에 적용해 136이다(D-07). 파트 3에서 진단이
  // 엔진을 쓰게 되면서 이 단언의 legacy 쪽이 142 → 136으로 바뀌었다(D-32).
  const d = departments.find((x) => x.name === '컴퓨터·소프트웨어공학과');
  const mc = { grade: 2, year: 2022, semester: 1 };
  await setStudent({ departmentId: d.id, admissionYear: 2021, enrollmentType: 'MAJOR_CHANGE', mc });
  const legacy = await getGraduationStatus(studentId);
  const engine = await resolveRegulation({ admissionYear: 2021, enrollmentType: 'MAJOR_CHANGE', departmentId: d.id, asOfDate: ASOF, majorChange: mc }, { loadData: engineLoader });
  assert.equal(legacy.totalRequiredCredits, 136);
  assert.equal(engine.rules.find((r) => r.id === 'REQUIREMENTS').value.totalRequiredCredits, 136);
});
