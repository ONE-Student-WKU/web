const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parseMarkers, parseEffectiveDate, parseRegulationText, extractRelations, expandYear } = require('../services/regulationEngine/articleParser');
const { buildRegulationSeed, normalize } = require('../services/regulationEngine/regulationSeed');
const { TEXT_SOURCES } = require('../services/regulationEngine/constants');

/**
 * 조문 파서·시드 빌더 테스트(DB 없음). 원문 파일은 레포의 db/regulations/_source/*.txt를 그대로 읽는다.
 * 핵심 보장: ① 개정 표시를 날짜로 정확히 뽑는다 ② 적용범위 JSON의 모든 인용문이 실제 조문 본문에 있다(규정 내용을 만들어내지 않음)
 * ③ 판본 날짜가 엔진 상수(TEXT_SOURCES)와 일치한다.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const manual = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'db', 'regulation-engine', 'applicability.json'), 'utf8'));
const texts = Object.fromEntries(manual.documents.map((d) => [d.docCode, fs.readFileSync(path.join(REPO_ROOT, d.file), 'utf8')]));
const seed = buildRegulationSeed({ texts, manual });

test('parseMarkers: 4자리 연도, 여러 날짜, 날짜 없는 꺾쇠 무시', () => {
  assert.deepEqual(parseMarkers('⑧ 휴학기간은 ... <개정 2026. 6. 26.>'), [{ kind: '개정', dates: ['2026-06-26'] }]);
  assert.deepEqual(parseMarkers('󰊳 ...(2013학년도 ~ 2024학년도 입학생)<개정 2026. 4. 10., 2026. 6. 26.>'), [{ kind: '개정', dates: ['2026-04-10', '2026-06-26'] }]);
  assert.deepEqual(parseMarkers('<그림> <의학과> 본문'), []);
});

test('parseMarkers: 수업관리규정식 2자리 연도·곡선 따옴표·종류 혼합·꺾쇠 밖 종류', () => {
  assert.deepEqual(parseMarkers('<개정 ‘01.2.1, ’20.07.03, ‘22.02.25>'), [{ kind: '개정', dates: ['2001-02-01', '2020-07-03', '2022-02-25'] }]);
  assert.deepEqual(parseMarkers("<호신설 '22.10.18>"), [{ kind: '호신설', dates: ['2022-10-18'] }]);
  assert.deepEqual(parseMarkers('<항신설 ‘20.07.03, 개정 ‘22.02.25>'), [{ kind: '항신설', dates: ['2020-07-03'] }, { kind: '개정', dates: ['2022-02-25'] }]);
  assert.deepEqual(parseMarkers('②  삭제 <2026. 4. 10.>'), [{ kind: '삭제', dates: ['2026-04-10'] }]);
  assert.deepEqual(parseMarkers('<단서신설 ’20.07.03, 개정 2025. 6. 27.>'), [{ kind: '단서신설', dates: ['2020-07-03'] }, { kind: '개정', dates: ['2025-06-27'] }]);
  assert.equal(expandYear('80'), 1980);
  assert.equal(expandYear('01'), 2001);
});

test('parseEffectiveDate: 날짜 명시는 확정, 공포일 시행은 공포일, 학기 표현은 추정, 문구 없으면 UNKNOWN', () => {
  assert.deepEqual(parseEffectiveDate('본 시행규칙은 2026년 3월 1일부터 시행한다.', '2026-02-05').date, '2026-03-01');
  assert.equal(parseEffectiveDate('이 학칙은 공포한 날로부터 시행한다.', '2026-06-26').date, '2026-06-26');
  const term = parseEffectiveDate('이 규정은 2019학년도 제1학기부터 시행한다.', '2018-12-04');
  assert.deepEqual([term.date, term.confidence], ['2019-03-01', 'ESTIMATED']);
  assert.deepEqual(parseEffectiveDate('경과조치만 있음', '2020-01-01'), { date: null, confidence: 'UNKNOWN', basis: null });
});

test('학칙 원문: 본문·부칙·별표 하위표를 조문 단위로 나누고 [별표 4] 학번별 표를 찾는다', () => {
  const r = parseRegulationText(texts.ACADEMIC_REGULATIONS);
  const keys = new Set(r.articles.map((a) => a.articleKey));
  for (const k of ['제1조', '제71조', '제113조', '제115조', '부칙(2026.04.10.)제2조', '별표4', '별표4-1', '별표4-2', '별표4-3', '별표4-4']) assert.ok(keys.has(k), k);
  // 원문에 제114조 줄이 없다(파서가 만들어내지 않는다).
  assert.equal(keys.has('제114조'), false);
  const s43 = r.articles.find((a) => a.articleKey === '별표4-3');
  assert.match(s43.title, /2013학년도 ~ 2024학년도 입학생/);
  assert.equal(s43.lastAmendedOn, '2026-06-26');
  assert.deepEqual(s43.amendmentMarkers, [{ kind: '개정', dates: ['2026-04-10', '2026-06-26'] }]);
  // 개정 표시 없는 조문은 lastAmendedOn이 null("개정 없음"이 아니라 "표시 없음").
  assert.equal(r.articles.find((a) => a.articleKey === '제71조').lastAmendedOn, null);
  assert.deepEqual(r.header.map((h) => h.kind), ['제정', '전부개정', '개정', '개정']);
});

test('시행규칙 원문: 제1조부터 마지막 조까지 누락 없이, 제13조 ①~④가 한 조문에, 부칙 시행일 2026-03-01', () => {
  const r = parseRegulationText(texts.ENFORCEMENT_RULES);
  const body = r.articles.filter((a) => a.section === 'BODY');
  const nos = body.map((a) => a.articleNo);
  const max = Math.max(...nos);
  for (let i = 1; i <= max; i++) assert.ok(nos.includes(i), `제${i}조`);
  const a13 = body.find((a) => a.articleKey === '제13조');
  for (const p of ['①', '②', '③', '④']) assert.ok(a13.body.includes(p), p);
  assert.equal(a13.chapter, '제3장 교육과정');
  assert.equal(r.addenda[0].effective.date, '2026-03-01');
});

test('extractRelations: 특칙(에도 불구하고)·별표 위임·다른 문서·외부 법령·자기 문서("본 시행규칙")', () => {
  const r7 = extractRelations('제7조(광역계열) ① 제6조에도 불구하고 광역계열 소속 학생은 본조를 우선 적용한다.', 'ENFORCEMENT_RULES', '제7조');
  assert.deepEqual(r7, [{ relation: 'OVERRIDES', toDoc: 'ENFORCEMENT_RULES', toKey: '제6조', toRef: null }]);
  const r118 = extractRelations('2. 이수학점: 「원광대학교 학칙」 [별표 4]에 따르며 3. 교육과정 이수: 본 시행규칙 제6조에서 제12조에 따른다.', 'ENFORCEMENT_RULES', '제118조');
  assert.ok(r118.some((x) => x.relation === 'DELEGATES_TO' && x.toDoc === 'ACADEMIC_REGULATIONS' && x.toKey === '별표4'));
  assert.ok(r118.some((x) => x.toDoc === 'ENFORCEMENT_RULES' && x.toKey === '제6조'));
  const ext = extractRelations('「고등교육법 시행령」 제29조에 해당하는 자', 'ACADEMIC_REGULATIONS', '제7조');
  assert.deepEqual(ext, [{ relation: 'REFERS', toDoc: null, toKey: null, toRef: '「고등교육법 시행령」 제29조' }]);
  // 조문 머리의 자기 번호는 관계가 아니다(부칙 제2조가 본문 제2조를 가리키는 오탐 방지).
  assert.deepEqual(extractRelations('제2조(경과조치) 제109조에 따른 전과는', 'ENFORCEMENT_RULES', '부칙(2026.02.05.)제2조').map((x) => x.toKey), ['제109조']);
});

test('extractRelations: 「」 없이 이름이 붙은 "학칙시행규칙 제14조"는 그 문서 조문(깨진 문자열 아님), "학칙 제24조"는 시행규칙 조문으로 오인하지 않는다 (D-47)', () => {
  const r13 = extractRelations('제13조(집중수업) 교과 운영상 필요할 경우 학칙시행규칙 제14조에 따른 학점 당 수업시간을 준수하여 운영할 수 있다.', 'CLASS_MANAGEMENT', '제13조');
  assert.deepEqual(r13.map((r) => [r.relation, r.toDoc, r.toKey, r.toRef]), [['REFERS', 'ENFORCEMENT_RULES', '제14조', null]]);
  const r33 = extractRelations('제33조(공결) 다만, 공결기간에는 학칙 제24조의 휴업일을 포함한다.', 'ENFORCEMENT_RULES', '제33조');
  assert.deepEqual(r33.map((r) => [r.toDoc, r.toKey]), [['ACADEMIC_REGULATIONS', '제24조']], '시행규칙 제24조(수강가능학점 예외)가 아니라 학칙 제24조');
  const self = extractRelations('제5조(가) 이 학칙 제7조에 따른다.', 'ACADEMIC_REGULATIONS', '제5조');
  assert.deepEqual(self.map((r) => [r.toDoc, r.toKey]), [['ACADEMIC_REGULATIONS', '제7조']], '"이 학칙 제N조"는 자기 문서');
});

test('시드: 경고 0건 — 적용범위·관계의 인용문이 모두 실제 조문 본문에 있다', () => {
  assert.deepEqual(seed.warnings, []);
  const byRef = new Map(seed.articles.map((a) => [`${a.docCode}:${a.articleKey}`, a]));
  for (const rule of seed.applicability) {
    const article = byRef.get(rule.articleRef);
    assert.ok(article, rule.articleRef);
    assert.ok(normalize(article.body).includes(normalize(rule.quote)), `${rule.ruleCode} 인용문`);
  }
});

test('시드 판본: 날짜가 엔진 상수(TEXT_SOURCES)와 같고, 현행본만 본문 보유, 대체관계는 부칙 목록 안에서만', () => {
  const v = (doc) => seed.versions.filter((x) => x.docCode === doc);
  for (const [doc, src] of [['ACADEMIC_REGULATIONS', TEXT_SOURCES.ACADEMIC_REGULATIONS], ['ENFORCEMENT_RULES', TEXT_SOURCES.ENFORCEMENT_RULES]]) {
    const chain = v(doc).filter((x) => x.inAddendaChain);
    assert.deepEqual(chain.map((x) => x.effectiveFrom), src.amendments, doc);
    assert.equal(chain[0].supersedesLabel, null, '전부개정본의 직전 판본은 모른다');
    assert.equal(chain[1].supersedesLabel, chain[0].versionLabel);
    assert.deepEqual(v(doc).filter((x) => x.textHeld).map((x) => x.effectiveFrom), [src.latestHeldEffective]);
    const enactment = v(doc).find((x) => x.versionLabel === '제정');
    assert.deepEqual([enactment.effectiveFrom, enactment.dateConfidence], [null, 'UNKNOWN']);
  }
  const prior = v('ACADEMIC_REGULATIONS').find((x) => x.versionLabel === '2025.08.29.');
  assert.deepEqual([prior.textHeld, prior.dateConfidence, prior.supersedesLabel], [false, 'UNKNOWN', null]);
});

test('시드 관계: 학칙 제71조 → [별표 4] 위임, 부칙(2026.04.10.) → [별표 4] ③ 개정, 시행규칙 제7조 → 제6조 특칙', () => {
  const has = (from, relation, to) => seed.relations.some((r) => r.from === from && r.relation === relation && r.to === to);
  assert.ok(has('ACADEMIC_REGULATIONS:제71조', 'DELEGATES_TO', 'ACADEMIC_REGULATIONS:별표4'));
  assert.ok(has('ACADEMIC_REGULATIONS:부칙(2026.04.10.)제1조', 'AMENDS', 'ACADEMIC_REGULATIONS:별표4-3'));
  assert.ok(has('ACADEMIC_REGULATIONS:부칙(2026.04.10.)제2조', 'AMENDS', 'ACADEMIC_REGULATIONS:별표4-3'));
  assert.ok(has('ENFORCEMENT_RULES:제7조', 'OVERRIDES', 'ENFORCEMENT_RULES:제6조'));
  assert.ok(has('ENFORCEMENT_RULES:제118조', 'DELEGATES_TO', 'ACADEMIC_REGULATIONS:별표4'));
  // 보유하지 않은 종전 부칙은 조문으로 잇지 않고 문자열로만 남긴다.
  const prior = seed.relations.find((r) => r.from === 'ACADEMIC_REGULATIONS:부칙(2026.02.05.)제3조' && r.source === 'MANUAL');
  assert.equal(prior.to, null);
  assert.match(prior.toRef, /원문 미보유/);
});
