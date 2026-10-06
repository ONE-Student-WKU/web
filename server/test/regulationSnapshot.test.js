const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diffSnapshots, describeGridChange, summarizeDiff, SCENARIOS } = require('../../scripts/audit/regulationSnapshot');

/**
 * server/test/regulationSnapshot.test.js
 * 전후 비교 도구(scripts/audit/regulationSnapshot.js)의 순수 부분: 스냅샷 두 개의 차이를 정확히 찾고 설명하는지.
 * 도구가 변경을 놓치면 "바뀐 숫자 전부 기록"이라는 보정 절차 자체가 무너지므로 별도로 검증한다. DB 없음.
 */

const cell = (over = {}) => ({ total: 140, cats: ['교양필수:5', '전공:115'], certs: 1, confidence: 'CONFIRMED', flags: [], totalDefinitive: true, liberalArtsCap: 52, ...over });

test('diffSnapshots: 같으면 0건, 값·키 추가·삭제를 모두 잡는다', () => {
  const a = { grid: { x: cell(), y: cell() }, scenarios: { S1: { q: 1 } } };
  assert.deepEqual(diffSnapshots(a, JSON.parse(JSON.stringify(a))), []);
  const b = { grid: { x: cell({ total: 130 }), z: cell() }, scenarios: { S1: { q: 2 } } };
  const d = diffSnapshots(a, b);
  assert.deepEqual(d.map((c) => `${c.section}:${c.key}`).sort(), ['grid:x', 'grid:y', 'grid:z', 'scenarios:S1']);
  assert.equal(d.find((c) => c.key === 'y').after, undefined);
  assert.equal(d.find((c) => c.key === 'z').before, undefined);
});

test('describeGridChange: 총학점·카테고리·신뢰도·플래그 변화를 각각 설명', () => {
  const parts = describeGridChange(cell(), cell({ total: 130, confidence: 'ESTIMATED', flags: ['SCHEDULE4_CREDIT_MISMATCH'], cats: ['교양필수:5', '전공:105'] }));
  assert.ok(parts.some((p) => p === '총학점 140→130'));
  assert.ok(parts.some((p) => p === '신뢰도 CONFIRMED→ESTIMATED'));
  assert.ok(parts.some((p) => p === '플래그+ SCHEDULE4_CREDIT_MISMATCH'));
  assert.ok(parts.some((p) => p.startsWith('카테고리 ')));
  assert.deepEqual(describeGridChange(null, cell()), ['조합 추가']);
});

test('summarizeDiff: 변경 건수와 시나리오 전후가 출력에 나온다', () => {
  const changes = diffSnapshots({ grid: { x: cell() }, scenarios: { S6c: { judgmentConfidence: 'NO_DATA', requirementChunks: [1] } } }, { grid: { x: cell({ total: 0 }) }, scenarios: { S6c: { judgmentConfidence: 'NO_DATA', requirementChunks: [2] } } });
  const text = summarizeDiff(changes);
  assert.match(text, /grid 변경 1건/);
  assert.match(text, /총학점 140→0/);
  assert.match(text, /scenarios 변경 1건/);
  assert.match(text, /requirementChunks: \[1\] → \[2\]/);
});

test('시나리오 목록: FINAL_REVIEW §4-2의 S1~S6c, X1~X3을 모두 포함', () => {
  const ids = SCENARIOS.map((s) => s[0]);
  for (const id of ['S1', 'S2', 'S3', 'S4a', 'S4b', 'S5', 'S6a', 'S6b', 'S6c', 'X1', 'X2', 'X3']) assert.ok(ids.includes(id), id);
});
