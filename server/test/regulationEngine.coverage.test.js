const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const studentService = require('../services/studentService');
const { resolveRequirementsForStudent, inputFromStudentRow } = require('../services/regulationEngine');

/**
 * server/test/regulationEngine.coverage.test.js
 * 온보딩에서 고를 수 있는 모든 (학과, 학번, 입학 유형)에서 졸업요건이 나오는지 본다 — "자료 없음"(NO_DATA)은
 * 일부러 진단하지 않는 자율전공학부(NON_DEGREE_DEPARTMENT)만 허용한다(#378, 2026-10-15 운영 점검).
 * 예전에는 학과가 생기기 전 학번의 전과생(예: 2021학번 → 2023년 신설 경영학과) 74개 조합이 "자료 없음"이었고,
 * 홈은 이를 "모든 요건 충족"으로 보여 줬다(#386). 새 학과·학번이 시드에 들어와 공백이 생기면 이 테스트가 잡는다.
 *
 * 고를 수 있는 범위는 온보딩과 같다(client/src/utils/onboardingYears.js getYearRange):
 *  - 일반·편입생: 요건 행이 있는 학번(core*). 편입생은 올해 학번 제외.
 *  - 전과생: 넓은 범위(min/max). 전과 시점은 학과(요건)가 생긴 뒤로 둔다.
 */

after(() => pool.end());

// 의·치·한의예(학)과·약학대학 전과생은 규정상 있을 수 없어(시행규칙 제111조 제4호) 판정하지 않는다(2026-10-17).
const ALLOWED_NO_DATA = new Set(['NON_DEGREE_DEPARTMENT', 'MAJOR_CHANGE_INTO_CLOSED_DEPARTMENT']);
const THIS_YEAR = 2026;

test('고를 수 있는 모든 학과·학번·입학 유형에서 졸업요건이 나온다(자율전공학부 제외)', async () => {
  const departments = await studentService.listDepartments();
  const gaps = [];
  let checked = 0;
  const check = async (d, year, enrollmentType, extra = {}) => {
    const regulation = await resolveRequirementsForStudent(inputFromStudentRow({ department_id: d.id, department_name: d.name, admission_year: year, enrollment_type: enrollmentType, ...extra }));
    const rule = regulation.rules.find((r) => r.id === 'REQUIREMENTS');
    checked += 1;
    if (rule && rule.value && rule.value.categories.length > 0) return;
    const reason = (rule && rule.flags.find((f) => f.level === 'NO_DATA')) || {};
    if (!ALLOWED_NO_DATA.has(reason.code)) gaps.push(`${d.name} ${year}학번 ${enrollmentType}: ${reason.code || '요건 없음'}`);
  };

  for (const d of departments) {
    const coreMin = d.coreMinAdmissionYear ?? d.minAdmissionYear;
    const coreMax = d.coreMaxAdmissionYear ?? d.maxAdmissionYear;
    for (let y = coreMin; coreMin != null && y <= coreMax; y += 1) {
      await check(d, y, 'GENERAL');
      if (y < THIS_YEAR) await check(d, y, 'TRANSFER_ADMISSION', { transfer_grade: 3 });
    }
    for (let y = d.minAdmissionYear; d.minAdmissionYear != null && y <= d.maxAdmissionYear; y += 1) {
      const changeYear = Math.max(y + 1, coreMin ?? y + 1);
      if (changeYear > THIS_YEAR) continue;
      await check(d, y, 'MAJOR_CHANGE', { major_change_grade: Math.min(4, changeYear - y + 1), major_change_year: changeYear, major_change_semester: 1 });
    }
  }

  assert.ok(checked > 1000, `확인한 조합이 너무 적어요(${checked}) — 시드가 비었는지 확인`);
  assert.deepEqual(gaps, [], `졸업요건이 나오지 않는 조합 ${gaps.length}개:\n${gaps.join('\n')}`);
});

test('학과가 생기기 전 학번의 전과생은 요건을 내되 "추정"으로 표시한다(예: 2022학번 → 2023년 신설 경영학과)', async () => {
  const departments = await studentService.listDepartments();
  const d = departments.find((x) => x.name === '경영학과');
  const regulation = await resolveRequirementsForStudent(inputFromStudentRow({ department_id: d.id, department_name: d.name, admission_year: 2022, enrollment_type: 'MAJOR_CHANGE', major_change_grade: 2, major_change_year: 2023, major_change_semester: 1 }));
  const rule = regulation.rules.find((r) => r.id === 'REQUIREMENTS');
  assert.equal(rule.confidence, 'ESTIMATED');
  assert.ok(rule.flags.some((f) => f.code === 'MAJOR_CHANGE_COHORT_BEFORE_DEPARTMENT'));
  const credits = Object.fromEntries(rule.value.categories.map((c) => [c.category, c.requiredCredits]));
  assert.equal(credits['교양필수'] + credits['교양선택'], 39, '2022학번 경영대 교양(학번별 표)');
  assert.equal(rule.value.totalRequiredCredits, 130);
  assert.ok(rule.value.certifications.some((c) => c.category === '졸업논문'), '졸업논문은 학과 기준으로 남는다');

  // 학과가 이미 있던 학번(2023)은 예전과 같다 — 확정, 추정 플래그 없음
  const own = await resolveRequirementsForStudent(inputFromStudentRow({ department_id: d.id, department_name: d.name, admission_year: 2023, enrollment_type: 'MAJOR_CHANGE', major_change_grade: 2, major_change_year: 2024, major_change_semester: 1 }));
  assert.ok(!own.rules.find((r) => r.id === 'REQUIREMENTS').flags.some((f) => f.code === 'MAJOR_CHANGE_COHORT_BEFORE_DEPARTMENT'));
});
