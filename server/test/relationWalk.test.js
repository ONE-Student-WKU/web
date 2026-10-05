const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { buildRelationIndex, walkRelations, summarizeEvidence, relatedArticleCandidates, addendumDateOfRef, refLabel, MAX_REACHED, REFERS_FANOUT } = require('../services/regulationEngine/relationWalk');
const { resolveApplicableRulesForStudent } = require('../services/regulationEngine');
const { formatJudgmentChunks } = require('../services/regulationContextService');

/**
 * server/test/relationWalk.test.js
 * 조문 관계(위임·참조·특칙·개정)를 따라가는 로직(보정 라운드 B, D-43). 앞부분은 DB 없는 순수 테스트, 뒷부분은 로컬 시드 DB로 실제 경로를 확인한다.
 */

after(async () => { await pool.end(); });

const R = (relation, fromRef, toRef, extra = {}) => ({ relation, fromRef, toRef, toText: toRef ? null : (extra.toText || '미보유'), source: 'PARSED', note: null, ...extra });
const idx = (rows) => buildRelationIndex(rows);

test('위임은 깊이 2까지 따라가고 그 너머는 안 간다', () => {
  const index = idx([R('DELEGATES_TO', 'D:제1조', 'D:제2조'), R('DELEGATES_TO', 'D:제2조', 'D:제3조'), R('DELEGATES_TO', 'D:제3조', 'D:제4조')]);
  const w = walkRelations('D:제1조', index);
  assert.deepEqual(w.reached.map((n) => n.ref), ['D:제2조', 'D:제3조']);
  assert.deepEqual(w.reached[1].path.map((e) => `${e.from}>${e.to}`), ['D:제1조>D:제2조', 'D:제2조>D:제3조']);
});

test('참조는 깊이 1까지만, 조문당 REFERS_FANOUT개까지(번호 순)', () => {
  const rows = [10, 4, 7, 2, 9].map((n) => R('REFERS', 'D:제1조', `D:제${n}조`)).concat([R('REFERS', 'D:제2조', 'D:제50조')]);
  const w = walkRelations('D:제1조', idx(rows));
  assert.equal(w.reached.length, REFERS_FANOUT);
  assert.deepEqual(w.reached.map((n) => n.ref), ['D:제2조', 'D:제4조', 'D:제7조']);
  assert.ok(!w.reached.some((n) => n.ref === 'D:제50조'), '참조의 참조는 따라가지 않는다');
});

test('순환(A→B→A)에서 멈추고 출발 조문을 다시 담지 않는다', () => {
  const w = walkRelations('D:제1조', idx([R('DELEGATES_TO', 'D:제1조', 'D:제2조'), R('DELEGATES_TO', 'D:제2조', 'D:제1조')]));
  assert.deepEqual(w.reached.map((n) => n.ref), ['D:제2조']);
});

test('도달 조문은 MAX_REACHED개에서 끊고 truncated를 표시한다', () => {
  const rows = Array.from({ length: 15 }, (_, i) => R('DELEGATES_TO', 'D:제1조', `D:제${i + 2}조`));
  const w = walkRelations('D:제1조', idx(rows));
  assert.equal(w.reached.length, MAX_REACHED);
  assert.equal(w.truncated, true);
});

test('별표 상위는 "적용 중인" 하위 표만 학번 구간 단계로 잇는다', () => {
  const index = idx([R('DELEGATES_TO', 'E:제118조', 'A:별표4')]);
  const w = walkRelations('E:제118조', index, { appliedRefs: new Set(['A:별표4-3', 'A:별표4-2', 'A:별표5-1']) });
  assert.deepEqual(w.reached.map((n) => n.ref), ['A:별표4', 'A:별표4-3', 'A:별표4-2']);
  const child = w.reached.find((n) => n.ref === 'A:별표4-3');
  assert.deepEqual(child.path.map((e) => e.relation), ['DELEGATES_TO', 'SELECTS_BY_COHORT']);
  assert.ok(!w.reached.some((n) => n.ref === 'A:별표5-1'), '다른 별표의 하위 표는 따라가지 않는다');
});

