const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const studentService = require('../services/studentService');
const adminRouter = require('../routes/admin');

/**
 * server/test/admin.signupCount.test.js
 * 관리자 대시보드의 가입 수(GET /api/admin/stats의 totalStudents)는 전체 계정 수에서 옛 로그인 폼 시절의 테스트 계정 수를 뺀 값이다.
 * 계정 수는 mock으로 정하고(실제 DB의 계정 수와 무관하게 검증), 관리자 세션용 임시 학생 1명만 만들고 끝나면 지운다.
 */

let server;
let baseUrl;
let adminId;
let totalToReturn;

before(async () => {
  const run = Date.now();
  const [r] = await pool.query(
    "INSERT INTO students (email, name, role, onboarding_completed_at) VALUES (?, ?, 'admin', NOW())",
    [`signup-count-${run}@example.test`, `sc${run}`]
  );
  adminId = r.insertId;

  mock.method(studentService, 'countAll', async () => totalToReturn);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: adminId };
    next();
  });
  app.use('/api/admin', adminRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  mock.restoreAll();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (adminId) await pool.query('DELETE FROM students WHERE id = ?', [adminId]);
  await pool.end();
});

async function totalStudents() {
  const res = await fetch(`${baseUrl}/api/admin/stats`);
  assert.equal(res.status, 200);
  return (await res.json()).data.totalStudents;
}

test('전체 계정 수에서 옛 테스트 계정 수(10)를 뺀 값이 가입 수로 나온다', async () => {
  assert.equal(studentService.LEGACY_TEST_ACCOUNT_COUNT, 10);
  totalToReturn = 37;
  assert.equal(await totalStudents(), 27);
});

test('테스트 계정 수와 같거나 더 적으면 0이고 음수가 되지 않는다', async () => {
  totalToReturn = 10;
  assert.equal(await totalStudents(), 0);
  totalToReturn = 4;
  assert.equal(await totalStudents(), 0);
  totalToReturn = 0;
  assert.equal(await totalStudents(), 0);
});

test('countAll 자체는 보정하지 않는다(다른 곳에서 실제 계정 수가 필요할 때 그대로 쓸 수 있다)', async () => {
  mock.restoreAll();
  const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM students');
  assert.equal(await studentService.countAll(), count);
});
