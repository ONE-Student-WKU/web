const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const embeddingClient = require('../services/embeddingClient');
const { seedDocument } = require('../scripts/seedRegulations');

/**
 * server/test/seedRegulations.force.test.js
 * --force 재시딩에서 임베딩이 실패하면 옛 문서가 그대로 남는지(#412). 예전에는 옛 문서를 먼저 지운 뒤 임베딩해서, 실패하면 그 문서가
 * 검색에서 빠진 채로 남았다. 임베딩은 가짜로 바꾸고, 로컬 시드 DB의 regulation_documents에 테스트 문서 하나를 넣었다 지운다.
 */

const realGetEmbeddings = embeddingClient.getEmbeddings;
const TITLE = `테스트 문서 seedRegulations.force ${Date.now()}`;
const doc = (chunks) => ({ title: TITLE, category: '테스트', sourceType: 'CURATED', sourceUrl: null, effectiveDate: null, chunks });
const fakeEmbeddings = async (texts) => texts.map(() => [0, 1]);

async function chunksOf(title) {
  const [rows] = await pool.query(
    `SELECT c.content FROM regulation_chunks c JOIN regulation_documents d ON d.id = c.document_id
      WHERE d.title = ? AND d.source_type = 'CURATED' ORDER BY c.chunk_index`,
    [title]
  );
  return rows.map((r) => r.content);
}

after(async () => {
  embeddingClient.getEmbeddings = realGetEmbeddings;
  await pool.query("DELETE FROM regulation_documents WHERE title = ? AND source_type = 'CURATED'", [TITLE]);
  await pool.end();
});

test('--force 재시딩: 임베딩이 실패하면 옛 문서와 청크가 그대로 남고, 성공하면 한 번에 바뀐다', async () => {
  embeddingClient.getEmbeddings = fakeEmbeddings;
  assert.equal(await seedDocument(doc(['옛 내용 1', '옛 내용 2']), { force: true }), 2);
  assert.deepEqual(await chunksOf(TITLE), ['옛 내용 1', '옛 내용 2']);

  embeddingClient.getEmbeddings = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
  await assert.rejects(seedDocument(doc(['새 내용']), { force: true }), { name: 'TimeoutError' });
  assert.deepEqual(await chunksOf(TITLE), ['옛 내용 1', '옛 내용 2'], '실패해도 옛 문서가 검색에 남아야 한다');

  embeddingClient.getEmbeddings = fakeEmbeddings;
  assert.equal(await seedDocument(doc(['새 내용']), { force: true }), 1);
  assert.deepEqual(await chunksOf(TITLE), ['새 내용']);
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM regulation_documents WHERE title = ? AND source_type = 'CURATED'", [TITLE]);
  assert.equal(Number(n), 1, '옛 문서는 지워지고 새 문서 하나만 남는다');
});

test('--force가 아니면 이미 있는 문서는 임베딩하지 않고 건너뛴다', async () => {
  let called = 0;
  embeddingClient.getEmbeddings = async (texts) => { called += 1; return fakeEmbeddings(texts); };
  assert.equal(await seedDocument(doc(['다른 내용']), { force: false }), 0);
  assert.equal(called, 0);
  assert.deepEqual(await chunksOf(TITLE), ['새 내용']);
});
