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
