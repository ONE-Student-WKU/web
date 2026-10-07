const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { resolveApplicableRulesForStudent } = require('../services/regulationEngine');
const { summarizeEvidence } = require('../services/regulationEngine/relationWalk');

/**
 * server/test/regulationEngine.classManagement.test.js
 * 수업관리규정 적용범위(보정 라운드 B, D-47): 조문 본문으로 확인되는 것만 규칙으로 두고, 삭제된 조문은 삭제일을 기준으로만 판단한다.
 * 전제: 로컬 시드 + npm run seed:regulation-articles --workspace server.
 */

after(async () => { await pool.end(); });

const base = { admissionYear: 2022, enrollmentType: 'GENERAL', departmentName: '컴퓨터·소프트웨어공학과' };
const judge = (asOfDate) => resolveApplicableRulesForStudent({ ...base, asOfDate });
const rule = (r, code) => r.rules.find((x) => x.ruleCode === code);

test('현재 기준일: 수업관리규정 제2·5·6·13조는 참고 규정으로 적용, 삭제된 제14·15조는 해당 없음', async () => {
  const r = await judge('2026-10-05');
  for (const code of ['CMR2_SCOPE_UNDERGRADUATE', 'CMR5_SECTION_SPLIT_STANDARD', 'CMR6_CLOSURE_STANDARD', 'CMR13_INTENSIVE_COURSE_HOURS']) {
    const x = rule(r, code);
    assert.equal(x.status, 'APPLIES', code);
    assert.equal(x.critical, false, `${code}는 전체 신뢰도에 영향을 주지 않는 참고 규정`);
    assert.equal(x.confidence, 'CONFIRMED', code);
  }
  assert.equal(rule(r, 'CMR14_ORAL_LANGUAGE_CLASS_DELETED').status, 'NOT_APPLICABLE');
  assert.equal(rule(r, 'CMR15_REMOTE_CLASS_DELETED').status, 'NOT_APPLICABLE');
});

test('삭제일 전 기준일: 삭제된 조문의 내용을 모르므로 UNKNOWN(있었다고 단정도, 없었다고 단정도 하지 않음) + 추정', async () => {
  const r = await judge('2023-05-01'); // 제14조는 이미 삭제(2022-02-25), 제15조는 삭제 전(2024-08-23)
  assert.equal(rule(r, 'CMR14_ORAL_LANGUAGE_CLASS_DELETED').status, 'NOT_APPLICABLE');
  const remote = rule(r, 'CMR15_REMOTE_CLASS_DELETED');
  assert.equal(remote.status, 'UNKNOWN');
  assert.notEqual(remote.confidence, 'CONFIRMED');
  assert.equal(remote.critical, false);
});

test('삭제일 당일에는 삭제된 것으로 본다(경계)', async () => {
  const r = await judge('2024-08-23');
  assert.equal(rule(r, 'CMR15_REMOTE_CLASS_DELETED').status, 'NOT_APPLICABLE');
  const before = await judge('2024-08-22');
  assert.equal(rule(before, 'CMR15_REMOTE_CLASS_DELETED').status, 'UNKNOWN');
});

test('개정 이력이 있는 조문(제6조, 2022.07.20. 개정)은 그 전 기준일에 중간 판본 추정이 붙는다', async () => {
  const r = await judge('2022-03-01');
  const closure = rule(r, 'CMR6_CLOSURE_STANDARD');
  assert.equal(closure.status, 'APPLIES');
  assert.equal(closure.confidence, 'ESTIMATED');
  assert.ok(closure.flags.some((f) => f.code === 'TEXT_INTERMEDIATE_VERSION'));
});

test('참고 규정(critical=false)은 전체 신뢰도를 바꾸지 않는다', async () => {
  const r = await judge('2023-05-01');
  const withoutCmr = r.rules.filter((x) => x.critical && x.status !== 'NOT_APPLICABLE').map((x) => x.confidence);
  assert.ok(withoutCmr.length > 0);
  assert.ok(r.rules.some((x) => x.ruleCode === 'CMR15_REMOTE_CLASS_DELETED' && x.confidence !== 'CONFIRMED'));
  // 전체 신뢰도는 critical 규칙·요건·상위 플래그로만 정해진다 — 수업관리규정 UNKNOWN이 "자료 불충분/자료없음"으로 끌어내리지 않는다
  assert.notEqual(r.confidence, 'NO_DATA');
});

test('제13조 집중수업 → 학칙시행규칙 제14조(학점당 수업시간) 참조 경로가 근거에 남는다(문서 사이 연결)', async () => {
  const r = await judge('2026-10-05');
  const s = summarizeEvidence(r.rules);
  const p = s.paths.find((x) => x.root === 'CLASS_MANAGEMENT:제13조');
  assert.ok(p, '제13조에서 출발한 경로가 없다');
  assert.ok(p.steps.some((st) => st.ref === 'ENFORCEMENT_RULES:제14조' && st.relation === 'REFERS'), JSON.stringify(p.steps));
});
