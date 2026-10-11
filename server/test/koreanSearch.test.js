const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MATCH,
  normalizeForSearch,
  toChoseong,
  toJamo,
  isChoseongQuery,
  minSubstringDistance,
  allowedTypos,
  prepareEntry,
  prepareQuery,
  rankEntries,
} = require('../services/koreanSearch');
const { expandAliases } = require('../services/searchAliases');

/**
 * server/test/koreanSearch.test.js
 * 한국어 검색 순수 함수(정규화·초성·오타 허용·정렬)와 약칭 사전 — DB 없이 돈다.
 */

const rows = (names) => names.map((n, i) => ({ item: { id: i, name: n }, entry: prepareEntry(n) }));
const names = (ranked) => ranked.map((r) => r.item.name);
const search = (data, q, opts) => {
  const normalized = normalizeForSearch(q);
  return rankEntries(data, prepareQuery(q, expandAliases(normalized)), opts);
};

test('normalizeForSearch: 공백·문장부호를 지우고 소문자로 만든다', () => {
  assert.equal(normalizeForSearch('컴퓨터 네트워크'), '컴퓨터네트워크');
  assert.equal(normalizeForSearch('졸업(시험·작품)논문'), '졸업시험작품논문');
  assert.equal(normalizeForSearch('졸업(시험.작품)논문'), '졸업시험작품논문');
  assert.equal(normalizeForSearch('C++ Programming'), 'cprogramming');
  assert.equal(normalizeForSearch(null), '');
});

test('toChoseong / toJamo: 완성형 한글만 풀고 나머지는 그대로 둔다', () => {
  assert.equal(toChoseong('알고리즘'), 'ㅇㄱㄹㅈ');
  assert.equal(toChoseong('Java 기초'), 'Java ㄱㅊ');
  assert.deepEqual(toJamo('조'), ['ㅈ', 'ㅗ']);
  assert.deepEqual(toJamo('값a'), ['ㄱ', 'ㅏ', 'ㅄ', 'a']);
});

test('isChoseongQuery: 자음으로만 된 입력만 초성 검색', () => {
  assert.equal(isChoseongQuery('ㅇㄱㄹㅈ'), true);
  assert.equal(isChoseongQuery('ㅇ알'), false);
  assert.equal(isChoseongQuery(''), false);
});

test('minSubstringDistance: 부분 문자열 기준 최소 편집 거리', () => {
  assert.equal(minSubstringDistance(['a', 'b'], ['x', 'a', 'b', 'y']), 0);
  assert.equal(minSubstringDistance(['a', 'c'], ['x', 'a', 'b', 'y']), 1);
  assert.equal(minSubstringDistance(['a', 'b', 'c', 'd'], ['a', 'b']), 2);
});

test('allowedTypos: 짧은 검색어는 오타를 허용하지 않는다', () => {
  assert.equal(allowedTypos(4), 0);
  assert.equal(allowedTypos(5), 1);
  assert.equal(allowedTypos(8), 1);
  assert.equal(allowedTypos(9), 2);
});

test('띄어쓰기를 무시하고 찾는다(양방향)', () => {
  const data = rows(['컴퓨터네트워크', '컴퓨터 구조']);
  assert.deepEqual(names(search(data, '컴퓨터 네트워크')), ['컴퓨터네트워크']);
  assert.deepEqual(names(search(data, '컴퓨터구조')), ['컴퓨터 구조']);
});

test('이름이 검색어로 시작하는 과목이 포함만 하는 과목보다 앞에 온다', () => {
  const data = rows(['고급알고리즘', '알고리즘', '알고리즘설계']);
  const ranked = search(data, '알고리즘');
  assert.deepEqual(names(ranked), ['알고리즘', '알고리즘설계', '고급알고리즘']);
  assert.equal(ranked[0].level, MATCH.EXACT_PREFIX);
  assert.equal(ranked[2].level, MATCH.CONTAINS);
});

