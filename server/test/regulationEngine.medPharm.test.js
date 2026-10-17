const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { resolveRequirementsForStudent } = require('../services/regulationEngine');

/**
 * server/test/regulationEngine.medPharm.test.js
 * 의·약학계열 규정(2026-10-17):
 *  - 의·치·한의예(학)과·약학대학으로의 전과는 제한(학칙시행규칙 제111조 제4호) → 판정하지 않는다(자료 없음 + 안내).
 *  - 의·약학계열 3학년 편입생은 학과의 전공이수학점을 따른다(학교 편입생 교육과정 3항 단서) → "줄어든 기준 자료 없음"이 아니다.
 */

after(() => pool.end());

const deptId = async (name) => (await pool.query('SELECT id FROM departments WHERE name = ?', [name]))[0][0].id;
const codes = (r) => r.flags.map((f) => f.code);

test('약학과로 전과한 프로필은 판정하지 않고 제111조 안내를 남긴다', async () => {
  const r = await resolveRequirementsForStudent({ admissionYear: 2023, departmentId: await deptId('약학과'), enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 2, year: 2024, semester: 1 } });
  assert.equal(r.confidence, 'NO_DATA');
  assert.ok(codes(r).includes('MAJOR_CHANGE_INTO_CLOSED_DEPARTMENT'));
});

test('간호학과로의 3학년 전과는 막지 않는다(간호대학은 제111조 대상이 아니다)', async () => {
  const r = await resolveRequirementsForStudent({ admissionYear: 2023, departmentId: await deptId('간호학과'), enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 3, year: 2025, semester: 1 } });
  assert.ok(!codes(r).includes('MAJOR_CHANGE_INTO_CLOSED_DEPARTMENT'));
});

test('간호학과 3학년 편입: 전공은 학과 기준 그대로(줄어든 기준 자료 없음 사유가 아니다), 총량은 여전히 단정하지 않는다', async () => {
  const r = await resolveRequirementsForStudent({ admissionYear: 2023, departmentId: await deptId('간호학과'), enrollmentType: 'TRANSFER_ADMISSION', transfer: { grade: 3, recognizedCredits: null } });
  assert.ok(codes(r).includes('TRANSFER_MED_PHARM_MAJOR_AS_DEPARTMENT'));
  assert.ok(!codes(r).includes('MAJOR_RELAXATION_ROW_MISSING'));
  assert.ok(codes(r).includes('TRANSFER_TOTAL_UNRESOLVED'));
});
