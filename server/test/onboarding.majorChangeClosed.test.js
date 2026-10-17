const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const meRouter = require('../routes/me');
const onboardingRouter = require('../routes/onboarding');

/**
 * server/test/onboarding.majorChangeClosed.test.js
 * 의·치·한의예(학)과·약학대학으로는 전과할 수 없다(학칙시행규칙 제111조 제4호, 2026-10-17). 온보딩 POST와 프로필 PATCH 모두 거절한다.
 */

let server;
let baseUrl;
let studentId;
let closedDept;
let openDept;

before(async () => {
  const [[closed]] = await pool.query("SELECT id FROM departments WHERE name = '약학과' LIMIT 1");
  const [[open]] = await pool.query("SELECT id FROM departments WHERE name = '컴퓨터·소프트웨어공학과' LIMIT 1");
  closedDept = closed.id;
  openDept = open.id;
  const [result] = await pool.query('INSERT INTO students (email, name) VALUES (?, ?)', [`onb-closed-${Date.now()}@example.test`, `onbcl${Date.now()}`]);
  studentId = result.insertId;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { userId: studentId }; next(); });
  app.use('/api/onboarding', onboardingRouter);
  app.use('/api', meRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

const send = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const majorChange = { enrollmentType: 'MAJOR_CHANGE', majorChangeGrade: 2, majorChangeYear: 2025, majorChangeSemester: 1 };

test('온보딩: 약학과 전과생은 거절, 다른 학과 전과생은 저장', async () => {
  await pool.query('UPDATE students SET onboarding_completed_at = NULL WHERE id = ?', [studentId]);
  const closed = await send('POST', '/api/onboarding', { departmentId: closedDept, admissionYear: 2024, ...majorChange });
  assert.equal(closed.status, 400);
  assert.equal(closed.body.code, 'MAJOR_CHANGE_CLOSED_DEPARTMENT');
  const open = await send('POST', '/api/onboarding', { departmentId: openDept, admissionYear: 2024, ...majorChange });
  assert.equal(open.status, 200, JSON.stringify(open.body));
});

test('프로필 수정: 전과생이 학과를 약학과로 바꾸면 거절', async () => {
  const res = await send('PATCH', '/api/me', { departmentId: closedDept });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'MAJOR_CHANGE_CLOSED_DEPARTMENT');
});
