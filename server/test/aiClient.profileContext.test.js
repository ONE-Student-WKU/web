const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSystemPrompt } = require('../services/aiClient');

/**
 * server/test/aiClient.profileContext.test.js
 * 챗봇이 학생이 입력한 프로필(전과·편입·휴학·교직·다전공)과 적용한 특례를 받는지(2026-10-17 로컬 재현).
 * 예전에는 학과·학번·입학유형만 넘겨서 "전과 시점을 알려 주세요", "인정학점이 기록돼 있지 않다", "휴학 기록을 찾을 수 없다"고 되묻고,
 * 3학년 전과 완화를 "최소전공 기준을 적용하지 않는다"처럼 거꾸로 설명했다.
 */

const base = { admission_year: 2024, department_name: '경영학과', enrollment_type: 'GENERAL', leave_periods: '[]', leave_semesters: 0, teaching_course: null };

function status({ adjustments = [], baseline = null, major = 66, confidence = 'CONFIRMED', totalRequired = 130 } = {}) {
  return {
    totalEarnedCredits: 20,
    totalRequiredCredits: totalRequired,
    categories: [
      { category: '교양필수', earnedCredits: 2, requiredCredits: 5 },
      { category: '전공', earnedCredits: 9, requiredCredits: major },
      { category: '일반선택', earnedCredits: 0, requiredCredits: 25 },
    ],
    certifications: [],
    regulation: { confidence, confidenceLabel: confidence === 'CONFIRMED' ? '확정' : '추정', flags: [], adjustments, baseline },
  };
}

test('전과생: 전과 시점·학년·인정 신청을 프로필로 넘기고 다시 묻지 말라고 한다', () => {
  const student = { ...base, enrollment_type: 'MAJOR_CHANGE', major_change_year: 2025, major_change_semester: 1, major_change_grade: 2, major_change_recognition: 0 };
  const p = buildSystemPrompt(student, status());
  assert.match(p, /전과: 2025학년도 1학기, 2학년 때 전과/);
  assert.match(p, /전공학점 인정 신청: 안 했음/);
  assert.match(p, /다시 묻지 말고/);
  assert.doesNotMatch(p, /전과 시점·학년을 입력 안 함/);
});

test('전과 시점을 입력하지 않은 전과생은 입력 안 함으로 적어 그것만 묻게 한다', () => {
  const p = buildSystemPrompt({ ...base, enrollment_type: 'MAJOR_CHANGE' }, status());
  assert.match(p, /전과: 전과 시점·학년을 입력 안 함/);
});

test('3학년 전과 완화는 "일반 학생 66학점 → 51학점"처럼 숫자로 설명하고 부정형으로 쓰지 않는다', () => {
  const student = { ...base, enrollment_type: 'MAJOR_CHANGE', major_change_year: 2026, major_change_semester: 1, major_change_grade: 3 };
  const p = buildSystemPrompt(student, status({ adjustments: ['MAJOR_RELAXATION', 'GENERAL_ELECTIVE_REBALANCE'], baseline: { majorCredits: 66, liberalCredits: 39 }, major: 51 }));
  assert.match(p, /3학년 때 전과해서 전공은 같은 학과·학번 일반 학생 66학점 → 이 학생 51학점만 채우면 된다/);
  assert.match(p, /졸업 총학점은 일반 학생과 같다/);
  assert.match(p, /부정형으로 규칙을 설명하지 마라/);
});

test('1·2학년 전과는 전공 기준이 일반 학생과 같다고 적는다', () => {
  const student = { ...base, enrollment_type: 'MAJOR_CHANGE', major_change_year: 2025, major_change_semester: 1, major_change_grade: 2 };
  const p = buildSystemPrompt(student, status());
  assert.match(p, /2학년 때 전과해서 전공 기준은 일반 학생과 같은 66학점이다/);
});

