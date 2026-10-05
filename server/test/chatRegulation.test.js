const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { formatJudgmentChunks, REGULATION_QUESTION_RE } = require('../services/regulationContextService');
const { assembleStructuredChunks, mergeChunks } = require('../services/chatContextService');
const { buildSystemPrompt } = require('../services/aiClient');
const { resolveYearContext } = require('../services/yearContext');

/**
 * server/test/chatRegulation.test.js
 * 챗봇 ↔ 규정 판단 엔진 연결(파트 3): 판단 결과가 최우선 근거로 들어가는지, 신뢰도별 답변 지침(단정 금지)이 근거에 실리는지,
 * RAG와 겹치는 조문을 어떻게 다루는지. AI 호출 없이 근거 조립(assembleStructuredChunks/mergeChunks)까지만 본다.
 * 앞쪽 테스트는 순수(가짜 판단 객체), 뒤쪽은 로컬 시드 DB(+ seed:regulation-articles) 전제.
 */

const D = {};
before(async () => {
  const [depts] = await pool.query('SELECT id, name FROM departments');
  for (const d of depts) D[d.name] = d.id;
});
after(async () => {
  await pool.end();
});

const SUBJECT = { departmentName: '테스트학과', cohort: 2023, enrollmentType: 'GENERAL', hypothetical: false };
const rule = (over) => ({
  ruleCode: 'ENF5_CURRICULUM_AT_ADMISSION', scope: 'COHORT_ONLY', status: 'APPLIES', reason: '입학 학번 교육과정 기준', effect: '입학 당시 기준',
  critical: true, confidence: 'CONFIRMED', confidenceLabel: '확정', basis: { articleRef: 'ENFORCEMENT_RULES:제5조', paragraph: null }, details: null, alternatives: [], flags: [], ...over,
});
const judgment = (over) => ({
  input: { asOfDate: '2026-10-05' }, department: { id: 1, name: '테스트학과' }, confidence: 'CONFIRMED', confidenceLabel: '확정',
  rules: [rule()], history: { years: [] }, flags: [], ...over,
});

test('판단 청크: 신뢰도별 답변 지침 — 확정만 단정 허용, 나머지는 단정 금지 + 학사지원과 안내', () => {
  const confirmed = formatJudgmentChunks(judgment(), SUBJECT)[0];
  assert.match(confirmed.documentTitle, /2023학번 적용 규정 판단 \(신뢰도: 확정\)/);
  assert.match(confirmed.content, /근거 조문을 함께 밝혀 답하라/);
  assert.doesNotMatch(confirmed.content, /단정하지/);

  for (const [confidence, label] of [['ESTIMATED', '추정'], ['INSUFFICIENT', '자료 불충분(확인 필요)'], ['NO_DATA', '자료없음']]) {
    const c = formatJudgmentChunks(judgment({ confidence, confidenceLabel: label }), SUBJECT)[0].content;
    assert.match(c, new RegExp(`전체 신뢰도: ${label.replace(/[()]/g, '\\$&')}`));
    assert.match(c, /단정하지 마|단정하지 말|추정해 답하지 말/, confidence);
    assert.match(c, /학사지원과\(063-850-5228\)/, confidence);
  }
});

test('판단 청크: 적용 안 되는 규칙은 빼고, 조건부·판단 불가는 그대로 표시, 확정이 아닌 플래그는 "확인 필요 사항"으로', () => {
  const j = judgment({
    confidence: 'ESTIMATED', confidenceLabel: '추정',
    rules: [
      rule(),
      rule({ ruleCode: 'ACAD_SCHED4_1_FROM_2026', status: 'NOT_APPLICABLE', basis: { articleRef: 'ACADEMIC_REGULATIONS:별표4-1' } }),
      rule({ ruleCode: 'ACAD_ADD_20260410_SCHED4_BY_GRADUATION', status: 'CONDITIONAL', confidence: 'ESTIMATED', confidenceLabel: '추정', basis: { articleRef: 'ACADEMIC_REGULATIONS:부칙(2026.04.10.)제2조', paragraph: '②' }, reason: '졸업 시기에 따라 갈림' }),
    ],
    flags: [{ code: 'SCHEDULE4_PRE_AMENDMENT_NOT_HELD', level: 'ESTIMATED', message: '개정 전 표는 시스템에 없어요.' }, { code: 'TEXT_SNAPSHOT_MAY_BE_OLDER', level: 'INFO', message: '정보성' }],
  });
  const c = formatJudgmentChunks(j, SUBJECT)[0].content;
  assert.match(c, /\[적용\] 학칙시행규칙 제5조/);
  assert.match(c, /\[조건부\] 학칙 부칙\(2026\.04\.10\.\)제2조 ②/);
  assert.doesNotMatch(c, /별표4-1/);
  assert.match(c, /확인 필요 사항:\n- 개정 전 표는 시스템에 없어요\./);
  assert.doesNotMatch(c, /정보성/);
});

