const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guardAnswer, NOTICE } = require('../services/answerGuard');

/**
 * server/test/answerGuard.test.js
 * AI 응답 후처리 가드(D-49): 확정이 아닌 판단인데 단서 표현이 전혀 없는 답변에만 안내문을 덧붙인다. 답변 본문은 바꾸지 않는다. AI 호출 없음.
 */

const j = (confidence) => ({ confidence });

test('확정 판단·판단 없음: 답변을 건드리지 않는다', () => {
  assert.deepEqual(guardAnswer('졸업학점은 130학점입니다.', j('CONFIRMED')), { answer: '졸업학점은 130학점입니다.', guarded: false, reason: null });
  assert.equal(guardAnswer('졸업학점은 130학점입니다.', null).guarded, false);
  assert.equal(guardAnswer('졸업학점은 130학점입니다.', undefined).guarded, false);
});

test('추정/자료 불충분/자료없음인데 단서가 전혀 없으면 신뢰도별 안내문을 덧붙인다(본문은 그대로)', () => {
  for (const c of ['ESTIMATED', 'INSUFFICIENT', 'NO_DATA']) {
    const r = guardAnswer('2022학번은 반드시 이 과목을 이수해야 합니다.', j(c));
    assert.equal(r.guarded, true, c);
    assert.ok(r.answer.startsWith('2022학번은 반드시 이 과목을 이수해야 합니다.'), '본문 보존');
    assert.ok(r.answer.endsWith(NOTICE[c]), c);
    assert.match(r.answer, /학사지원과\(063-850-5228\)/);
  }
});

test('지시를 지킨 답변(단서 표현 포함)은 덧붙이지 않는다 — 오탐 방지', () => {
  const hedged = [
    '이 내용은 추정이에요. 학과에 확인해 주세요.',
    '정확한 기준은 학사지원과(063-850-5228)에서 확인하실 수 있어요.',
    '확정된 것은 아니라서 학과 확인이 필요해요.',
    '자료가 없어서 단정할 수 없어요.',
    '이 항목은 확인되지 않았어요.',
    '이 부분은 학과에 문의해 보세요.',
    '해당 자료가 부족해 정확히 말씀드리기 어려워요.',
    '확정할 수 없는 항목이라 단정하기 어렵습니다.',
  ];
  for (const text of hedged) assert.equal(guardAnswer(text, j('ESTIMATED')).guarded, false, text);
});

test('단서 없는 단정 답변 표본은 모두 가드된다(미탐 확인)', () => {
  const assertive = ['졸업학점은 130학점입니다.', '그 과목은 면제됩니다.', '2022학번은 52학점까지 인정돼요.', '필수 과목이에요. 꼭 들어야 해요.'];
  for (const text of assertive) assert.equal(guardAnswer(text, j('INSUFFICIENT')).guarded, true, text);
});

test('빈 답변·문자열이 아닌 값은 건드리지 않는다', () => {
  assert.equal(guardAnswer('', j('ESTIMATED')).guarded, false);
  assert.equal(guardAnswer('   ', j('ESTIMATED')).guarded, false);
  assert.equal(guardAnswer(null, j('ESTIMATED')).guarded, false);
});

test('알 수 없는 신뢰도 값이면 건드리지 않는다', () => {
  assert.equal(guardAnswer('답변입니다.', j('WEIRD')).guarded, false);
});

// 학칙 [별표 4]와 책자의 졸업학점이 다른 학생(예: 간호학과 2023학번 — 별표 4 ③표 130, 책자 140)의 판단 모양.
const mismatch = {
  confidence: 'ESTIMATED',
  requirements: { rules: [{ id: 'REQUIREMENTS', value: { schedule4: { match: false, schedule4Credits: 130, bookCredits: 140 } } }] },
};

test('졸업학점이 두 자료에서 다른데 한 값만 말하면(단서 표현이 있어도) 두 값을 밝히는 안내를 덧붙인다 — 이슈 #304 1번', () => {
  // 실제로 나온 답변: "확인 필요 사항" 소제목 때문에 기존 단서 검사는 통과했지만 본문은 "일치"로 단정했다.
  const answer = '교육과정 책자 기준: 140학점\n신뢰도 및 확인 필요 사항\n\n두 자료가 일치합니다. 2023학번 간호학과의 졸업학점은 140학점입니다.';
  const r = guardAnswer(answer, mismatch);
  assert.equal(r.guarded, true);
  assert.ok(r.answer.startsWith(answer), '본문 보존');
  assert.match(r.answer, /130학점/);
  assert.match(r.answer, /140학점/);
  assert.match(r.answer, /학사지원과\(063-850-5228\)/);
});

test('두 값을 모두 밝힌 답변이나 졸업학점을 말하지 않은 답변은 덧붙이지 않는다', () => {
  const both = '학칙 [별표 4]는 130학점, 교육과정 책자는 140학점으로 서로 달라요. 학사지원과에 확인해 주세요.';
  assert.equal(guardAnswer(both, mismatch).guarded, false);
  const unrelated = '수강신청은 학기 시작 전 정해진 기간에 해요. 정확한 일정은 학사지원과에 확인해 주세요.';
  assert.equal(guardAnswer(unrelated, mismatch).guarded, false);
});

