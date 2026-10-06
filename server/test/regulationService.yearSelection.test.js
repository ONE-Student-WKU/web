const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { selectChunksByYear } = require('../services/regulationService');

/**
 * server/test/regulationService.yearSelection.test.js
 * 해마다 소제목이 같은 책자 문서(2024·2025·2026)가 검색 결과에서 섞이지 않는지 — 점수가 매겨진 청크에서
 * 책자 학년도로 거르는 순수 함수(selectChunksByYear) 검증. DB를 읽지 않는다(pool은 모듈 로드로 열려서 닫기만 함).
 */

after(async () => {
  await pool.end();
});

const chunk = (chunkId, bookYear, score) => ({ chunkId, bookYear, score, documentTitle: `doc${chunkId}`, content: 'x' });

// 같은 소제목의 청크가 3개 해에 있고 점수가 거의 같다 + 현행 규정(학칙) 청크
const scored = [
  chunk('g24', 2024, 0.62), chunk('g25', 2025, 0.63), chunk('g26', 2026, 0.61),
  chunk('h24', 2024, 0.58), chunk('h25', 2025, 0.59), chunk('h26', 2026, 0.57),
  chunk('law', null, 0.60), chunk('low', 2025, 0.2),
];

test('질문의 책자 학년도 하나만 남기고 다른 해 청크는 섞이지 않는다', () => {
  const out = selectChunksByYear(scored, { bookYears: [2025], topK: 5 });
  assert.deepEqual(out.map((c) => c.chunkId), ['g25', 'law', 'h25']);
  assert.ok(out.every((c) => c.bookYear == null || c.bookYear === 2025));
});

test('현행 규정 문서(bookYear 없음)는 연도와 상관없이 후보로 남는다', () => {
  const out = selectChunksByYear(scored, { bookYears: [2026], topK: 5 });
  assert.ok(out.some((c) => c.chunkId === 'law'));
});

test('MIN_SIMILARITY 미만은 제외된다', () => {
  const out = selectChunksByYear(scored, { bookYears: [2025], topK: 10 });
  assert.ok(!out.some((c) => c.chunkId === 'low'));
});

test('여러 해 비교: 각 해에서 최소 N개를 보장한다(한 해가 점수로 독식하지 않음)', () => {
  const skewed = [
    chunk('a1', 2024, 0.9), chunk('a2', 2024, 0.85), chunk('a3', 2024, 0.8), chunk('a4', 2024, 0.75),
    chunk('b1', 2026, 0.5), chunk('b2', 2026, 0.45),
  ];
  const plain = selectChunksByYear(skewed, { bookYears: [2024, 2026], topK: 4 });
  assert.ok(!plain.some((c) => c.bookYear === 2026), '보장 없이는 2026이 밀려남');
  const fair = selectChunksByYear(skewed, { bookYears: [2024, 2026], topK: 4, perYearMin: 2 });
  assert.equal(fair.filter((c) => c.bookYear === 2026).length, 2);
  assert.equal(fair.filter((c) => c.bookYear === 2024).length >= 2, true);
});

test('책자 학년도를 안 주면(빈 목록) 책자 문서는 하나도 안 나오고 현행 규정만 나온다', () => {
  const out = selectChunksByYear(scored, { bookYears: [], topK: 5 });
  assert.deepEqual(out.map((c) => c.chunkId), ['law']);
});