test('판단 청크: C등급 구간의 "기록 없음(검증 안 됨)"은 "변경 없음"으로 답하지 말라는 지시가 붙는다', () => {
  const j = judgment({
    confidence: 'INSUFFICIENT', confidenceLabel: '자료 불충분(확인 필요)',
    history: { years: [{ year: 2018, inEffect: true, courses: { count: 0, status: 'NOT_VERIFIED', label: '기록 없음(검증 안 됨)' } }, { year: 2019, inEffect: true, courses: { count: 0, status: 'NO_CHANGE', label: '변경 없음' } }] },
  });
  const c = formatJudgmentChunks(j, SUBJECT)[0].content;
  assert.match(c, /2018학년도 과목 기록 없음\(검증 안 됨\)/);
  assert.match(c, /"변경 없다"고 답하지 마라/);
});

test('판단 청크: 질문 속 학번·학과(가정) 표시, 조문 원문 청크는 받은 것만(별표는 제외됨)', () => {
  const chunks = formatJudgmentChunks(judgment(), { ...SUBJECT, hypothetical: true }, { 'ENFORCEMENT_RULES:제5조': { body: '제5조(교육과정 이수의 원칙) …', versionLabel: '2026.06.26.', lastAmendedOn: null } });
  assert.match(chunks[0].content, /일반 재학생으로 가정/);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].chunkId, 'regulation-article-ENFORCEMENT_RULES:제5조');
  assert.match(chunks[1].documentTitle, /학칙시행규칙 제5조 원문 \(현행 2026\.06\.26\. 개정본\)/);
  assert.equal(chunks[1].ragDocumentTitle, '원광대학교 학칙시행규칙 전문');
});

test('mergeChunks 우선순위: 판단 → 구조화 → 직전 turn → RAG, RAG의 같은 조문 원문은 빼고 다른 규정집의 같은 번호는 남긴다', () => {
  const structured = {
    regulation: formatJudgmentChunks(judgment(), SUBJECT, { 'ENFORCEMENT_RULES:제5조': { body: '제5조(…) 본문', versionLabel: '2026.06.26.', lastAmendedOn: null } }),
    graduation: [{ chunkId: 'graduation-1-2023', documentTitle: 'g', content: 'g' }],
    history: [], curriculum: [], requirement: [], offering: [], linkedMajor: [], microDegree: [],
  };
  const fresh = [
    { chunkId: 11, documentTitle: '원광대학교 학칙시행규칙 전문', content: '제5조(교육과정 이수의 원칙) …' }, // 판단 조문과 중복 → 제외
    { chunkId: 12, documentTitle: '원광대학교 학칙 전문', content: '제5조(학생 정원) …' }, // 다른 규정집 → 유지
    { chunkId: 13, documentTitle: '정리 문서', content: '제5조(교육과정 이수의 원칙) 인용' }, // 원문 아님 → 유지
  ];
  const yearContext = { bookYears: [] };
  const ids = mergeChunks({ structured, previousCitedChunks: [{ chunkId: 7, documentTitle: 'p', content: 'p' }], freshChunks: fresh, yearContext }).map((c) => c.chunkId);
  assert.deepEqual(ids, ['regulation-judgment-1-2023-GENERAL-2026-10-05', 'regulation-article-ENFORCEMENT_RULES:제5조', 'graduation-1-2023', 7, 12, 13]);
  // 판단 청크가 없는 예전 호출자(structured.regulation 없음)도 그대로 동작
  const legacy = mergeChunks({ structured: { ...structured, regulation: undefined }, freshChunks: fresh, yearContext });
  assert.equal(legacy.length, 4);
});

