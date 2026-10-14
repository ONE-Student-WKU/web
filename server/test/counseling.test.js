const test = require('node:test');
const assert = require('node:assert/strict');
const { counselingRequirement } = require('../services/counseling');

// 자기계발심층상담 기준(2026 책자 17·18·21쪽, 홈페이지 학사학위수여). 판정은 하지 않는다(DECISIONS D-65).
test('학번·입학 유형별 필요 횟수: 2020학번부터 8, 2016~2019학번 6, 편입생 3, 전과생은 당초 입학 학번', () => {
  const req = (o) => counselingRequirement({ department_name: '경영학과', enrollment_type: 'GENERAL', ...o });
  assert.deepEqual([req({ admission_year: 2020 }).required, req({ admission_year: 2020 }).cohort], [8, 'FROM_2020']);
  assert.deepEqual([req({ admission_year: 2019 }).required, req({ admission_year: 2019 }).cohort], [6, 'BEFORE_2020']);
  assert.deepEqual([req({ admission_year: 2024, enrollment_type: 'TRANSFER_ADMISSION' }).required, req({ admission_year: 2024, enrollment_type: 'TRANSFER_ADMISSION' }).cohort], [3, 'TRANSFER']);
  assert.equal(req({ admission_year: 2019, enrollment_type: 'MAJOR_CHANGE' }).required, 6);
  assert.equal(req({ admission_year: 2023 }).judged, false);
  assert.equal(counselingRequirement({ admission_year: null }), null);
});

test('광역단위 계열전공은 Hug 심층진로상담으로 대체, 일반 학과는 대체 없음', () => {
  assert.equal(counselingRequirement({ admission_year: 2026, department_name: '공학3계열' }).replacement, 'HUG');
  assert.equal(counselingRequirement({ admission_year: 2026, department_name: '간호학과' }).replacement, null);
});
