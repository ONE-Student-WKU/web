const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const aiClient = require('../services/aiClient');
const careerRouter = require('../routes/career');

/**
 * server/test/career.limits.test.js
 * 진로 탐색 한도(상담 1회 = 고정 질문 → 자유 대화 최대 15번 → 추천받기 최대 3번 → 확정, 하루 새 상담 3번).
 * 화면의 "3~5분만 대화하고 눌러보세요" 흐름에 맞춘 상한이라 정상 상담은 걸리지 않고, 대화 길이·AI 호출 수가 상담마다 묶인다.
 * AI 호출은 mock — 외부 API를 부르지 않는다. 임시 학생을 만들고 끝나면 지운다(세션·메시지는 FK CASCADE).
 */

let server;
let baseUrl;
let studentId;

before(async () => {
  mock.method(aiClient, 'getCareerFollowUp', async () => '다음 질문');
  mock.method(aiClient, 'generateCareerCandidates', async () => [{ careerName: '개발자', reasoning: '이유' }]);
  mock.method(aiClient, 'generateCareerRoadmap', async () => []);

  const [[dept]] = await pool.query('SELECT id FROM departments LIMIT 1');
  const [r] = await pool.query(
    "INSERT INTO students (email, name, department_id, admission_year, enrollment_type, onboarding_completed_at) VALUES (?, ?, ?, 2022, 'GENERAL', NOW())",
    [`career-limits-${Date.now()}@example.test`, `cl${Date.now()}`, dept.id]
  );
  studentId = r.insertId;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: studentId };
    next();
  });
  app.use('/api/career', careerRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

const call = async (method, path, body) => {
  const res = await fetch(`${baseUrl}/api/career${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const FIXED = Array.from({ length: 5 }, (_, i) => ({ question: `질문${i}`, answer: `답변${i}` }));

test('상담 한 번: 자유 대화 15번, 추천받기 3번, 확정은 추천마다 한 번', async () => {
  const created = await call('POST', '/sessions');
  assert.equal(created.status, 201);
  const sid = created.body.data.id;

  assert.equal((await call('POST', `/sessions/${sid}/fixed-answers`, { fixedAnswers: FIXED })).status, 200);
  // 대화가 시작된 뒤 고정 답변을 다시 "처음 제출"하면 기록이 불어나므로 거절(수정은 PATCH로 한다).
  const again = await call('POST', `/sessions/${sid}/fixed-answers`, { fixedAnswers: FIXED });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'FIXED_ANSWERS_ALREADY_SUBMITTED');
  // 답 고치기(PATCH)는 그대로 된다.
  assert.equal((await call('PATCH', `/sessions/${sid}/fixed-answers`, { fixedAnswers: FIXED })).status, 200);

  for (let i = 0; i < 15; i++) {
    const res = await call('POST', `/sessions/${sid}/messages`, { content: `대화${i}` });
    assert.equal(res.status, 200, `대화 ${i + 1}번째`);
  }
  const over = await call('POST', `/sessions/${sid}/messages`, { content: '16번째' });
  assert.equal(over.status, 409);
  assert.equal(over.body.code, 'CAREER_TURN_LIMIT');

  for (let i = 0; i < 3; i++) {
    assert.equal((await call('POST', `/sessions/${sid}/candidates`)).status, 200, `추천 ${i + 1}번째`);
  }
  const fourth = await call('POST', `/sessions/${sid}/candidates`);
  assert.equal(fourth.status, 429);
  assert.equal(fourth.body.code, 'CAREER_CANDIDATE_LIMIT');

  assert.equal((await call('POST', `/sessions/${sid}/confirm`, { careerName: '개발자' })).status, 200);
  // 같은 추천 결과로 확정(로드맵 AI 호출)을 반복할 수 없다 — 다시 확정하려면 추천을 새로 받아야 한다.
  const reconfirm = await call('POST', `/sessions/${sid}/confirm`, { careerName: '개발자' });
  assert.equal(reconfirm.status, 409);
  assert.equal(reconfirm.body.code, 'CAREER_NOT_READY_TO_CONFIRM');
});

test('하루에 새 상담은 3번까지(오늘 이미 1번 시작함)', async () => {
  assert.equal((await call('POST', '/sessions')).status, 201);
  assert.equal((await call('POST', '/sessions')).status, 201);
  const fourth = await call('POST', '/sessions');
  assert.equal(fourth.status, 429);
  assert.equal(fourth.body.code, 'CAREER_DAILY_SESSION_LIMIT');
});

test('네트워크 오류 뒤 고정 답변 재시도는 된다(AI 후속 질문 전이면 다시 제출 가능)', async () => {
  await pool.query('DELETE FROM career_sessions WHERE student_id = ?', [studentId]);
  const sid = (await call('POST', '/sessions')).body.data.id;
  // 첫 제출이 고정 답변 저장 후 AI 단계에서 실패한 상황을 만든다.
  for (const { question, answer } of FIXED) {
    await pool.query("INSERT INTO career_messages (session_id, role, content) VALUES (?, 'assistant', ?), (?, 'user', ?)", [sid, question, sid, answer]);
  }
  const retry = await call('POST', `/sessions/${sid}/fixed-answers`, { fixedAnswers: FIXED });
  assert.equal(retry.status, 200);
  // 중복 없이 고정 답변 5쌍 + AI 질문 1개.
  assert.equal(retry.body.data.messages.length, FIXED.length * 2 + 1);
});

test('같은 사용자의 AI 요청은 한 번에 하나씩만 처리한다(동시 요청으로 상한 우회 불가)', async () => {
  await pool.query('DELETE FROM career_sessions WHERE student_id = ?', [studentId]);
  const sid = (await call('POST', '/sessions')).body.data.id;
  await call('POST', `/sessions/${sid}/fixed-answers`, { fixedAnswers: FIXED });
  aiClient.getCareerFollowUp.mock.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return '다음 질문';
  });
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => call('POST', `/sessions/${sid}/messages`, { content: `동시${i}` })));
  const [[{ count }]] = await pool.query("SELECT COUNT(*) AS count FROM career_messages WHERE session_id = ? AND role = 'user'", [sid]);
  assert.ok(Number(count) <= FIXED.length + 15, `상한을 넘어 ${count}개가 저장됐다`);
  assert.ok(results.some((r) => r.status === 429 && r.body.code === 'REQUEST_IN_PROGRESS'));
});
