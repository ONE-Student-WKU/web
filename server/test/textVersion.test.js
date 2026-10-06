const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { summarizeVersions, articleTextFlags, basisTextFlags } = require('../services/regulationEngine/textVersion');
const { evaluate } = require('../services/regulationEngine/evaluate');
const { normalizeInput, dbDateToIso } = require('../services/regulationEngine/context');
const { CITATIONS, TEXT_SOURCES } = require('../services/regulationEngine/constants');
const { loadTextVersions } = require('../services/regulationEngine/dbProvider');
const { resolveApplicableRulesForStudent } = require('../services/regulationEngine');
const { buildRegulationSeed } = require('../services/regulationEngine/regulationSeed');

/**
 * server/test/textVersion.test.js
 * 기준일 판본 판단 일원화(보정 라운드 B 1-1, FINAL_REVIEW B-20·B-21·F-8, DECISIONS D-42).
 * 앞쪽은 DB 없음(가짜 판본 행), 뒤쪽은 로컬 시드 DB(+ seed:regulation-articles).
 */

after(async () => { await pool.end(); });

// 시행규칙을 본뜬 판본 행: 제정(사슬 밖) → 2026.02.05. 전부개정(공포 02-05, 시행 03-01) → 04.10. → 06.26.(본문 보유)
const ROWS = [
  { id: 1, docCode: 'ENFORCEMENT_RULES', versionLabel: '제정', promulgatedOn: '1976-03-01', effectiveFrom: null, supersedesVersionId: null, textHeld: false },
  { id: 2, docCode: 'ENFORCEMENT_RULES', versionLabel: '2026.02.05.', promulgatedOn: '2026-02-05', effectiveFrom: '2026-03-01', supersedesVersionId: null, textHeld: false },
  { id: 3, docCode: 'ENFORCEMENT_RULES', versionLabel: '2026.04.10.', promulgatedOn: '2026-04-10', effectiveFrom: '2026-04-10', supersedesVersionId: 2, textHeld: false },
  { id: 4, docCode: 'ENFORCEMENT_RULES', versionLabel: '2026.06.26.', promulgatedOn: '2026-06-26', effectiveFrom: '2026-06-26', supersedesVersionId: 3, textHeld: true },
];
const TV = { summary: summarizeVersions(ROWS), articles: { 'ENFORCEMENT_RULES:제5조': { lastAmendedOn: null }, 'ENFORCEMENT_RULES:제33조': { lastAmendedOn: '2026-06-26' } } };
const flags = (p) => articleTextFlags({ docCode: 'ENFORCEMENT_RULES', textVersions: TV, ...p }).map((f) => f.code);

test('summarizeVersions: 대체관계를 거슬러 올라간 사슬의 시작 시행일(floor)과 보유 판본 시행일(latest), 공포일→시행일', () => {
  const s = TV.summary.ENFORCEMENT_RULES;
  assert.equal(s.floor, '2026-03-01', '제정(사슬 밖, 시행일 모름)이 아니라 전부개정 시행일');
  assert.equal(s.latest, '2026-06-26');
  assert.equal(s.effectiveByPromulgation.get('2026-02-05'), '2026-03-01');
});

test('summarizeVersions: 본문 보유 판본이 없거나 사슬 시작의 시행일을 모르면 요약하지 않는다(상수로 대체), 순환 대체관계도 멈춘다', () => {
  assert.deepEqual(summarizeVersions([{ ...ROWS[1], textHeld: false }]), {});
  assert.deepEqual(summarizeVersions([{ id: 9, docCode: 'X', versionLabel: 'a', promulgatedOn: null, effectiveFrom: null, supersedesVersionId: null, textHeld: true }]), {});
  const cyc = [{ id: 1, docCode: 'X', promulgatedOn: '2020-01-01', effectiveFrom: '2020-01-01', supersedesVersionId: 2, textHeld: true }, { id: 2, docCode: 'X', promulgatedOn: '2019-01-01', effectiveFrom: '2019-01-01', supersedesVersionId: 1, textHeld: false }];
  assert.ok(summarizeVersions(cyc).X, '순환이어도 무한 루프 없이 요약');
});

