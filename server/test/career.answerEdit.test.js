const { test, before, after, mock, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const aiClient = require('../services/aiClient');
const careerRouter = require('../routes/career');
const { parseAnswersUpdate } = require('../services/careerAnswerUpdates');

/**
 * server/test/career.answerEdit.test.js
 * 진로 탐색 처음 답변 고치기(이슈 #245, #378 결정 14-1 C·14-2 A·14-3 A).
 * 예전: 고정 답변을 덮어쓰기만 하고 AI 반응이 없어, AI는 학생이 생각을 바꾼 걸 몰랐다.
 * 지금: 원래 답은 남기고 바뀐 내용을 기록 → AI가 한 번 응답(이어서 대화 / 처음부터 다시). AI 호출은 mock.
 */

let server;
let baseUrl;
let studentId;
let followUpCalls = [];

before(async () => {
  mock.method(aiClient, 'getCareerFollowUp', async (history) => { followUpCalls.push(history); return '다음 질문'; });
  const [[dept]] = await pool.query('SELECT id FROM departments LIMIT 1');
  const [r] = await pool.query(
    "INSERT INTO students (email, name, department_id, admission_year, enrollment_type, onboarding_completed_at) VALUES (?, ?, ?, 2022, 'GENERAL', NOW())",
    [`career-edit-${Date.now()}@example.test`, `ce${Date.now()}`, dept.id]
  );
  studentId = r.insertId;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { userId: studentId }; next(); });
  app.use('/api/career', careerRouter);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

beforeEach(async () => {
  followUpCalls = [];
  await pool.query('DELETE FROM career_sessions WHERE student_id = ?', [studentId]); // 하루 새 상담 한도에 걸리지 않게
});

const call = async (method, path, body) => {
  const res = await fetch(`${baseUrl}/api/career${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const FIXED = Array.from({ length: 5 }, (_, i) => ({ question: `질문${i}`, answer: `답변${i}` }));
const changed = (index, answer) => FIXED.map((a, i) => (i === index ? { ...a, answer } : a));
const startChat = async () => {
  const sid = (await call('POST', '/sessions')).body.data.id;
  await call('POST', `/sessions/${sid}/fixed-answers`, { fixedAnswers: FIXED });
  return sid;
};

test('이어서 대화: 원래 답은 남기고 바뀐 내용을 기록한 뒤 AI가 바로 한 번 응답한다 — AI는 "바꿨다"는 사실과 새 답을 본다', async () => {
  const sid = await startChat();
  await call('POST', `/sessions/${sid}/messages`, { content: '옛 답 기준 대화' });
  followUpCalls = [];

  const res = await call('PATCH', `/sessions/${sid}/fixed-answers`, { fixedAnswers: changed(1, '새답변'), mode: 'CONTINUE' });
  assert.equal(res.status, 200);
  const messages = res.body.data.messages;
  assert.equal(messages[3].content, '답변1', '대화 맨 앞의 원래 답은 덮어쓰지 않는다');
  const update = parseAnswersUpdate(messages.at(-2).content);
  assert.deepEqual(update.changes, [{ index: 1, question: '질문1', before: '답변1', after: '새답변' }]);
  assert.equal(messages.at(-1).role, 'assistant');

  assert.equal(followUpCalls.length, 1, 'AI가 한 번 응답');
  const history = followUpCalls[0];
  assert.equal(history[3].content, '새답변', 'AI에게는 지금 유효한 답');
  assert.ok(history.some((m) => m.content === '옛 답 기준 대화'), '이어서 대화라 이전 대화가 남는다');
  assert.match(history.at(-1).content, /이전 답은 취소하고 새 답으로 바꿨다.*「질문1」: 이전 "답변1" → 새 "새답변".*새 답만 학생의 답으로/);
});

test('처음부터 다시: 이전 대화는 지우지 않지만 AI에게는 바뀐 답과 그 뒤 대화만 보낸다', async () => {
  const sid = await startChat();
  await call('POST', `/sessions/${sid}/messages`, { content: '옛 대화' });
  followUpCalls = [];

  await call('PATCH', `/sessions/${sid}/fixed-answers`, { fixedAnswers: changed(0, '다시답변'), mode: 'RESTART' });
  const history = followUpCalls[0];
  assert.equal(history.length, 10, '고정 질문 블록만 남기고 새로 시작');
  assert.equal(history[1].content, '다시답변');
  const [[{ count }]] = await pool.query("SELECT COUNT(*) AS count FROM career_messages WHERE session_id = ? AND content = '옛 대화'", [sid]);
  assert.equal(count, 1, '이전 대화는 기록에 남는다');

  followUpCalls = [];
  await call('POST', `/sessions/${sid}/messages`, { content: '새 대화' });
  assert.ok(!followUpCalls[0].some((m) => m.content === '옛 대화'), '다시 시작한 뒤에도 이전 대화는 보내지 않는다');
});

test('바뀐 답이 없으면 기록·AI 호출 없이 그대로 돌려준다', async () => {
  const sid = await startChat();
  followUpCalls = [];
  const res = await call('PATCH', `/sessions/${sid}/fixed-answers`, { fixedAnswers: FIXED, mode: 'CONTINUE' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.messages.length, 11);
  assert.equal(followUpCalls.length, 0);
});

test('답 고치기 기록도 자유 대화 한도(15번)에 들어가 "다시 시작"을 반복해 한도를 넘기지 못한다', async () => {
  const sid = await startChat();
  for (let i = 0; i < 14; i++) await call('POST', `/sessions/${sid}/messages`, { content: `대화${i}` });
  assert.equal((await call('PATCH', `/sessions/${sid}/fixed-answers`, { fixedAnswers: changed(2, 'x'), mode: 'RESTART' })).status, 200);
  const over = await call('PATCH', `/sessions/${sid}/fixed-answers`, { fixedAnswers: changed(2, 'y'), mode: 'RESTART' });
  assert.equal(over.status, 409);
  assert.equal(over.body.code, 'CAREER_TURN_LIMIT');
});

test('모르는 방식은 거절한다', async () => {
  const sid = await startChat();
  const res = await call('PATCH', `/sessions/${sid}/fixed-answers`, { fixedAnswers: changed(0, 'z'), mode: 'REWIND' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_UPDATE_MODE');
});
