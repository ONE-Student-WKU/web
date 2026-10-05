const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractAskedYears, extractCohorts, detectIntents, resolveBookYear, resolveYearContext } = require('../services/yearContext');

/**
 * server/test/yearContext.test.js
 * 질문 속 연도(학번 vs 학년도, 여러 개, 비교, 변경 이력, 후속 질문)를 어떻게 해석하는지 검증하는 순수 함수 테스트.
 */

const BOOKS = [2024, 2025, 2026];
const ctx = (message, extra = {}) => resolveYearContext({ message, availableBookYears: BOOKS, ...extra });

test('학년도는 질문에 나온 것을 전부 읽는다(예전엔 첫 번째만)', () => {
  assert.deepEqual(extractAskedYears('2020학년도와 2026학년도의 졸업요건'), [2020, 2026]);
  assert.deepEqual(extractAskedYears('2022년에 들을 수 있었던 과목'), [2022]);
  assert.deepEqual(extractAskedYears('2024학년도 2024학년도'), [2024], '중복은 합친다');
});

test('"2022학년도"의 끝 숫자가 학년으로 읽히지 않고, 학번과 학년도는 구분된다', () => {
  assert.deepEqual(extractAskedYears('2학년 2학기 과목'), []);
  assert.deepEqual(extractCohorts('2022학년도 졸업요건'), []);
  assert.deepEqual(extractCohorts('나는 21학번이고 2019학번 선배는'), [2021, 2019]);
});

test('내 학번 질문: "나는 2021학번인데 졸업요건이 뭐야?" → 2021학번 기준', () => {
  const c = ctx('나는 2021학번인데 졸업요건이 뭐야?');
  assert.equal(c.mode, 'COHORT');
  assert.deepEqual(c.targetYears, [2021]);
  assert.equal(c.applicableCohort, 2021);
  assert.deepEqual(c.bookYears, [2024], '2021 책자가 없으면 그 뒤 가장 가까운 책자');
});

test('프로필 학번: 질문에 연도가 없으면 프로필 학번을 쓴다', () => {
  const c = ctx('내 졸업요건이 뭐야?', { profileCohort: 2018 });
  assert.equal(c.mode, 'COHORT');
  assert.deepEqual(c.targetYears, [2018]);
  assert.equal(c.cohortSource, 'profile');
});

test('질문의 학번이 프로필 학번보다 우선한다', () => {
  const c = ctx('2021학번 졸업요건', { profileCohort: 2024 });
  assert.equal(c.applicableCohort, 2021);
  assert.equal(c.cohortSource, 'message');
});

test('특정 학년도: "2024학년도 졸업요건" → 그 해만, 학생 학번은 따로 유지', () => {
  const c = ctx('2024학년도 졸업요건이 뭐야?', { profileCohort: 2021 });
  assert.equal(c.mode, 'SPECIFIC_YEAR');
  assert.deepEqual(c.targetYears, [2024]);
  assert.deepEqual(c.bookYears, [2024]);
  assert.equal(c.applicableCohort, 2021);
});

test('연도 비교: "2020학년도와 2026학년도의 졸업요건이 어떻게 달라?" → 두 해를 각각', () => {
  const c = ctx('2020학년도와 2026학년도의 졸업요건이 어떻게 달라?', { profileCohort: 2024 });
  assert.equal(c.mode, 'COMPARE');
  assert.deepEqual(c.targetYears, [2020, 2026]);
  assert.deepEqual(c.bookYears, [2024, 2026]);
});

test('적용 여부: "나는 2021학번인데 2026학년도 기준으로 판단해도 돼?" → 2021과 2026을 함께', () => {
  const c = ctx('나는 2021학번인데 현재 2026학년도 교육과정을 기준으로 졸업요건을 판단해도 돼?');
  assert.equal(c.mode, 'COMPARE');
  assert.deepEqual(c.targetYears, [2021, 2026]);
  assert.equal(c.applicableCohort, 2021);
});

test('변경 이력: "졸업학점이 언제 바뀌었어?"는 학생 학번 + 최신 책자', () => {
  const c = ctx('졸업학점이 언제 바뀌었어?', { profileCohort: 2018 });
  assert.equal(c.mode, 'HISTORY');
  assert.deepEqual(c.targetYears, [2018]);
  assert.deepEqual(c.bookYears, [2024, 2026]);
});

test('변경 이력 표현들', () => {
  for (const q of ['A과목은 언제 없어졌어?', '예전에는 필수였는데 지금도 필수야?', '2018학년도에는 이 과목이 필수였는데 왜 지금은 선택이야?', '언제부터 선택이 됐어']) {
    assert.ok(detectIntents(q).history, q);
  }
  assert.ok(!detectIntents('1학년 2학기 과목 알려줘').history);
});

