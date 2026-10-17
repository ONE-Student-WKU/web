const { test } = require('node:test');
const assert = require('node:assert/strict');
const { orderCatalogResults } = require('../services/courseService');

/**
 * server/test/courseService.catalogOrder.test.js
 * 과목 검색에서 내 세부전공 → 내 학과 → 제2전공 → 나머지 순으로 앞에 두되, 검색어 일치 정도가 먼저다(2026-10-17 요청).
 */

const item = (name, department_id, track_id = null) => ({ name, department_id, track_id });
const scope = { trackId: 7, departmentIds: new Set([36, 158]), secondDepartmentIds: new Set([39]) };

test('같은 일치 정도면 내 세부전공·내 학과·제2전공·나머지 순서다', () => {
  const ranked = [
    { item: item('회계원리-타학과', 10), level: 1 },
    { item: item('회계원리-제2전공', 39), level: 1 },
    { item: item('회계원리-통폐합 전 학과', 158), level: 1 },
    { item: item('회계원리-세부전공', 36, 7), level: 1 },
  ];
  assert.deepEqual(orderCatalogResults(ranked, scope).map((c) => c.name), [
    '회계원리-세부전공', '회계원리-통폐합 전 학과', '회계원리-제2전공', '회계원리-타학과',
  ]);
});

test('다른 학과 과목이라도 이름이 더 정확히 맞으면 위에 남는다', () => {
  const ranked = [
    { item: item('회계원리', 10), level: 0 },
    { item: item('관리회계원리', 36), level: 2 },
  ];
  assert.deepEqual(orderCatalogResults(ranked, scope).map((c) => c.name), ['회계원리', '관리회계원리']);
});

test('오타 허용 검색은 거리가 먼저고, 같은 거리 안에서 내 학과가 앞이다', () => {
  const ranked = [
    { item: item('타학과-거리1', 10), level: 9, distance: 1 },
    { item: item('내학과-거리2', 36), level: 9, distance: 2 },
    { item: item('내학과-거리1', 36), level: 9, distance: 1 },
  ];
  assert.deepEqual(orderCatalogResults(ranked, scope).map((c) => c.name), ['내학과-거리1', '타학과-거리1', '내학과-거리2']);
});

test('학생 정보가 없으면 원래 순서 그대로다', () => {
  const ranked = [{ item: item('b', 10), level: 0 }, { item: item('a', 36), level: 0 }];
  assert.deepEqual(orderCatalogResults(ranked, null).map((c) => c.name), ['b', 'a']);
});