test('같은 단계에서는 들어온 순서를 지킨다(안정 정렬)', () => {
  const data = rows(['자료구조B', '자료구조A', '자료구조C']);
  assert.deepEqual(names(search(data, '자료구조')), ['자료구조B', '자료구조A', '자료구조C']);
});

test('초성 검색: 초성으로 시작하는 과목이 먼저, 그다음 초성을 포함하는 과목', () => {
  const data = rows(['고급알고리즘', '알고리즘', '운영체제']);
  const ranked = search(data, 'ㅇㄱㄹㅈ');
  assert.deepEqual(names(ranked), ['알고리즘', '고급알고리즘']);
  assert.equal(ranked[0].level, MATCH.CHOSEONG_PREFIX);
  assert.equal(ranked[1].level, MATCH.CHOSEONG_CONTAINS);
});

test('약칭 사전: 약칭으로 시작하는 검색어를 정식 표기로 바꿔 찾는다', () => {
  const data = rows(['기업연계프로젝트1(종합설계1)', '기업연계프로젝트2(종합설계2)', '데이터베이스', '자료구조']);
  assert.deepEqual(names(search(data, '기연프2')), ['기업연계프로젝트2(종합설계2)']);
  assert.deepEqual(names(search(data, '디비')), ['데이터베이스']);
  assert.equal(search(data, '디비')[0].level, MATCH.ALIAS);
  assert.deepEqual(names(search(data, '자구')), ['자료구조']);
});

test('expandAliases: 약칭으로 "시작"할 때만 적용하고 뒤 글자는 이어 붙인다', () => {
  assert.deepEqual(expandAliases('기연프1'), ['기업연계프로젝트1']);
  assert.deepEqual(expandAliases('수기연프'), []);
  assert.deepEqual(expandAliases('없는약칭'), []);
  assert.deepEqual(expandAliases('x1', { x: 'ABC' }), ['ABC1']);
});

test('교수명은 보조 필드로 찾고, 이름 일치보다 뒤에 온다', () => {
  const data = [
    { item: { name: '김치의역사' }, entry: prepareEntry('김치의역사') },
    { item: { name: '알고리즘' }, entry: prepareEntry('알고리즘', ['김영수']) },
    { item: { name: '운영체제' }, entry: prepareEntry('운영체제', ['박철수']) },
  ];
  const ranked = rankEntries(data, prepareQuery('김'));
  assert.deepEqual(names(ranked.map((r) => ({ item: r.item }))), ['김치의역사', '알고리즘']);
  assert.equal(ranked[1].level, MATCH.SECONDARY);
});

test('오타 허용: 정확히 일치하는 결과가 없을 때만, 자모 한 글자 정도 틀린 이름을 찾는다', () => {
  const data = rows(['자료구조', '운영체제', '알고리즘']);
  const ranked = search(data, '자료구죠');
  assert.deepEqual(names(ranked), ['자료구조']);
  assert.equal(ranked[0].level, MATCH.FUZZY);
  // 받침 하나 빠진 경우
  assert.deepEqual(names(search(data, '운영체재')), ['운영체제']);
});

test('정확 일치가 하나라도 있으면 오타 후보는 섞지 않는다', () => {
  const data = rows(['자료구조', '자료구죠실습']);
  assert.deepEqual(names(search(data, '자료구죠')), ['자료구죠실습']);
});

test('짧은 검색어와 초성 검색에는 오타 허용을 쓰지 않는다', () => {
  const data = rows(['자료구조', '운영체제']);
  assert.deepEqual(search(data, '자로'), []);
  assert.deepEqual(search(data, 'ㅈㄹㅊㅈ'), []);
});

test('문장부호뿐인 검색어는 아무것도 찾지 않고, limit을 지킨다', () => {
  const data = rows(['가나다', '가나라', '가나마']);
  assert.deepEqual(search(data, '?!'), []);
  assert.equal(search(data, '가나', { limit: 2 }).length, 2);
});