test('조문 판본 플래그: 판본 시작 전 = 구버전 없음(추정), 개정 없는 조문은 판본 안 어느 기준일에도 플래그 없음(확정 가능), 개정된 조문은 개정 시행일 전까지 추정, 최신 이후는 정보', () => {
  assert.deepEqual(flags({ articleKey: '제5조', asOfDate: '2026-02-28' }), ['TEXT_VERSION_NOT_HELD'], '시행규칙 판본은 2026-03-01부터');
  assert.deepEqual(flags({ articleKey: '제5조', asOfDate: '2026-03-01' }), []);
  assert.deepEqual(flags({ articleKey: '제5조', asOfDate: '2026-05-01' }), [], '개정 표시 없는 조문은 중간 판본에서도 같은 문구');
  assert.deepEqual(flags({ articleKey: '제33조', asOfDate: '2026-05-01' }), ['TEXT_INTERMEDIATE_VERSION'], '2026-06-26 개정 전 문구는 없다');
  assert.deepEqual(flags({ articleKey: '제33조', asOfDate: '2026-06-26' }), []);
  assert.deepEqual(flags({ articleKey: '제5조', asOfDate: '2026-10-05' }), ['TEXT_SNAPSHOT_MAY_BE_OLDER']);
  assert.deepEqual(flags({ articleKey: '제33조', asOfDate: '2026-02-01' }), ['TEXT_VERSION_NOT_HELD'], '판본 시작 전이 개정 판단보다 먼저');
});

test('조문 정보를 모르면 보수적으로 최신 판본에서 개정된 것으로 본다(예전 문서 단위 판단과 같은 결과) — 구버전 구간은 어떤 경우에도 확정 안 됨', () => {
  assert.deepEqual(flags({ articleKey: '제99조', asOfDate: '2026-05-01' }), ['TEXT_INTERMEDIATE_VERSION']);
  assert.deepEqual(articleTextFlags({ asOfDate: '2026-05-01', docCode: 'ENFORCEMENT_RULES' }).map((f) => f.code), ['TEXT_INTERMEDIATE_VERSION'], 'DB 정보 없이 상수만(순수 테스트 경로)');
  assert.deepEqual(articleTextFlags({ asOfDate: '2025-09-01', docCode: 'ENFORCEMENT_RULES', lastAmendedOn: null }).map((f) => f.code), ['TEXT_VERSION_NOT_HELD']);
  assert.deepEqual(articleTextFlags({ asOfDate: '2026-05-01', docCode: 'UNKNOWN_DOC' }), []);
});

test('공포일 ≠ 시행일: 개정 표시 날짜(공포일)를 시행일로 바꿔 비교한다', () => {
  const tv = { summary: { D: { floor: '2026-01-01', latest: '2026-12-31', effectiveByPromulgation: new Map([['2026-02-05', '2026-03-01']]) } }, articles: {} };
  const f = (asOfDate) => articleTextFlags({ asOfDate, docCode: 'D', lastAmendedOn: '2026-02-05', textVersions: tv }).map((x) => x.code);
  assert.deepEqual(f('2026-02-20'), ['TEXT_INTERMEDIATE_VERSION'], '공포(02-05) 후라도 시행(03-01) 전 문구는 개정 전');
  assert.deepEqual(f('2026-03-01'), []);
});

test('근거 레지스트리: 모든 ARTICLE 근거가 articleRef를 갖고, 그 조문이 파서가 만든 조문에 실제로 있다', () => {
  const root = path.resolve(__dirname, '..', '..');
  const manual = JSON.parse(fs.readFileSync(path.join(root, 'db', 'regulation-engine', 'applicability.json'), 'utf8'));
  const texts = Object.fromEntries(manual.documents.map((d) => [d.docCode, fs.readFileSync(path.join(root, d.file), 'utf8')]));
  const refs = new Set(buildRegulationSeed({ texts, manual }).articles.map((a) => `${a.docCode}:${a.articleKey}`));
  const articles = Object.entries(CITATIONS).filter(([, c]) => c.kind === 'ARTICLE');
  assert.ok(articles.length >= 14);
  for (const [key, c] of articles) {
    assert.ok(c.articleRef, `${key}: articleRef 필요`);
    assert.ok(refs.has(c.articleRef), `${key}: ${c.articleRef} 조문이 원문에 없음`);
  }
  // 책자·사례 근거는 판본 판단 대상이 아니다
  assert.deepEqual(basisTextFlags('2025-01-01', ['BOOKLET_ROWS', 'CASE_MAJOR_CHANGE_AFTER_CUTOFF'], TV), []);
  assert.deepEqual(basisTextFlags('2026-05-01', ['ENF_ART5_COHORT_BASIS', 'ENF_ART10_1_LIBERAL_CAP'], TV).map((f) => f.code), ['TEXT_INTERMEDIATE_VERSION'], '판본 정보에 없는 조문(제10조)은 보수적으로 추정 — DB 정보가 있으면 확정');
});

test('dbDateToIso: 서버 로컬 자정 Date는 로컬 연·월·일 그대로(UTC 변환으로 하루 밀리지 않는다), 문자열은 앞 10자', () => {
  assert.equal(dbDateToIso(new Date(2026, 5, 26)), '2026-06-26');
  assert.equal(dbDateToIso(new Date(2026, 0, 1)), '2026-01-01');
  assert.equal(dbDateToIso('2026-06-26 00:00:00'), '2026-06-26');
  assert.equal(dbDateToIso(null), null);
});

