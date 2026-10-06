const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { resolveApplicableRulesForStudent } = require('../services/regulationEngine');
const { buildRegulationSeed } = require('../services/regulationEngine/regulationSeed');

/**
 * server/test/regulationEngine.applicabilityDb.test.js
 * 적용범위 판단을 실제 DB(로컬 시드)로 끝까지 돌린다: dbProvider.loadApplicabilityData → resolveApplicableRules.
 * 전제: regulationEngine.db.test.js와 같은 시드 + npm run seed:regulation-articles --workspace server.
 */

after(async () => {
  await pool.end();
});

const ASOF = '2026-10-05';
const rule = (r, code) => r.rules.find((x) => x.ruleCode === code);

test('DB의 적용범위 행이 레포 원천(applicability.json + 원문)과 같다 — 다르면 seed:regulation-articles를 다시 실행', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const manual = JSON.parse(fs.readFileSync(path.join(root, 'db', 'regulation-engine', 'applicability.json'), 'utf8'));
  const texts = Object.fromEntries(manual.documents.map((d) => [d.docCode, fs.readFileSync(path.join(root, d.file), 'utf8')]));
  const seed = buildRegulationSeed({ texts, manual });
  const [rows] = await pool.query('SELECT rule_code, scope, condition_code, article_id FROM regulation_applicability ORDER BY id');
  assert.deepEqual(rows.map((r) => [r.rule_code, r.scope, r.condition_code]), seed.applicability.map((r) => [r.ruleCode, r.scope, r.conditionCode]), 'npm run seed:regulation-articles --workspace server');
  assert.ok(rows.every((r) => r.article_id != null), '모든 적용범위 행이 조문에 연결돼야 함');
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM regulation_articles');
  assert.equal(n, seed.articles.length);
});

test('컴소공 2018학번: 2026 공학3계열 개편(DOC 계보)이 제14조로 잡히고, 컴소공 C등급 구간(2017·2018은 책자 대조 불가) 때문에 과목 판단은 자료 불충분', async () => {
  const r = await resolveApplicableRulesForStudent({ admissionYear: 2018, enrollmentType: 'GENERAL', departmentName: '컴퓨터·소프트웨어공학과', asOfDate: ASOF });
  const reorg = rule(r, 'ENF14_1_REORG_EQUIVALENT_COURSES');
  assert.equal(reorg.status, 'APPLIES');
  assert.ok(reorg.details.edges.some((e) => e.toDepartmentName === '공학3계열' && e.effectiveYear === 2026 && e.source === 'DOC'));
  assert.equal(rule(r, 'ACAD_SCHED4_3_2013_2024').status, 'APPLIES');
  assert.equal(rule(r, 'ENF13_4_CATEGORY_AT_REGISTRATION').confidence, 'INSUFFICIENT');
  assert.equal(r.history.years.find((y) => y.year === 2019).courses.label, '기록 없음(검증 안 됨)');
  // 졸업요건 값(파트 1)은 그대로 136, 총괄표 등급 A
  assert.equal(r.requirements.rules.find((x) => x.id === 'REQUIREMENTS').value.totalRequiredCredits, 136);
  assert.equal(r.confidence, 'INSUFFICIENT');
});

test('컴소공 2022학번: 2022 책자 컴소공 표로 분리돼 컴소공 B등급이라 과목 판단은 자료 불충분이 아니라 추정', async () => {
  const r = await resolveApplicableRulesForStudent({ admissionYear: 2022, enrollmentType: 'GENERAL', departmentName: '컴퓨터·소프트웨어공학과', asOfDate: ASOF });
  assert.equal(rule(r, 'ENF13_4_CATEGORY_AT_REGISTRATION').confidence, 'ESTIMATED');
});

test('간호학과 2026학번(입학 학년도 = 기준일 학년도): 경과조치 대상 없음, 확정', async () => {
  const r = await resolveApplicableRulesForStudent({ admissionYear: 2026, enrollmentType: 'GENERAL', departmentName: '간호학과', asOfDate: ASOF });
  assert.equal(rule(r, 'ACAD_SCHED4_1_FROM_2026').status, 'APPLIES');
  assert.equal(rule(r, 'ENF13_2_REQUIRED_TO_ELECTIVE_OR_ABOLISHED').status, 'NOT_APPLICABLE');
  assert.equal(r.confidence, 'CONFIRMED');
});

test('없는 학과: 자료없음(예외 없음)', async () => {
  const r = await resolveApplicableRulesForStudent({ admissionYear: 2023, enrollmentType: 'GENERAL', departmentName: '없는학과', asOfDate: ASOF });
  assert.equal(r.confidence, 'NO_DATA');
  assert.equal(r.department, null);
});