test('시스템 프롬프트에 근거 우선순위 규칙이 들어간다', () => {
  const p = buildSystemPrompt(null, null, null);
  assert.match(p, /근거 우선순위/);
  assert.match(p, /1\. "적용 규정 판단" 문서/);
  assert.match(p, /위 순위를 따르고/);
});

test('규정 질문 판별: 졸업·이수·경과조치 질문만 판단 청크 대상', () => {
  for (const q of ['졸업하려면 몇 학점?', '전공필수가 바뀌면 안 들어도 돼?', '학칙 경과조치 알려줘', '편입생 기준']) assert.ok(REGULATION_QUESTION_RE.test(q), q);
  for (const q of ['도서관 위치 알려줘', '학식 메뉴 뭐야', '비밀번호 변경 어떻게 해?']) assert.ok(!REGULATION_QUESTION_RE.test(q), q);
  assert.ok(REGULATION_QUESTION_RE.test('학과가 바뀌면 전공과목은 어떻게 인정돼?'));
});

// --- DB(로컬 시드 + seed:regulation-articles) ---

async function ask(student, message) {
  const yearContext = resolveYearContext({ message, profileCohort: student.admission_year, availableBookYears: [2024, 2025, 2026], today: '2026-10-05' });
  return assembleStructuredChunks({ message, searchText: message, student, yearContext });
}

test('DB: 컴소공 2022학번 졸업요건 질문 → 판단 청크가 맨 앞, 과목 자료 C등급이라 자료 불충분 + 단정 금지 지시, 조문 원문 포함', async () => {
  const s = await ask({ department_id: D['컴퓨터·소프트웨어공학과'], admission_year: 2022, enrollment_type: 'GENERAL' }, '내 졸업요건이 뭐야?');
  assert.equal(s.judgment.confidence, 'INSUFFICIENT');
  const merged = mergeChunks({ structured: s, yearContext: { bookYears: [] } });
  assert.match(merged[0].chunkId, /^regulation-judgment-/);
  assert.match(merged[0].content, /전체 신뢰도: 자료 불충분\(확인 필요\)/);
  assert.match(merged[0].content, /단정하지 말고/);
  assert.match(merged[0].content, /기록 없음\(검증 안 됨\)/);
  assert.ok(s.regulation.some((c) => c.chunkId === 'regulation-article-ENFORCEMENT_RULES:제13조'));
});

test('DB: 규정과 무관한 질문에는 판단 청크를 넣지 않는다(관련 규정 없음 안내가 그대로 동작)', async () => {
  const s = await ask({ department_id: D['컴퓨터·소프트웨어공학과'], admission_year: 2022, enrollment_type: 'GENERAL' }, '도서관 위치 알려줘');
  assert.deepEqual(s.regulation, []);
  assert.equal(s.judgment, null);
});

test('DB: 온보딩 전(학과·학번 없음)이면 판단하지 않는다 — 엉뚱한 학생 기준으로 단정하지 않게', async () => {
  const s = await ask({ department_id: null, admission_year: null, enrollment_type: null }, '졸업하려면 몇 학점이야?');
  assert.deepEqual(s.regulation, []);
});

test('DB: 질문에 다른 학번이 나오면 그 학번·일반 재학생 가정으로 판단하고 가정임을 밝힌다', async () => {
  const s = await ask({ department_id: D['간호학과'], admission_year: 2026, enrollment_type: 'TRANSFER_ADMISSION' }, '2023학번은 졸업요건이 뭐야?');
  assert.equal(s.judgment.input.admissionYear, 2023);
  assert.equal(s.judgment.input.enrollmentType, 'GENERAL');
  assert.match(s.regulation[0].content, /일반 재학생으로 가정/);
});