test('appliedRefs가 비어 있으면 별표 하위 표를 고르지 않는다(추측 금지)', () => {
  const w = walkRelations('E:제118조', idx([R('DELEGATES_TO', 'E:제118조', 'A:별표4')]));
  assert.deepEqual(w.reached.map((n) => n.ref), ['A:별표4']);
});

test('특칙은 양방향으로 기록한다(덮는 조문 / 덮이는 조문)', () => {
  const index = idx([R('OVERRIDES', 'E:제13조', 'E:제5조')]);
  assert.deepEqual(walkRelations('E:제13조', index).overrides.map((e) => e.to), ['E:제5조']);
  assert.deepEqual(walkRelations('E:제5조', index).overriddenBy.map((e) => e.from), ['E:제13조']);
  assert.equal(walkRelations('E:제5조', index).overrides.length, 0);
});

test('개정은 들어오는 방향으로 모으고 부칙 공포일을 붙인다', () => {
  const index = idx([R('AMENDS', 'A:부칙(2026.04.10.)제1조', 'A:별표4-3'), R('AMENDS', 'A:부칙(2026.06.26.)제1조', 'A:별표4-3')]);
  const w = walkRelations('A:별표4-3', index);
  assert.deepEqual(w.amendments.map((e) => e.date), ['2026-04-10', '2026-06-26']);
  assert.equal(addendumDateOfRef('A:제5조'), null);
});

test('조문으로 못 이은 대상은 이동하지 않고 끊긴 연결로 남긴다(중복 없이)', () => {
  const rows = [R('REFERS', 'A:제1조', null, { toText: '종전 부칙(2025.08.29.)' }), R('REFERS', 'A:제1조', null, { toText: '종전 부칙(2025.08.29.)' })];
  const w = walkRelations('A:제1조', idx(rows));
  assert.equal(w.reached.length, 0);
  assert.equal(w.unresolved.length, 1);
  assert.equal(w.unresolved[0].toText, '종전 부칙(2025.08.29.)');
});

test('관련 조문 후보: 특칙 상대 > 위임 > 참조, 별표·이미 적용 중인 조문은 제외', () => {
  const rules = [{
    status: 'APPLIES',
    basis: { articleRef: 'E:제5조' },
    evidence: {
      root: 'E:제5조',
      reached: [
        { ref: 'E:제20조', depth: 1, path: [{ relation: 'REFERS', to: 'E:제20조' }] },
        { ref: 'E:제13조', depth: 1, path: [{ relation: 'DELEGATES_TO', to: 'E:제13조' }] },
        { ref: 'A:별표4', depth: 1, path: [{ relation: 'DELEGATES_TO', to: 'A:별표4' }] },
      ],
      overrides: [], overriddenBy: [{ from: 'E:제13조', relation: 'OVERRIDES', to: 'E:제5조' }], amendments: [], unresolved: [],
    },
  }];
  const summary = summarizeEvidence(rules);
  const c = relatedArticleCandidates(summary, ['E:제5조'], 5);
  assert.deepEqual(c.map((x) => x.ref), ['E:제13조', 'E:제20조']);
  assert.equal(c[0].priority, 0, '제13조는 특칙 상대라 위임보다 먼저');
  assert.deepEqual(relatedArticleCandidates(summary, ['E:제5조', 'E:제13조'], 5).map((x) => x.ref), ['E:제20조'], '이미 적용 중인 조문은 뺀다');
});

test('refLabel: 별표 하위 표는 ①~④, 일반 조문은 문서명 + 조문키', () => {
  assert.equal(refLabel('ACADEMIC_REGULATIONS:별표4-3'), '학칙 [별표 4] ③');
  assert.equal(refLabel('ENFORCEMENT_RULES:제118조'), '학칙시행규칙 제118조');
});

