const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const regulationService = require('../services/regulationService');

/**
 * server/test/regulationService.cache.test.js
 * findRelevantChunks가 regulation_chunks를 매 호출마다 DB에서 다시 읽지 않고, TTL 안에서는
 * 캐시를 재사용하는지 검증. 전체 학과 확장 대비 성능 점검에서 추가한 캐싱(server/services/
 * regulationService.js)의 회귀 방지용 — 실제 청크 데이터 유무와 무관하게, "쿼리가 몇 번
 * 나가는지"만 확인하면 되므로 db/regulations 시딩 여부에 의존하지 않는다.
 */

after(async () => {
  await pool.end();
});

test('findRelevantChunks: TTL 안에서는 두 번째 호출부터 DB를 다시 조회하지 않는다', async () => {
  const originalQuery = pool.query.bind(pool);
  let queryCount = 0;
  pool.query = (...args) => {
    queryCount++;
    return originalQuery(...args);
  };

  try {
    const fakeEmbedding = new Array(8).fill(0.1);

    await regulationService.findRelevantChunks(fakeEmbedding);
    assert.equal(queryCount, 1, '첫 호출은 DB를 조회해야 함');

    await regulationService.findRelevantChunks(fakeEmbedding);
    assert.equal(queryCount, 1, '캐시 TTL 안의 두 번째 호출은 DB를 다시 조회하면 안 됨');

    await regulationService.findRelevantChunks(fakeEmbedding);
    assert.equal(queryCount, 1, '세 번째 호출도 마찬가지로 캐시를 재사용해야 함');
  } finally {
    pool.query = originalQuery;
  }
});
