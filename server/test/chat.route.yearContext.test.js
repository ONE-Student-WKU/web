const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const embeddingClient = require('../services/embeddingClient');
const aiClient = require('../services/aiClient');
const chatRouter = require('../routes/chat');

/**
 * server/test/chat.route.yearContext.test.js
 * POST /api/chat/messages 전체 흐름(연도 해석 → RAG 책자 학년도 필터 → 구조화 조회 → AI 호출 인자)을 외부 API 없이 검증한다.
 * 임베딩(Voyage)과 Claude 호출은 mock으로 막고, AI에 넘어가는 근거 청크와 연도 해석(yearContext)을 캡처해서 확인한다.
 * DB에 임시 학생/대화를 만들고 끝나면 지운다. 전제: 시드 + migrate(book_year) + generate:curriculum-changes.
 */

let server;
let baseUrl;
let studentId;
let conversationId;
let captured;
let embeddingToReturn;
let ragChunk; // book_year가 있는 실제 RAG 청크 하나(해당 청크의 임베딩을 질문 임베딩으로 돌려주면 유사도 1.0)

before(async () => {
  const [[cse]] = await pool.query("SELECT id FROM departments WHERE name = '컴퓨터·소프트웨어공학과'");
  const [result] = await pool.query(
    `INSERT INTO students (email, name, department_id, admission_year, enrollment_type, onboarding_completed_at)
     VALUES (?, ?, ?, 2018, 'GENERAL', NOW())`,
    [`yearctx-test-${Date.now()}@example.test`, `yearctx${Date.now()}`, cse.id]
  );
  studentId = result.insertId;
  const [conv] = await pool.query('INSERT INTO chat_conversations (student_id) VALUES (?)', [studentId]);
  conversationId = conv.insertId;

  const [rows] = await pool.query(
    `SELECT rc.id, rc.embedding, rd.book_year FROM regulation_chunks rc
     JOIN regulation_documents rd ON rd.id = rc.document_id WHERE rd.book_year = 2025 LIMIT 1`
  );
  ragChunk = rows[0];
  assert.ok(ragChunk, '2025학년도 책자 RAG 문서가 필요합니다(migrate의 book_year 백필 확인)');

  mock.method(embeddingClient, 'getEmbedding', async () => embeddingToReturn);
  mock.method(aiClient, 'rewriteSearchQuery', async (q) => q);
  mock.method(aiClient, 'getAIChatResponse', async (message, chunks, history, student, graduationStatus, yearContext) => {
    captured = { chunks, student, yearContext };
    return '테스트 답변';
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: studentId };
    next();
  });
  app.use('/api/chat', chatRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  mock.restoreAll();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

async function post(message, targetConversationId = conversationId) {
  captured = null;
  const res = await fetch(`${baseUrl}/api/chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: targetConversationId, message }),
  });
  return { status: res.status, body: await res.json() };
}

const titles = () => captured.chunks.map((c) => c.documentTitle);

test('"내 졸업요건이 뭐야?"(2018학번): 프로필 학번 기준 한 해, 연도 해석이 AI 호출에 전달된다', async () => {
  embeddingToReturn = new Array(512).fill(0);
  const { status, body } = await post('내 졸업요건이 뭐야?');
  assert.equal(status, 200);
  assert.equal(body.data.content, '테스트 답변');
  assert.equal(captured.yearContext.mode, 'COHORT');
  assert.equal(captured.yearContext.applicableCohort, 2018);
  assert.ok(titles().some((t) => /2018학번 졸업요건/.test(t)));
  assert.ok(!titles().some((t) => /(2019|2024|2025|2026)학번 졸업요건/.test(t)), `다른 해가 섞임: ${titles().join(' / ')}`);
});

test('연도 비교 질문: 두 해의 졸업요건을 각각 넣고 AI에는 COMPARE 해석이 전달된다', async () => {
  embeddingToReturn = new Array(512).fill(0);
  await post('2020학년도와 2026학년도의 졸업요건 차이는 뭐야?');
  assert.equal(captured.yearContext.mode, 'COMPARE');
  assert.deepEqual(captured.yearContext.targetYears, [2020, 2026]);
  assert.ok(titles().some((t) => /2020학번 졸업요건/.test(t)));
  assert.ok(titles().some((t) => /2026학번 졸업요건/.test(t)));
});

test('RAG: 다른 해 책자의 청크는 유사도가 1.0이어도 검색 결과에 섞이지 않는다', async () => {
  embeddingToReturn = JSON.parse(JSON.stringify(ragChunk.embedding));
  const asked2026 = await post('2026학년도 졸업요건이 뭐야?');
  assert.equal(asked2026.status, 200);
  assert.ok(!captured.chunks.some((c) => c.chunkId === ragChunk.id), '2025 책자 청크가 2026학년도 질문에 섞임');

  await post('2025학년도 졸업요건이 뭐야?');
  const hit = captured.chunks.find((c) => c.chunkId === ragChunk.id);
  assert.ok(hit, '2025학년도를 물으면 2025 책자 청크가 나와야 함');
  assert.equal(hit.bookYear, 2025);
});

test('근거가 하나도 없으면 AI 호출 없이 안내 문구(기존 동작 유지)', async () => {
  embeddingToReturn = new Array(512).fill(0);
  // 새 대화로 보낸다 — 같은 대화에서는 직전 turn의 인용 청크가 유지되는 기존 동작(follow-up 보호) 때문에 근거가 남는다.
  const [fresh] = await pool.query('INSERT INTO chat_conversations (student_id) VALUES (?)', [studentId]);
  const { status, body } = await post('점심 메뉴 추천해줘', fresh.insertId);
  assert.equal(status, 200);
  assert.equal(captured, null, '근거가 없으면 getAIChatResponse를 호출하면 안 됨');
  assert.match(body.data.content, /관련 규정을 찾지 못했어요/);
});
