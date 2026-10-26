const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { evaluate } = require('../services/regulationEngine/evaluate');
const { normalizeInput } = require('../services/regulationEngine/context');
const { COLLEGE_CONFIRMED_TRANSFER_DEPARTMENTS } = require('../services/regulationEngine/constants');

/**
 * server/test/orientalMedicineTransfer.test.js
 * 한의학과 편입생은 본과 1학년으로 편입해 본과 160학점이 졸업 기준이다(한의과대학 답변 2026-10-26, DECISIONS D-84).
 * 편입 학년·인정학점 입력과 관계없이 총 160학점·확정이고, 의학과·치의학과 편입생은 답을 받지 못해 그대로 추정이다.
 * 앞쪽은 DB 없음(시드와 같은 모양의 행), 뒤쪽은 로컬 시드 전제.
 */

after(async () => { await pool.end(); });

const row = (category, requiredCredits, over = {}) => ({ category, requiredCredits, minAdmissionYear: null, maxAdmissionYear: null, enrollmentType: null, minCourseCount: null, requiredCourses: [], ...over });
const ROWS = [row('전공', 160), row('일반선택', 0), row('졸업논문', 0, { minCourseCount: 1 })];

function judge(departmentName, transfer) {
  const { ctx } = normalizeInput({ admissionYear: 2023, enrollmentType: 'TRANSFER_ADMISSION', departmentName, asOfDate: '2026-10-26', transfer });
  const r = evaluate(ctx, { department: { id: 1, name: departmentName }, rows: ROWS, latestDataYear: 2026 });
  return r.rules.find((x) => x.id === 'REQUIREMENTS');
}

test('한의학과 편입생: 편입 학년·인정학점과 관계없이 총 160학점(본과 학점), 확정', () => {
  for (const transfer of [undefined, { grade: 2 }, { grade: 3 }, { grade: 4, recognizedCredits: 80 }]) {
    const req = judge('한의학과', transfer);
    const label = JSON.stringify(transfer);
    assert.equal(req.confidence, 'CONFIRMED', `${label}: ${req.flags.map((f) => f.code).join(',')}`);
    assert.equal(req.value.totalRequiredCredits, 160, label);
    assert.deepEqual(req.value.categories.filter((c) => c.category === '전공').map((c) => c.requiredCredits), [160], `${label}: 4학년 21학점 완화가 붙으면 안 된다`);
    const codes = req.flags.map((f) => f.code);
    for (const code of ['TRANSFER_TOTAL_UNRESOLVED', 'TRANSFER_GRADE_ASSUMED', 'TRANSFER_COHORT_YEAR_UNVERIFIED', 'TRANSFER_4TH_YEAR_MAJOR_MINIMUM', 'TRANSFER_MEDICAL_SCHOOL_BYLAW']) {
      assert.ok(!codes.includes(code), `${label}: ${code}`);
    }
    assert.ok(codes.includes('TRANSFER_TOTAL_FROM_COLLEGE_ANSWER'), label);
    assert.ok(codes.includes('TRANSFER_ORIENTAL_MEDICINE_PREREQUISITE'), label);
    assert.ok(req.basis.some((b) => b.key === 'COLLEGE_ORIENTAL_MEDICINE_TRANSFER'), label);
  }
});

test('의학과·치의학과 편입생은 답을 받지 못해 총 학점 미정·내규 확인 추정 그대로', () => {
  for (const dept of ['의학과', '치의학과']) {
    const req = judge(dept, { grade: 3 });
    assert.equal(req.confidence, 'ESTIMATED', dept);
    assert.equal(req.value.totalRequiredCredits, null, dept);
    const codes = req.flags.map((f) => f.code);
    assert.ok(codes.includes('TRANSFER_TOTAL_UNRESOLVED') && codes.includes('TRANSFER_MEDICAL_SCHOOL_BYLAW'), dept);
  }
});

test('DB: 한의학과 2017~2026학번 일반 행이 모두 전공 160이다 — 학번과 무관하게 160으로 보는 전제', async () => {
  assert.deepEqual([...COLLEGE_CONFIRMED_TRANSFER_DEPARTMENTS], ['한의학과']);
  const [rows] = await pool.query(
    `SELECT cr.min_admission_year AS y, SUM(cr.required_credits) AS total
       FROM curriculum_requirements cr JOIN departments d ON d.id = cr.department_id
      WHERE d.name = '한의학과' AND cr.enrollment_type IS NULL AND cr.min_course_count IS NULL
      GROUP BY cr.min_admission_year ORDER BY cr.min_admission_year`
  );
  assert.deepEqual(rows.map((r) => Number(r.y)), [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  for (const r of rows) assert.equal(Number(r.total), 160, `${r.y}학번`);
});
