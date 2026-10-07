const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const embeddingClient = require('../services/embeddingClient');
const aiClient = require('../services/aiClient');
const chatRouter = require('../routes/chat');
const { guardAnswer, NOTICE, NOTICE_EN } = require('../services/answerGuard');

/**
 * server/test/chat.language.test.js
 * 챗봇 답변 언어(영어 화면 지원): 클라이언트가 보낸 language가 허용 목록을 거쳐 AI 호출까지 전달되고,
 * 영어일 때만 시스템 프롬프트에 답변 언어 지시가 붙으며, 답변 가드(answerGuard)가 영어 단서/안내문을 쓴다.
 * 임베딩과 Claude 호출은 mock으로 막는다(외부 API 없음). DB에 임시 학생/대화를 만들고 끝나면 지운다.
 */

let server;
let baseUrl;
let studentId;
let conversationId;
let capturedLanguage;

before(async () => {
  const [[cse]] = await pool.query("SELECT id FROM departments WHERE name = '컴퓨터·소프트웨어공학과'");
  const [result] = await pool.query(
    `INSERT INTO students (email, name, department_id, admission_year, enrollment_type, onboarding_completed_at)
     VALUES (?, ?, ?, 2022, 'GENERAL', NOW())`,
    [`lang-test-${Date.now()}@example.test`, `lang${Date.now()}`, cse.id]
  );
  studentId = result.insertId;
  const [conv] = await pool.query('INSERT INTO chat_conversations (student_id) VALUES (?)', [studentId]);
  conversationId = conv.insertId;

  mock.method(embeddingClient, 'getEmbedding', async () => new Array(512).fill(0));
  mock.method(aiClient, 'rewriteSearchQuery', async (q) => q);
  mock.method(aiClient, 'getAIChatResponse', async (message, chunks, history, student, graduationStatus, yearContext, language) => {
    capturedLanguage = language;
    return 'ok';
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

async function post(body) {
  capturedLanguage = undefined;
  const res = await fetch(`${baseUrl}/api/chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, message: '졸업학점이 몇 점이야?', ...body }),
  });
  return { status: res.status, body: await res.json() };
}

test('language: "en"이면 AI 호출에 en이 전달된다', async () => {
  const res = await post({ language: 'en' });
  assert.equal(res.status, 200);
  assert.equal(capturedLanguage, 'en');
});

test('language가 없거나 허용 목록 밖이면 한국어(ko)로 처리한다', async () => {
  for (const language of [undefined, 'ko', 'ja', 'EN', '', null, 1, { x: 1 }]) {
    const res = await post({ language });
    assert.equal(res.status, 200);
    assert.equal(capturedLanguage, 'ko', String(language));
  }
});

test('시스템 프롬프트: 영어일 때만 답변 언어 지시가 붙고, 한국어 프롬프트는 기존과 같다', () => {
  const ko = aiClient.buildSystemPrompt(null, null, null);
  const koExplicit = aiClient.buildSystemPrompt(null, null, null, 'ko');
  const en = aiClient.buildSystemPrompt(null, null, null, 'en');

  assert.equal(ko, koExplicit);
  assert.ok(!ko.includes('Answer language'));
  assert.ok(en.startsWith(ko), '영어 프롬프트는 한국어 프롬프트 뒤에 지시만 덧붙인다');
  assert.match(en, /Write the entire answer in English/);
  assert.match(en, /original Korean in parentheses/);
  assert.equal(aiClient.buildLanguageNote('ko'), null);
});

test('답변 가드: 영어 답변에 영어 단서가 없으면 영어 안내문을 덧붙이고, 있으면 그대로 둔다', () => {
  const j = (confidence) => ({ confidence });

  const plain = guardAnswer('You need 130 credits to graduate.', j('ESTIMATED'), 'en');
  assert.equal(plain.guarded, true);
  assert.ok(plain.answer.endsWith(NOTICE_EN.ESTIMATED));
  assert.ok(!plain.answer.includes(NOTICE.ESTIMATED));

  const hedged = [
    'This is an estimate. Please confirm with your department.',
    'It is not confirmed whether this applies to you.',
    'Check with the Academic Affairs Office (학사지원과) for the exact rule.',
    'There is insufficient data for this student ID.',
    'I am unable to confirm this from the documents.',
  ];
  for (const text of hedged) assert.equal(guardAnswer(text, j('ESTIMATED'), 'en').guarded, false, text);
});

test('답변 가드: 한국어(기본)는 기존과 같다', () => {
  const r = guardAnswer('졸업학점은 130학점입니다.', { confidence: 'NO_DATA' });
  assert.equal(r.guarded, true);
  assert.ok(r.answer.endsWith(NOTICE.NO_DATA));
});