test('evaluate(순수): 같은 기준일에 판본 정보가 있으면(개정 없는 조문 위주) 확정, 없으면 보수적으로 추정', () => {
  const rows = [
    { id: 1, category: '교양필수', requiredCredits: 5, description: null, enrollmentType: null, minCourseCount: null, minAdmissionYear: 2026, maxAdmissionYear: null, requiredCourses: [] },
    { id: 2, category: '전공필수', requiredCredits: 30, description: null, enrollmentType: null, minCourseCount: null, minAdmissionYear: 2026, maxAdmissionYear: null, requiredCourses: [] },
  ];
  const { ctx } = normalizeInput({ admissionYear: 2026, enrollmentType: 'GENERAL', departmentId: 1, asOfDate: '2026-03-15' });
  const data = { department: { id: 1, name: '가' }, rows, latestDataYear: 2026, candidates: [], history: null };
  assert.equal(evaluate(ctx, data).confidence, 'ESTIMATED', '판본 정보 없음 → 시행규칙 개정 기간이라 추정');
  const tv = { summary: TV.summary, articles: Object.fromEntries(['제5조', '제6조', '제8조', '제10조', '제13조', '제116조', '제118조'].map((k) => [`ENFORCEMENT_RULES:${k}`, { lastAmendedOn: null }])) };
  const res = evaluate(ctx, { ...data, textVersions: tv });
  assert.equal(res.confidence, 'CONFIRMED');
  assert.ok(!res.flags.some((f) => f.code.startsWith('TEXT_') && f.level !== 'INFO'));
});

// --- DB(로컬 시드) ---

test('DB: regulation_versions에서 읽은 판본 시작·끝 날짜가 상수 TEXT_SOURCES와 같다(어긋나면 둘 중 하나가 낡은 것)', async () => {
  const tv = await loadTextVersions();
  for (const doc of ['ACADEMIC_REGULATIONS', 'ENFORCEMENT_RULES']) {
    assert.equal(tv.summary[doc].floor, TEXT_SOURCES[doc].firstHeldEffective, `${doc} floor`);
    assert.equal(tv.summary[doc].latest, TEXT_SOURCES[doc].latestHeldEffective, `${doc} latest`);
  }
  assert.equal(tv.summary.CLASS_MANAGEMENT.floor, '1980-03-01', '제정부터 부칙이 이어지는 수업관리규정은 제정일');
  assert.equal(tv.articles['ACADEMIC_REGULATIONS:별표4-3'].lastAmendedOn, '2026-06-26', 'DATE 하루 밀림 회귀');
  assert.equal(tv.articles['ENFORCEMENT_RULES:제5조'].lastAmendedOn, null);
});

const run = (departmentName, admissionYear, asOfDate) => resolveApplicableRulesForStudent({ departmentName, admissionYear, enrollmentType: 'GENERAL', asOfDate });
const textCodes = (r) => r.flags.filter((f) => f.code.startsWith('TEXT_') && f.level !== 'INFO').map((f) => f.code);

test('DB: 모순 사례 해소 — 간호학과 2026학번 @2026-03-15·05-01은 조문 규칙도 전체도 확정(예전: 전체만 추정)', async () => {
  for (const asOf of ['2026-03-15', '2026-05-01']) {
    const r = await run('간호학과', 2026, asOf);
    assert.equal(r.confidence, 'CONFIRMED', asOf);
    assert.deepEqual(textCodes(r), [], asOf);
  }
});

test('DB: 구버전 원문이 없는 구간은 계속 추정/자료없음 — 판본 시작(시행규칙 2026-03-01) 전', async () => {
  const before = await run('간호학과', 2022, '2025-09-01');
  assert.ok(textCodes(before).includes('TEXT_VERSION_NOT_HELD'));
  assert.notEqual(before.confidence, 'CONFIRMED');
  // 판본 시작 전이지만 입학 후인 2026 학번 — 입학 전(2026-03 이전 입학 학기 이전)이면 자료없음
  assert.equal((await run('간호학과', 2026, '2026-02-10')).confidence, 'NO_DATA');
});

test('DB: 개정된 조문은 개정 시행일 전까지 추정 — [별표 4] ③(2026-06-26 개정) @2026-05-01', async () => {
  const r = await run('간호학과', 2022, '2026-05-01');
  const sched = r.rules.find((x) => x.ruleCode === 'ACAD_SCHED4_3_2013_2024');
  assert.ok(sched.flags.some((f) => f.code === 'TEXT_INTERMEDIATE_VERSION'));
  const r2 = await run('간호학과', 2022, '2026-07-01');
  assert.ok(!r2.rules.find((x) => x.ruleCode === 'ACAD_SCHED4_3_2013_2024').flags.some((f) => f.code === 'TEXT_INTERMEDIATE_VERSION'));
});
