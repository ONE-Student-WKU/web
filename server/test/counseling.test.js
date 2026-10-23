const test = require('node:test');
const assert = require('node:assert/strict');
const { counselingRequirement } = require('../services/counseling');
const { buildSystemPrompt } = require('../services/aiClient');

// 자기계발심층상담 기준(2026 책자 17·18·21쪽, 홈페이지 학사학위수여). 상담 기록은 읽지 않고, 대부분 채워지므로 충족으로 안내한다(DECISIONS D-81, D-65를 바꿈).
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

test('챗봇: 상담을 부족 요건으로 말하지 않고, 물으면 대부분 채워진다는 설명과 확인 경로를 준다(D-81)', () => {
  const status = {
    totalEarnedCredits: 130, totalRequiredCredits: 130, categories: [], certifications: [],
    counseling: { required: 8, cohort: 'FROM_2020', replacement: null, judged: false },
    regulation: { confidence: 'CONFIRMED', confidenceLabel: '확정', flags: [] },
  };
  const prompt = buildSystemPrompt(null, status, null);
  assert.match(prompt, /자기계발심층상담: 2020학번부터 기준 8학기\(회\) 이상/);
  assert.match(prompt, /부족 요건으로 말하지 마라/);
  assert.match(prompt, /웹정보서비스 → 상담관리 → 지도교수 상담/);
  assert.doesNotMatch(prompt, /학교에 확인 중이니/);
});
