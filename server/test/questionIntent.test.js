const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuestionAnalysis, buildYearContextNote } = require('../services/aiClient');
const { resolveYearContext } = require('../services/yearContext');
const { resolveOfferingTargets } = require('../services/curriculumService');

// DB·외부 API 없이 도는 테스트. 오늘은 2026-10-11(2026학년도 2학기 중)로 고정 — 다음 정규 학기는 2027-1, 2027-2.
const TODAY = '2026-10-11';
const ctx = (message, questionIntent, extra = {}) =>
  resolveYearContext({ message, profileCohort: 2022, availableBookYears: [2022, 2023, 2024, 2025, 2026], today: TODAY, questionIntent, ...extra });

const PLANNING_MESSAGE = '내가 들은 과목을 제외하고 1학기에 12학점, 2학기에 6학점을 들어야 하는데 졸업인증제를 제외하고 들을만한 과목이 있을까?';

// ── 분류 응답 파싱 ──────────────────────────────────────────────────────────────

test('parseQuestionAnalysis: 정상 JSON', () => {
  const r = parseQuestionAnalysis('{"searchQuery": "수강 계획", "intent": "NEXT_TERM_PLANNING"}', '원문');
  assert.deepEqual(r, { searchQuery: '수강 계획', intent: 'NEXT_TERM_PLANNING' });
});

test('parseQuestionAnalysis: 코드블록·앞뒤 설명이 붙어도 JSON을 꺼낸다', () => {
  const r = parseQuestionAnalysis('```json\n{"searchQuery":"개설 과목","intent":"CURRENT_OFFERINGS"}\n```', '원문');
  assert.deepEqual(r, { searchQuery: '개설 과목', intent: 'CURRENT_OFFERINGS' });
});

test('parseQuestionAnalysis: 모르는 intent는 DEFAULT, 빈 searchQuery는 원문', () => {
  assert.deepEqual(parseQuestionAnalysis('{"searchQuery":"x","intent":"WHATEVER"}', '원문'), { searchQuery: 'x', intent: 'DEFAULT' });
  assert.deepEqual(parseQuestionAnalysis('{"searchQuery":"  ","intent":"NEXT_TERM_PLANNING"}', '원문'), { searchQuery: '원문', intent: 'NEXT_TERM_PLANNING' });
});

test('parseQuestionAnalysis: JSON이 아닌 문장(옛 재작성 방식)은 검색어로만 쓰고, 빈 응답·깨진 JSON은 원문 + DEFAULT', () => {
  assert.deepEqual(parseQuestionAnalysis('복수전공 신청 방법', '복전'), { searchQuery: '복수전공 신청 방법', intent: 'DEFAULT' });
  assert.deepEqual(parseQuestionAnalysis('', '원문'), { searchQuery: '원문', intent: 'DEFAULT' });
  assert.deepEqual(parseQuestionAnalysis('{"searchQuery": "깨짐", intent', '원문'), { searchQuery: '{"searchQuery": "깨짐", intent', intent: 'DEFAULT' });
  assert.deepEqual(parseQuestionAnalysis('{searchQuery: nope}', '원문'), { searchQuery: '원문', intent: 'DEFAULT' });
});

// ── 연도 계산(코드): 모델은 의도만 정하고 학년도는 오늘 날짜로 정한다 ─────────────────────────

test('NEXT_TERM_PLANNING: 연도 표현이 없으면 앞으로 들을 두 학기가 속한 학년도(2027)가 개설 조회 연도가 된다', () => {
  const y = ctx(PLANNING_MESSAGE, 'NEXT_TERM_PLANNING');
  assert.equal(y.questionIntent, 'NEXT_TERM_PLANNING');
  assert.deepEqual(y.offeringYears, [2027]);
  // 학번 기준 조회(요건·이수구분)는 그대로 프로필 학번
  assert.equal(y.mode, 'COHORT');
  assert.deepEqual(y.targetYears, [2022]);
});

test('NEXT_TERM_PLANNING: 8월(1학기 기간)이면 같은 해 2학기와 다음 해 1학기가 걸친다', () => {
  const y = ctx(PLANNING_MESSAGE, 'NEXT_TERM_PLANNING', { today: '2026-08-20' });
  assert.deepEqual(y.offeringYears, [2026, 2027]);
});

test('CURRENT_OFFERINGS: 현재 학기가 속한 학년도', () => {
  assert.deepEqual(ctx('지금 열려 있는 과목 알려줘', 'CURRENT_OFFERINGS').offeringYears, [2026]);
  // 1~2월은 직전 학년도 2학기
  assert.deepEqual(ctx('지금 열려 있는 과목 알려줘', 'CURRENT_OFFERINGS', { today: '2027-01-20' }).offeringYears, [2026]);
});

