const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateLiberalElectiveAreas, loadLiberalAreaCatalog, parseCatalogText } = require('../services/liberalElectiveAreas');

/**
 * server/test/liberalElectiveAreas.test.js
 * 교양기초 영역별 학점·교양선택 영역 개수(#378 H-1, 결정 H1-1·H1-2·H1-3 A). DB·AI 없이 개설현황 문서만 읽는다.
 */

const course = (name, credits, year = 2026, category = '교양선택') => ({ name, credits, year, category });
const evaluate = (courses, extra = {}) => evaluateLiberalElectiveAreas({ admissionYear: 2026, electiveRequiredCredits: 28, courses, ...extra });
const byArea = (r) => Object.fromEntries(r.foundation.map((a) => [a.area, a.earned]));

test('개설현황 문서에서 다섯 교양기초 영역과 네 교양선택 영역 과목을 모두 읽는다', () => {
  const catalog = loadLiberalAreaCatalog();
  assert.deepEqual(Object.keys(catalog).map(Number).sort(), [2025, 2026]);
  const areas = new Set([...catalog[2026].values()].map((v) => `${v.group}/${v.area}`));
  for (const a of ['생명존중', 'AI와디지털', '논리와표현', '글로벌의사소통', '과학과기술']) assert.ok(areas.has(`교양기초/${a}`), a);
  for (const a of ['인문과사회', '자연과환경', '문화와예술', '취업과실무']) assert.ok(areas.has(`교양선택/${a}`), a);
  assert.deepEqual(catalog[2026].get('컴퓨팅적사고력'), { group: '교양기초', area: 'AI와디지털' });
});

test('표 제목이 영역을 정하고, 소개·다른 표 아래의 행은 넣지 않는다', () => {
  const map = parseCatalogText([
    '### 교양기초 기초교육 AI와 디지털 개설 과목',
    '| 학수번호 | 교과목 | 영문명 |',
    '|---|---|---|',
    '| L1 | 가상AI과목 | x |',
    '### 교양기초 기초교육 AI와 디지털 교과목 소개',
    '| L2 | 소개표과목 | x |',
    '### 교양선택 리버럴아츠교육 문화와 예술 개설 과목 (1/2)',
    '| L3 | 가상 예술 과목 | x |',
  ].join('\n'));
  assert.deepEqual([...map.keys()], ['가상AI과목', '가상예술과목']);
  assert.equal(map.get('가상예술과목').area, '문화와예술');
});

test('교양기초 16학점을 한 영역으로만 채우면 나머지 네 영역이 모자란다 — 예전에는 학점 합계만 봐서 "충족"이었다', () => {
  const r = evaluate([course('컴퓨팅적사고력', 3), course('피지컬컴퓨팅', 3), course('데이터분석및시각화', 3), course('인공지능과미래사회', 3), course('디지털리터러시5', 3)]);
  assert.equal(byArea(r).AI와디지털, 15);
  assert.deepEqual(r.foundation.filter((a) => !a.satisfied).map((a) => a.area), ['생명존중', '논리와표현', '글로벌의사소통', '과학과기술']);
  assert.equal(r.satisfied, false);
});

test('교양선택은 4개 영역 중 3개 이상 — 계열(교양선택 행 28 = 기초 16 + 선택 12)과 일반 학과(32)에 붙는다', () => {
  const two = evaluate([course('인적자원개발론', 3), course('화학과생활', 3)]);
  assert.equal(two.electives.coveredAreaCount, 2);
  assert.equal(two.electives.satisfied, false);
  const general = evaluateLiberalElectiveAreas({ admissionYear: 2025, electiveRequiredCredits: 32, courses: [] });
  assert.equal(general.electives.requiredAreaCount, 3);
});

test('모두 채우면 충족', () => {
  const all = [
    course('인성함양과마음치유', 2), course('지속가능한생태계', 2), course('컴퓨팅적사고력', 3), course('비판적사고와논리', 3),
    course('대학영어', 3), course('수학과통계의세계', 3), course('인적자원개발론', 3), course('화학과생활', 3),
  ];
  const catalog = loadLiberalAreaCatalog();
  const art = [...catalog[2026].entries()].find(([, v]) => v.area === '문화와예술')[0];
  const r = evaluate([...all, course(art, 3)]);
  assert.equal(r.unknownCredits, 0, JSON.stringify(r));
  assert.equal(r.satisfied, true, JSON.stringify(r));
});

test('이수구분은 수강 학년도 기준(D-56) — 화학과생활은 2025년에 들으면 교양기초 과학과기술, 2026년이면 교양선택 자연과환경', () => {
  const in2025 = evaluate([course('화학과생활', 3, 2025)]);
  assert.equal(byArea(in2025).과학과기술, 3);
  const in2026 = evaluate([course('화학과생활', 3, 2026)]);
  assert.equal(byArea(in2026).과학과기술, 0);
  assert.equal(in2026.electives.areas.find((a) => a.area === '자연과환경').earned, 3);
});

test('개설현황에 없는 이름은 "영역을 모르는 학점"으로 따로 세고 어느 영역에도 넣지 않는다(H1-3 A). 끝 괄호와 띄어쓰기는 흡수한다', () => {
  const r = evaluate([course('지어낸교양과목', 2), course('컴퓨팅적 사고력(1분반)', 3), course('전공과목', 3, 2026, '전공선택')]);
  assert.equal(r.unknownCredits, 2);
  assert.equal(byArea(r).AI와디지털, 3);
});

test('적용 대상: 2024학번 이하·교양 기준을 완화받은 학생·교양기초 16학점이 안 되는 행은 판정하지 않는다(null)', () => {
  assert.equal(evaluate([], { admissionYear: 2024 }), null);
  assert.equal(evaluate([], { relaxed: true }), null);
  assert.equal(evaluate([], { electiveRequiredCredits: 4 }), null);
  assert.equal(evaluate([], { electiveRequiredCredits: null }), null);
});

test('교양선택이 4·2학점인 학과(의약·간호 등, 교양선택 행 20·18)는 교양기초 영역만 보고 영역 개수 조건은 없다', () => {
  const r = evaluate([], { electiveRequiredCredits: 20 });
  assert.equal(r.electives, null);
  assert.equal(r.foundation.length, 5);
});
