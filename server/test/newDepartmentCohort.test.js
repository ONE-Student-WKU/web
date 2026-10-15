const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildNewDepartmentCohortRows } = require('../services/regulationEngine/newDepartmentCohort');

/**
 * server/test/newDepartmentCohort.test.js
 * 학과가 생기기 전 학번의 전과생 행 만들기(#378, A안). 시드 대신 경영학과(2023년 신설)를 흉내 낸 행과 실제 2026 책자 학번별 표를 쓴다.
 * 원칙: 전과생은 옮긴 학과의 "입학 학번" 기준(22학번이 25년에 전과하면 그 학과의 22학번 요건). 책자에 그 학번의 그 학과 줄이 없으니
 *  - 교양·졸업학점은 입학 학번의 학번별 표 값, 전공은 학과 첫 학번 값(추정), 졸업논문·졸업인증제는 학과 기준.
 */

const row = (category, requiredCredits, from, to, extra = {}) => ({
  id: null, category, requiredCredits, description: `${category} ${from}~${to}`, enrollmentType: null, minCourseCount: null,
  minAdmissionYear: from, maxAdmissionYear: to, requiredCourses: [], ...extra,
});

// 경영학과: 2023학번부터 행이 있고, 졸업인증제 행만 2020학번부터 걸쳐 있다(실제 시드와 같은 모양).
const BUSINESS = [
  row('졸업인증제', 0, 2020, 2025, { minCourseCount: 1, requiredCourses: ['전공현장실습', '캡스톤디자인', '사회봉사'] }),
  row('전공필수', 24, 2023, 2025),
  row('전공선택', 42, 2023, 2025),
  row('교양필수', 5, 2023, 2024, { requiredCourses: ['건학이념', '대학생활'] }),
  row('교양선택', 34, 2023, 2024),
  row('일반선택', 25, 2023, 2024),
  row('전공', 51, 2023, 2025, { enrollmentType: 'MAJOR_CHANGE' }),
  row('졸업논문', 0, 2023, 2025, { minCourseCount: 1, requiredCourses: ['졸업(시험·작품)논문'] }),
];

const byCat = (rows, category, enrollmentType = null) => rows.find((r) => r.category === category && (r.enrollmentType || null) === enrollmentType);

test('22학번 → 2023년 신설 학과: 교양·졸업학점은 22학번 표, 전공은 학과 첫 학번(2023) 값', () => {
  const { rows, fallback } = buildNewDepartmentCohortRows(BUSINESS, '경영학과', 2022);
  assert.deepEqual([fallback.firstCohort, fallback.liberalFromTable, fallback.graduationFromTable], [2023, true, true]);
  assert.equal(byCat(rows, '교양필수').requiredCredits, 5);
  assert.deepEqual(byCat(rows, '교양필수').requiredCourses, ['건학이념', '대학생활']);
  assert.equal(byCat(rows, '교양선택').requiredCredits, 34); // 2022~2024학번 경영대 39 = 5 + 34
  assert.equal(byCat(rows, '전공필수').requiredCredits, 24);
  assert.equal(byCat(rows, '전공선택').requiredCredits, 42);
  assert.equal(byCat(rows, '일반선택').requiredCredits, 130 - 39 - 66);
  assert.equal(byCat(rows, '전공', 'MAJOR_CHANGE').requiredCredits, 51); // 3·4학년 전과 최소전공도 첫 학번 값
  assert.ok(byCat(rows, '졸업논문') && byCat(rows, '졸업인증제'), '졸업논문·졸업인증제는 학과 기준으로 남는다');
  assert.ok(rows.every((r) => r.minAdmissionYear === 2022 && r.maxAdmissionYear === 2022), '만든 행은 그 학번에만 적용된다');
});

test('21학번은 21학번 표의 교양(23학점)을 쓴다 — 학과 첫 학번(2023) 교양 39학점을 그대로 쓰지 않는다', () => {
  const { rows } = buildNewDepartmentCohortRows(BUSINESS, '경영학과', 2021);
  assert.equal(byCat(rows, '교양필수').requiredCredits + byCat(rows, '교양선택').requiredCredits, 23);
  assert.equal(byCat(rows, '일반선택').requiredCredits, 130 - 23 - 66);
});

test('학번에 이미 맞는 졸업인증제 행이 있으면 그 행을 쓰고, 같은 행을 두 번 넣지 않는다', () => {
  const { rows } = buildNewDepartmentCohortRows(BUSINESS, '경영학과', 2021);
  assert.equal(rows.filter((r) => r.category === '졸업인증제').length, 1);
});

test('표에서 학과의 대학을 못 찾으면 교양·졸업학점은 첫 학번 값으로 두고 그 사실을 알린다', () => {
  const { rows, fallback } = buildNewDepartmentCohortRows(BUSINESS, '없는학과', 2022, { tables: null });
  assert.deepEqual([fallback.liberalFromTable, fallback.graduationFromTable], [false, false]);
  assert.equal(byCat(rows, '교양선택').requiredCredits, 34);
  assert.equal(byCat(rows, '일반선택').requiredCredits, 25);
});

test('뒤 학번에도 요건 행이 없으면 만들지 않는다(null)', () => {
  assert.equal(buildNewDepartmentCohortRows([row('졸업인증제', 0, 2020, 2025, { minCourseCount: 1 })], '경영학과', 2021), null);
  assert.equal(buildNewDepartmentCohortRows(BUSINESS, '경영학과', 2026), null);
});