test('연도 정보가 전혀 없으면 DEFAULT — 책자는 최신 하나만', () => {
  const c = ctx('졸업요건이 뭐야?');
  assert.equal(c.mode, 'DEFAULT');
  assert.deepEqual(c.targetYears, []);
  assert.deepEqual(c.bookYears, [2026]);
});

test('후속 질문("왜 그래?")은 직전 질문의 연도를 이어받는다', () => {
  const c = ctx('왜 그래?', { previousUserMessage: '나는 2021학번인데 졸업요건이 뭐야?' });
  assert.equal(c.applicableCohort, 2021);
  assert.equal(c.inheritedFromPrevious, true);
  const own = ctx('왜 그래?', { previousUserMessage: '2021학번 졸업요건', profileCohort: 2024 });
  assert.equal(own.applicableCohort, 2021);
});

test('이번 질문에 연도가 있으면 직전 질문의 연도는 무시한다', () => {
  const c = ctx('2025학년도는?', { previousUserMessage: '2021학번 졸업요건' });
  assert.equal(c.inheritedFromPrevious, false);
  assert.deepEqual(c.targetYears, [2025]);
});

test('개설 이력(OFFERING) 의도와 졸업요건 의도를 구분한다', () => {
  assert.ok(detectIntents('2022년에 들을 수 있었던 과목').offering);
  assert.ok(detectIntents('2024학년도 졸업요건').requirement);
  assert.ok(!detectIntents('2024학년도 졸업요건').offering);
});

test('resolveBookYear: 있으면 그 해, 없으면 뒤의 가장 가까운 책자, 그래도 없으면 최신', () => {
  assert.equal(resolveBookYear(2025, BOOKS), 2025);
  assert.equal(resolveBookYear(2018, BOOKS), 2024);
  assert.equal(resolveBookYear(2030, BOOKS), 2026);
  assert.equal(resolveBookYear(2025, []), null);
});

test('관련 없는 새 질문은 직전 질문의 연도를 물려받지 않는다', () => {
  const c = ctx('점심 메뉴 추천해줘', { previousUserMessage: '2025학년도 졸업요건이 뭐야?' });
  assert.equal(c.inheritedFromPrevious, false);
  assert.deepEqual(c.askedYears, []);
  assert.deepEqual(c.explicitAskedYears, []);
});

test('이어받은 학년도는 askedYears에는 있지만 explicitAskedYears에는 없다(개설 이력 조회 오작동 방지)', () => {
  const c = ctx('그럼 이 과목은?', { previousUserMessage: '2025학년도 졸업요건이 뭐야?' });
  assert.equal(c.inheritedFromPrevious, true);
  assert.deepEqual(c.askedYears, [2025]);
  assert.deepEqual(c.explicitAskedYears, []);
});

// --- 기준일(asOfDate, 파트 2) ---
const { extractAsOfDate } = require('../services/yearContext');

// 기존 5개 모드의 대표 질문 — 기준일을 더해도 mode/targetYears/bookYears 등 기존 필드는 그대로여야 한다(회귀 방지).
const MODE_CASES = [
  ['COHORT', '졸업요건이 뭐야?', { profileCohort: 2021 }, [2021]],
  ['SPECIFIC_YEAR', '2024학년도 졸업요건 알려줘', { profileCohort: 2021 }, [2024]],
  ['COMPARE', '2020학년도와 2026학년도의 졸업요건이 어떻게 달라?', {}, [2020, 2026]],
  ['HISTORY', '졸업학점이 언제 바뀌었어?', { profileCohort: 2021 }, [2021]],
  ['DEFAULT', '도서관 위치 알려줘', {}, []],
];
const LEGACY_FIELDS = ['mode', 'askedYears', 'explicitAskedYears', 'messageCohorts', 'profileCohort', 'applicableCohort', 'cohortSource', 'targetYears', 'bookYears', 'latestBookYear', 'intents', 'inheritedFromPrevious'];
const pick = (o) => Object.fromEntries(LEGACY_FIELDS.map((k) => [k, o[k]]));

test('회귀: 기존 5개 모드(COHORT/SPECIFIC_YEAR/COMPARE/HISTORY/DEFAULT)는 기준일 입력과 무관하게 같은 결과', () => {
  for (const [mode, message, extra, targetYears] of MODE_CASES) {
    const plain = ctx(message, extra);
    assert.equal(plain.mode, mode, message);
    assert.deepEqual(plain.targetYears, targetYears, message);
    for (const asOf of [{ asOfDate: '2019-03-02' }, { today: '2030-12-31' }, { asOfDate: 'not-a-date', today: '2026-10-05' }]) {
      assert.deepEqual(pick(ctx(message, { ...extra, ...asOf })), pick(plain), `${mode}: ${JSON.stringify(asOf)}`);
    }
  }
});