// ─── 실제 DB(로컬 시드) ───
const ASOF = '2026-10-05';
const find = (r, code) => r.rules.find((x) => x.ruleCode === code);
const csInput = { admissionYear: 2022, enrollmentType: 'GENERAL', departmentName: '컴퓨터·소프트웨어공학과', asOfDate: ASOF };

test('DB: 2022학번 제118조 → [별표 4] → [별표 4] ③(학번 구간) 경로가 남고 개정 이력도 붙는다', async () => {
  const r = await resolveApplicableRulesForStudent(csInput);
  const e = find(r, 'ENF118_GRAD_CREDITS_BY_COHORT').evidence;
  const refs = e.reached.map((n) => n.ref);
  assert.ok(refs.includes('ACADEMIC_REGULATIONS:별표4'));
  assert.ok(refs.includes('ACADEMIC_REGULATIONS:별표4-3'));
  const leaf = e.reached.find((n) => n.ref === 'ACADEMIC_REGULATIONS:별표4-3');
  assert.deepEqual(leaf.path.map((x) => x.relation), ['DELEGATES_TO', 'SELECTS_BY_COHORT']);
  const sched = find(r, 'ACAD_SCHED4_3_2013_2024').evidence;
  assert.ok(sched.amendments.length >= 2 && sched.amendments.every((a) => a.date), '별표 4-3을 개정한 부칙 공포일');
  assert.ok(r.rules.filter((x) => x.status === 'NOT_APPLICABLE').every((x) => x.evidence == null), '적용되지 않는 규칙에는 근거 경로를 붙이지 않는다');
});

test('DB: 제5조와 제13조는 특칙 관계(제13조 우선)로 기록된다', async () => {
  const r = await resolveApplicableRulesForStudent(csInput);
  const s = summarizeEvidence(r.rules);
  assert.ok(s.overrides.some((o) => o.special === 'ENFORCEMENT_RULES:제13조' && o.general === 'ENFORCEMENT_RULES:제5조'));
});

test('DB: 원문을 보유하지 않은 종전 부칙은 끊긴 연결로 드러난다(숨기지 않음)', async () => {
  const r = await resolveApplicableRulesForStudent(csInput);
  const s = summarizeEvidence(r.rules);
  assert.ok(s.broken.length > 0, '끊긴 연결이 하나도 없다');
  assert.ok(s.broken.some((b) => /2025\.08\.29/.test(b.toText)), JSON.stringify(s.broken));
});

test('챗봇 판단 청크: 근거 경로 줄 + 관련 조문 청크(최대 2개·800자)', async () => {
  const r = await resolveApplicableRulesForStudent(csInput);
  const long = 'x'.repeat(3000);
  const keys = ['ENFORCEMENT_RULES:제118조', 'ENFORCEMENT_RULES:제6조', 'ENFORCEMENT_RULES:제12조', 'ACADEMIC_REGULATIONS:제25조', 'ENFORCEMENT_RULES:제13조', 'ENFORCEMENT_RULES:제5조'];
  const articles = Object.fromEntries(keys.map((k) => [k, { title: k, body: long, versionLabel: 'v', lastAmendedOn: null }]));
  const chunks = formatJudgmentChunks(r, { departmentName: '컴퓨터·소프트웨어공학과', cohort: 2022, enrollmentType: 'GENERAL', hypothetical: false }, articles);
  const body = chunks[0].content;
  assert.match(body, /근거 경로\(조문 관계/);
  assert.match(body, /학칙시행규칙 제118조 → 위임 학칙 \[별표 4\]/);
  const related = chunks.filter((c) => /관련 조문:/.test(c.documentTitle));
  assert.ok(related.length <= 2);
  assert.ok(related.every((c) => c.content.length <= 800 + 10 && c.articleKey && c.ragDocumentTitle));
});