test('편입생: 편입 학년과 직접 입력한 인정학점을 넘긴다', () => {
  const student = { ...base, enrollment_type: 'TRANSFER_ADMISSION', transfer_grade: 3, transfer_recognized_credits: 65 };
  const p = buildSystemPrompt(student, status({ adjustments: ['MAJOR_RELAXATION', 'TRANSFER_LIBERAL_DEEMED', 'TRANSFER_RECOGNIZED_CREDITS'], baseline: { majorCredits: 66, liberalCredits: 39 }, major: 51, totalRequired: 65 }));
  assert.match(p, /편입: 3학년으로 편입, 편입 때 인정받은 학점 65학점\(학생 입력\)/);
  assert.match(p, /편입 때 인정받은 65학점\(학생 입력\)을 졸업학점에서 빼고, 본교에서 65학점을/);
  assert.match(p, /종교와원불교"만 따로/);
});

test('휴학 기간·교직·다전공을 프로필로 넘긴다', () => {
  const student = {
    ...base,
    leave_periods: JSON.stringify([{ startYear: 2025, startSemester: 1, semesters: 2 }]),
    teaching_course: 1,
    second_department_id: 39, second_department_name: '식품영양학과', second_major_type: 'MINOR',
  };
  const p = buildSystemPrompt(student, status());
  assert.match(p, /휴학: 2025학년도 1학기~2025학년도 2학기\(2학기\)/);
  assert.match(p, /교직과정: 이수 중/);
  assert.match(p, /다전공: 부전공 식품영양학과/);
});

test('휴학 종류는 모르므로 가사휴학 전제를 밝히고 답한 뒤 다른 종류는 한도 표로 보여준다(전제 없이 단정하던 문제, 2026-10-23)', () => {
  const student = { ...base, leave_periods: JSON.stringify([{ startYear: 2024, startSemester: 1, semesters: 4 }]), leave_semesters: 4 };
  const p = buildSystemPrompt(student, status());
  assert.match(p, /휴학 종류\(가사·질병, 입대\(군\), 창업, 임신·출산·육아 등\)는 이 서비스가 받지 않아 모른다/);
  assert.match(p, /가장 흔한 가사휴학이라는 전제를 먼저 밝히고/);
  assert.match(p, /짧은 마크다운 표\(휴학 종류 \| 한도 \| 가사휴학 한도에 세는지\)로 반드시 보여준다/);
  assert.match(p, /남은 학기 = 근거 문서의 가사휴학 한도 − 위 프로필의 "지금까지 휴학한 학기" 합계다/);
  assert.match(p, /종류마다 이 학생의 남은 학기를 따로 계산해 늘어놓지 마라/);
  assert.match(p, /답하기 전에 종류부터 되묻지 마라/);
  assert.match(p, /휴학: 2024학년도 1학기~2025학년도 2학기\(4학기\) — 지금까지 휴학한 학기는 모두 4학기/); // 끝 학기와 합계를 적어 잘못 읽거나 잘못 빼지 않게
});

test('교직 질문에 답하지 않았으면(교직이 없는 학과 등) 교직 줄을 넣지 않는다', () => {
  assert.doesNotMatch(buildSystemPrompt(base, status()), /교직과정:/);
});

test('진단이 확정이면 졸업요건 숫자에 "추정"을 붙이지 말라고 한다', () => {
  const p = buildSystemPrompt(base, status());
  assert.match(p, /이 진단의 요건 신뢰도는 "확정"이다/);
  assert.match(p, /졸업요건 숫자에 "추정"을 붙이지 마라/);
});

test('추정 이유는 목록에 있는 것만 말하게 한다', () => {
  const p = buildSystemPrompt(base, status({ confidence: 'ESTIMATED' }));
  assert.match(p, /목록에 없는 이유를 지어내지 마라/);
});

test('학생을 "당신"이라고 부르지 말라고 한다', () => {
  assert.match(buildSystemPrompt(null, null), /"당신"이라고 부르지 마라/);
});

test('3학년 전과인데 학과에 줄어든 기준 자료가 없으면(의약계열 등) "같다"가 아니라 "자료가 없어 일반 기준으로 계산"이라고 적는다', () => {
  const student = { ...base, department_name: '의예과', enrollment_type: 'MAJOR_CHANGE', major_change_year: 2026, major_change_semester: 1, major_change_grade: 3 };
  const p = buildSystemPrompt(student, status({ confidence: 'ESTIMATED' }));
  assert.match(p, /3학년 때 전과해서 원래 전공 학점이 일반 학생보다 줄어들지만, 이 학과는 줄어든 기준 자료가 없어/);
  assert.doesNotMatch(p, /전공 기준은 일반 학생과 같은/);
});

test('예과 학생은 "졸업까지"가 아니라 "예과 이수까지"로 넘기고, 진급은 단정하지 말라고 한다(MODELING_AUDIT M-02)', () => {
  const premed = buildSystemPrompt({ ...base, department_name: '의예과' }, { ...status({ totalRequired: 80 }), premedTo: '의학과' });
  assert.match(premed, /예과 이수까지 \d+학점 남음/);
  assert.doesNotMatch(premed, /졸업까지 \d+학점 남음/);
  assert.match(premed, /본과 의학과 진급 전 단계/);
  const general = buildSystemPrompt(base, { ...status(), premedTo: null });
  assert.match(general, /졸업까지 \d+학점 남음/);
  assert.doesNotMatch(general, /예과 학생이다/);
});