test('질문에 학년도·학번이 있으면 분류는 무시된다(명시한 연도가 우선)', () => {
  const withYear = ctx('2025학년도에 들을만한 과목 있었어?', 'NEXT_TERM_PLANNING');
  assert.equal(withYear.questionIntent, 'DEFAULT');
  assert.deepEqual(withYear.offeringYears, []);
  const withCohort = ctx('23학번인데 다음 학기에 뭐 들을까?', 'NEXT_TERM_PLANNING');
  assert.equal(withCohort.questionIntent, 'DEFAULT');
  assert.deepEqual(withCohort.offeringYears, []);
});

test('직전 질문에서 연도를 이어받는 후속 질문에도 분류는 적용되지 않는다', () => {
  const y = ctx('그럼 거기서 왜 그래?', 'NEXT_TERM_PLANNING', { previousUserMessage: '2024학년도 졸업요건 알려줘' });
  assert.equal(y.inheritedFromPrevious, true);
  assert.equal(y.questionIntent, 'DEFAULT');
});

test('DEFAULT/미지정이면 기존 동작과 같다(개설 연도 없음)', () => {
  assert.deepEqual(ctx(PLANNING_MESSAGE, 'DEFAULT').offeringYears, []);
  const noIntent = resolveYearContext({ message: PLANNING_MESSAGE, profileCohort: 2022, availableBookYears: [2026], today: TODAY });
  assert.equal(noIntent.questionIntent, 'DEFAULT');
  assert.deepEqual(noIntent.offeringYears, []);
});

// ── 개설 조회 대상 결정 ──────────────────────────────────────────────────────────

test('resolveOfferingTargets: 분류된 계획 질문은 학기 조건 없이(질문 속 "1학기·2학기"는 계획의 일부) 두 학기를 다 본다', () => {
  const t = resolveOfferingTargets(PLANNING_MESSAGE, ctx(PLANNING_MESSAGE, 'NEXT_TERM_PLANNING'));
  assert.deepEqual(t, { years: [2027], semester: null, fromClassification: true });
});

test('resolveOfferingTargets: 분류된 현재 개설 질문은 질문의 학기를 따른다(2학기 → 코드 3)', () => {
  const m = '이번 2학기에 개설된 과목 뭐 있어?';
  assert.deepEqual(resolveOfferingTargets(m, ctx(m, 'CURRENT_OFFERINGS')), { years: [2026], semester: 3, fromClassification: true });
});

test('resolveOfferingTargets: 질문에 직접 나온 학년도가 분류보다 우선', () => {
  const m = '2025학년도 2학기에 개설된 과목 알려줘';
  assert.deepEqual(resolveOfferingTargets(m, ctx(m, 'NEXT_TERM_PLANNING')), { years: [2025], semester: 3, fromClassification: false });
});

test('resolveOfferingTargets: 연도도 분류도 없으면 조회하지 않는다(기존 동작)', () => {
  assert.equal(resolveOfferingTargets(PLANNING_MESSAGE, ctx(PLANNING_MESSAGE, 'DEFAULT')), null);
  assert.equal(resolveOfferingTargets('졸업요건 알려줘', ctx('졸업요건 알려줘', 'DEFAULT')), null);
});

test('resolveOfferingTargets: 요건 질문에 연도가 있어도 개설 의도가 없으면 조회하지 않는다(기존 동작 유지)', () => {
  const m = '2024학년도 졸업요건 알려줘';
  assert.equal(resolveOfferingTargets(m, ctx(m, 'DEFAULT')), null);
});

// ── 모델에게 알리는 문구 ─────────────────────────────────────────────────────────

test('buildYearContextNote: 분류된 계획 질문이면 개설 이력 기준·참고용 안내·권장 학년 문구가 들어가고, DEFAULT면 안 들어간다', () => {
  const planning = buildYearContextNote(ctx(PLANNING_MESSAGE, 'NEXT_TERM_PLANNING'));
  assert.match(planning, /앞으로 들을 과목·학기 계획을 묻는다/);
  assert.match(planning, /개설 기준 참고용/);
  assert.match(planning, /권장 학년일 뿐/);
  const current = buildYearContextNote(ctx('지금 열려 있는 과목 알려줘', 'CURRENT_OFFERINGS'));
  assert.match(current, /지금\(올해\) 개설된 과목을 묻는다/);
  const plain = buildYearContextNote(ctx(PLANNING_MESSAGE, 'DEFAULT'));
  assert.doesNotMatch(plain, /앞으로 들을 과목·학기 계획/);
  assert.doesNotMatch(plain, /지금\(올해\) 개설된 과목/);
});
