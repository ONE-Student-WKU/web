const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const meRouter = require('../routes/me');

/**
 * server/test/me.leavePeriods.test.js
 * 휴학 기간 저장(PUT /api/me/leave-periods): 답하지 않은 계정은 leavePeriods가 null이고 질문이 필요하다고 내려가며,
 * 저장하면 누적 휴학 학기 수가 합계로 채워진다. 잘못된 기간은 거부하고, 학번을 바꿔 기간이 맞지 않게 되면 비워서 다시 묻는다.
 * DB에 임시 학생을 만들고 끝나면 지운다. 전제: db:migrate(students.leave_periods).
 */

let server;
let baseUrl;
let studentId;

before(async () => {
  const [result] = await pool.query(
    `INSERT INTO students (email, name, admission_year, enrollment_type, onboarding_completed_at) VALUES (?, ?, 2022, 'GENERAL', NOW())`,
    [`me-leave-${Date.now()}@example.test`, `meleave${Date.now()}`]
  );
  studentId = result.insertId;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: studentId };
    next();
  });
  app.use('/api', meRouter);
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
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('휴학 질문에 답하지 않은 계정은 leavePeriods가 null이고 질문이 필요하다', async () => {
  const me = await call('GET', '/me');
  assert.equal(me.body.data.leavePeriods, null);
  assert.equal(me.body.data.leaveAnswerRequired, true);
});

test('휴학 없음([])으로 답하면 질문이 더는 필요 없다', async () => {
  const res = await call('PUT', '/me/leave-periods', { periods: [] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.leavePeriods, []);
  assert.equal(res.body.data.leaveAnswerRequired, false);
  assert.equal(res.body.data.leaveSemesters, 0);
});

test('기간을 저장하면 정렬해서 저장하고 누적 휴학 학기 수를 합계로 채운다', async () => {
  const res = await call('PUT', '/me/leave-periods', {
    periods: [{ startYear: 2025, startSemester: 2, semesters: 1 }, { startYear: 2023, startSemester: 1, semesters: 4 }],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.leavePeriods, [
    { startYear: 2023, startSemester: 1, semesters: 4 },
    { startYear: 2025, startSemester: 2, semesters: 1 },
  ]);
  assert.equal(res.body.data.leaveSemesters, 5);
});

test('잘못된 기간(입학 전·겹침·형식)은 거부하고 기존 값을 그대로 둔다', async () => {
  assert.equal((await call('PUT', '/me/leave-periods', { periods: [{ startYear: 2021, startSemester: 1, semesters: 1 }] })).body.code, 'LEAVE_BEFORE_ADMISSION');
  assert.equal((await call('PUT', '/me/leave-periods', {
    periods: [{ startYear: 2023, startSemester: 1, semesters: 4 }, { startYear: 2024, startSemester: 1, semesters: 1 }],
  })).body.code, 'LEAVE_PERIODS_OVERLAP');
  assert.equal((await call('PUT', '/me/leave-periods', { periods: 'x' })).body.code, 'INVALID_LEAVE_PERIODS');
  const me = await call('GET', '/me');
  assert.equal(me.body.data.leaveSemesters, 5);
});

test('기간을 입력한 계정은 휴학 학기 수를 따로 고칠 수 없다', async () => {
  const res = await call('PATCH', '/me', { leaveSemesters: 2 });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'USE_LEAVE_PERIODS');
});

test('학번을 바꿔 기간이 입학 전이 되면 비워서 다시 묻는다', async () => {
  const res = await call('PATCH', '/me', { admissionYear: 2024 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.leavePeriods, null);
  assert.equal(res.body.data.leaveAnswerRequired, true);
});