test('기준일: 질문의 날짜 > 호출자 지정 > 직전 질문(후속 질문일 때) > 오늘', () => {
  const fromMessage = ctx('2026년 3월 1일 기준 졸업요건', { asOfDate: '2025-01-01', today: '2026-10-05' });
  assert.deepEqual([fromMessage.asOfDate, fromMessage.asOfSource], ['2026-03-01', 'message']);
  const fromCaller = ctx('졸업요건 알려줘', { asOfDate: '2025-09-01', today: '2026-10-05' });
  assert.deepEqual([fromCaller.asOfDate, fromCaller.asOfSource, fromCaller.asOfTerm], ['2025-09-01', 'caller', { year: 2025, semester: 2 }]);
  const followUp = ctx('그럼 전공은?', { previousUserMessage: '2025.9.1 기준 졸업요건', today: '2026-10-05' });
  assert.deepEqual([followUp.asOfDate, followUp.asOfSource], ['2025-09-01', 'previous']);
  const unrelated = ctx('점심 메뉴 추천해줘', { previousUserMessage: '2025.9.1 기준 졸업요건', today: '2026-10-05' });
  assert.deepEqual([unrelated.asOfDate, unrelated.asOfSource], ['2026-10-05', 'today']);
  // 1~2월은 전년도 2학기(학칙 제22조)
  assert.deepEqual(ctx('졸업요건', { today: '2026-02-10' }).asOfTerm, { year: 2025, semester: 2 });
});

test('기준일 추출: 연·월·일이 다 있는 실제 날짜만(학년도·없는 날짜는 아님)', () => {
  assert.equal(extractAsOfDate('2026-03-01부터'), '2026-03-01');
  assert.equal(extractAsOfDate('2025.9.1 기준'), '2025-09-01');
  assert.equal(extractAsOfDate('2026-02-30'), null);
  assert.equal(extractAsOfDate('2024학년도 졸업요건'), null);
  assert.equal(extractAsOfDate('2024년 졸업요건'), null);
});

// --- 보정 라운드 A 2-5(F-6, D-38): 월·일이 붙은 날짜의 연도는 학년도가 아니라 기준일이다 ---

test('날짜 질문: "2024년 3월 1일 기준 …"은 SPECIFIC_YEAR(2024학년도)가 아니라 내 학번(COHORT) + 기준일 — 예전 동작(D-30)에서 의도적으로 바뀐 기대값', () => {
  const r = ctx('2024년 3월 1일 기준 졸업요건 알려줘', { profileCohort: 2022, today: '2026-10-05' });
  assert.deepEqual([r.mode, r.targetYears, r.askedYears, r.asOfDate, r.asOfSource], ['COHORT', [2022], [], '2024-03-01', 'message']);
});

test('날짜 질문: 2022학번이 "2025년 9월 1일 기준으로 내 졸업요건이 뭐였어?" → 2022학번 + 기준일(2025학번 요건을 붙이지 않는다)', () => {
  const r = ctx('2025년 9월 1일 기준으로 내 졸업요건이 뭐였어?', { profileCohort: 2022, today: '2026-10-05' });
  const plain = ctx('내 졸업요건이 뭐였어?', { profileCohort: 2022, today: '2026-10-05' });
  assert.deepEqual([r.mode, r.targetYears, r.asOfDate], ['COHORT', [2022], '2025-09-01']);
  assert.deepEqual(r.bookYears, plain.bookYears, '날짜가 있어도 책자 학년도는 날짜 없는 같은 질문과 같다');
  const dotted = ctx('2025.9.1 기준 졸업요건', { profileCohort: 2022, today: '2026-10-05' });
  assert.deepEqual([dotted.mode, dotted.targetYears, dotted.asOfDate], ['COHORT', [2022], '2025-09-01']);
});

test('날짜와 학년도가 함께 있으면 학년도는 그대로 읽는다 / 월만 있는 "2025년 9월"은 날짜가 아니라 학년도(기존)', () => {
  const both = ctx('2025년 9월 1일 기준으로 2026학년도 졸업요건이 뭐야?', { profileCohort: 2022, today: '2026-10-05' });
  assert.deepEqual([both.askedYears, both.asOfDate], [[2026], '2025-09-01']);
  assert.deepEqual(extractAskedYears('2025년 9월 졸업요건'), [2025]);
  assert.deepEqual(extractAskedYears('2024년 졸업요건과 2025년 3월 1일부터'), [2024]);
  assert.deepEqual(extractAskedYears('2026-03-01 이후 2026학년도'), [2026]);
});

test('날짜 질문의 후속 질문은 날짜를 이어받되 학년도로는 읽지 않는다', () => {
  const r = ctx('그럼 전공은?', { profileCohort: 2022, previousUserMessage: '2025년 9월 1일 기준 졸업요건', today: '2026-10-05' });
  assert.deepEqual([r.askedYears, r.asOfDate, r.asOfSource], [[], '2025-09-01', 'previous']);
});