test('영어 답변도 같은 기준(credits)으로 본다', () => {
  const one = 'Your graduation requirement is 140 credits. Please confirm with the Academic Affairs Office (학사지원과).';
  const r = guardAnswer(one, mismatch, 'en');
  assert.equal(r.guarded, true);
  assert.match(r.answer, /130 credits/);
  const both = 'The regulations list 130 credits while the curriculum booklet lists 140 credits. Please confirm with the Academic Affairs Office.';
  assert.equal(guardAnswer(both, mismatch, 'en').guarded, false);
});

const { removeUnverifiedPhoneNumbers, PHONE_REMOVED_NOTICE } = require('../services/answerGuard');

test('근거에 없는 전화번호는 지우고 부서명은 남긴다 — 2026-10-15 점검에서 "학사지원과(063-850-5092)"를 지어냈다', () => {
  const r = removeUnverifiedPhoneNumbers('학과 또는 **학사지원과(063-850-5092)**에 확인하시기 바랍니다.', ['규정 원문']);
  assert.deepEqual(r.removed, ['063-850-5092']);
  assert.ok(r.answer.startsWith('학과 또는 **학사지원과**에 확인하시기 바랍니다.'), r.answer);
  assert.ok(r.answer.endsWith(PHONE_REMOVED_NOTICE.ko));
  assert.ok(!r.answer.includes('5092'));
});

test('근거 문서나 코드에 있는 번호는 그대로 둔다(학사지원과 5228, 근거의 교육혁신과 5757)', () => {
  const text = '학사지원과(063-850-5228) 또는 교육혁신과 063-850-5757로 문의하세요.';
  const r = removeUnverifiedPhoneNumbers(text, ['담당부서: 교육혁신과(교육과정·졸업요건 설정, 063-850-5757)']);
  assert.deepEqual(r, { answer: text, removed: [] });
});

test('쉼표 뒤 번호·괄호 없는 번호도 지우고, 번호가 없는 답변은 건드리지 않는다', () => {
  assert.ok(removeUnverifiedPhoneNumbers('(학사지원과, 063-850-1234)로 연락', []).answer.startsWith('(학사지원과)로 연락'));
  assert.ok(removeUnverifiedPhoneNumbers('학생지원센터 063 850 1234로 연락', []).answer.startsWith('학생지원센터로 연락'));
  const plain = '2025-2026학년도 기준 130학점이에요.';
  assert.deepEqual(removeUnverifiedPhoneNumbers(plain, []), { answer: plain, removed: [] });
});

test('영어 답변에는 영어 안내문을 붙인다', () => {
  const r = removeUnverifiedPhoneNumbers('Contact the Academic Affairs Office (063-850-9999).', [], 'en');
  assert.ok(r.answer.startsWith('Contact the Academic Affairs Office.'), r.answer);
  assert.ok(r.answer.endsWith(PHONE_REMOVED_NOTICE.en));
});

const { guardJudgmentFor } = require('../services/answerGuard');

test('본인 졸업요건 질문은 진단 신뢰도로 안내문을 정한다 — 진단이 확정이면 판단이 추정이어도 붙이지 않는다(2026-10-17)', () => {
  const regulationJudgment = { judgment: { confidence: 'ESTIMATED' }, subject: { hypothetical: false } };
  assert.equal(guardJudgmentFor(regulationJudgment, 'CONFIRMED', { requirement: true }).confidence, 'CONFIRMED');
  // 경과조치·이력·비교 질문, 다른 학번·학과를 가정한 질문은 판단 신뢰도 그대로
  assert.equal(guardJudgmentFor(regulationJudgment, 'CONFIRMED', { requirement: true, history: true }).confidence, 'ESTIMATED');
  assert.equal(guardJudgmentFor({ ...regulationJudgment, subject: { hypothetical: true } }, 'CONFIRMED', { requirement: true }).confidence, 'ESTIMATED');
  assert.equal(guardJudgmentFor(regulationJudgment, 'CONFIRMED', {}).confidence, 'ESTIMATED');
  // 요건 단어 없이 학점을 묻는 비교 질문도 본인 요건 질문이다. 과목 경과조치 질문은 판단 신뢰도 그대로.
  assert.equal(guardJudgmentFor(regulationJudgment, 'CONFIRMED', { compare: true }, '3학년 때 전과했는데 전공 학점 기준이 일반 학생이랑 달라?').confidence, 'CONFIRMED');
  assert.equal(guardJudgmentFor(regulationJudgment, 'CONFIRMED', { requirement: false }, '폐지된 전공 과목은 안 들어도 돼?').confidence, 'ESTIMATED');
  assert.equal(guardJudgmentFor(null, 'CONFIRMED', { requirement: true }), null);
});
