process.env.RESEND_API_KEY ||= 're_test_dummy';
process.env.GOOGLE_CLIENT_ID ||= 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET ||= 'test-client-secret';
process.env.OAUTH_CALLBACK_BASE_URL ||= 'http://localhost:5173';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const authRouter = require('../routes/auth');
const myCoursesRouter = require('../routes/myCourses');

/**
 * server/test/rateLimit.keys.test.js
 * 요청 횟수 제한이 IP가 아니라 이메일·계정 단위로 세는지 본다(#378 배포 담당 확인, 2026-10-15).
 * 운영에서는 서버가 보는 IP가 학생이 아니라 Vercel 주소라, IP 단위 제한은 모든 학생이 한도를 나눠 쓰게 만들었다.
 * 이 테스트의 요청은 모두 같은 IP(127.0.0.1)에서 나가므로, 운영에서 "모든 학생이 같은 IP로 보이는" 상황과 같다.
 * 형식이 틀린 이메일·빈 텍스트로 보내 핸들러가 DB·메일·AI에 닿기 전에 400으로 끝나게 한다(제한에 걸리면 429).
 */

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  // 요청 헤더로 로그인한 계정을 흉내 낸다(없으면 비로그인).
  app.use((req, res, next) => {
    const userId = req.get('x-test-user');
    req.session = userId ? { userId: Number(userId) } : {};
    next();
  });
  app.use('/api/auth', authRouter);
  app.use('/api/my-courses', myCoursesRouter);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function post(path, body, userId = null) {
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-test-user': String(userId) } : {}) },
    body: JSON.stringify(body),
  });
  return res.status;
}

test('인증코드 요청: 같은 IP라도 학생(이메일)마다 따로 센다 — 다른 학생 6명은 막히지 않는다', async () => {
  for (let i = 0; i < 6; i += 1) {
    assert.equal(await post('/api/auth/email/request', { email: `student${i}<x@y.z>` }), 400, `학생 ${i}`);
  }
});

test('인증코드 요청: 같은 이메일은 10분에 5번까지, 6번째는 막힌다', async () => {
  const email = 'same<x@y.z>';
  for (let i = 0; i < 5; i += 1) assert.equal(await post('/api/auth/email/request', { email }), 400);
  assert.equal(await post('/api/auth/email/request', { email }), 429);
  // 대소문자·앞뒤 공백만 바꾼 같은 주소도 같은 한도를 쓴다
  assert.equal(await post('/api/auth/email/request', { email: '  SAME<x@y.z>  ' }), 429);
});

test('성적 가져오기: 같은 IP라도 계정마다 따로 센다 — 한 사람이 한도를 다 써도 다른 사람은 쓸 수 있다', async () => {
  for (let i = 0; i < 10; i += 1) assert.equal(await post('/api/my-courses/import/text', { text: '' }, 101), 400);
  assert.equal(await post('/api/my-courses/import/text', { text: '' }, 101), 429);
  assert.equal(await post('/api/my-courses/import/text', { text: '' }, 102), 400);
});
