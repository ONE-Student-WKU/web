const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const meRouter = require('../routes/me');
const onboardingRouter = require('../routes/onboarding');

/**
 * server/test/onboarding.teachingCourse.test.js
 * 교직과정 이수 여부(students.teaching_course)와 편입 인정학점(students.transfer_recognized_credits) 입력:
 * 온보딩 POST와 프로필 PATCH /api/me가 같은 규칙(services/teachingCourse.js, DECISIONS D-67)으로 검증하고 저장한다.
 * DB에 임시 학생 1명을 만들고 끝나면 지운다. 전제: db:migrate(students.teaching_course, transfer_recognized_credits).
 */

let server;
let baseUrl;
let studentId;
let deptA;
let deptB;

before(async () => {
  const [depts] = await pool.query('SELECT id FROM departments ORDER BY id LIMIT 2');
  [deptA, deptB] = depts.map((d) => d.id);
  const [result] = await pool.query('INSERT INTO students (email, name) VALUES (?, ?)', [`onb-teaching-${Date.now()}@example.test`, `onbtc${Date.now()}`]);
  studentId = result.insertId;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: studentId };
    next();
  });
  app.use('/api/onboarding', onboardingRouter);
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

const send = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const resetOnboarding = () => pool.query('UPDATE students SET onboarding_completed_at = NULL WHERE id = ?', [studentId]);
const post = async (body) => {
  await resetOnboarding();
  return send('POST', '/api/onboarding', { departmentId: deptA, admissionYear: 2024, ...body });
};
const patch = (body) => send('PATCH', '/api/me', body);
const row = async () => (await pool.query('SELECT enrollment_type, teaching_course, transfer_recognized_credits FROM students WHERE id = ?', [studentId]))[0][0];

test('온보딩: 편입생·3학년 전과생은 교직 여부를 보낼 수 없다', async () => {
  const transfer = await post({ enrollmentType: 'TRANSFER_ADMISSION', transferGrade: 3, teachingCourse: true });
  assert.equal(transfer.status, 400);
  assert.equal(transfer.body.code, 'TEACHING_COURSE_NOT_ALLOWED');
  const majorChange = await post({ enrollmentType: 'MAJOR_CHANGE', majorChangeGrade: 3, majorChangeYear: 2026, majorChangeSemester: 1, teachingCourse: false });
  assert.equal(majorChange.status, 400);
  assert.equal(majorChange.body.code, 'TEACHING_COURSE_NOT_ALLOWED');
});

test('온보딩: 일반 재학생의 교직 이수 여부가 저장되고 응답·프로필에 실린다', async () => {
  const res = await post({ enrollmentType: 'GENERAL', teachingCourse: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.teachingCourse, true);
  assert.equal((await row()).teaching_course, 1);
  const me = await send('GET', '/api/me');
  assert.equal(me.body.data.teachingCourse, true);
  assert.equal(me.body.data.transferRecognizedCredits, null);
});

test('온보딩: 편입 인정학점은 편입생만 보낼 수 있고 저장된다', async () => {
  const general = await post({ enrollmentType: 'GENERAL', transferRecognizedCredits: 65 });
  assert.equal(general.status, 400);
  assert.equal(general.body.code, 'INVALID_TRANSFER_RECOGNIZED_CREDITS');
  const res = await post({ enrollmentType: 'TRANSFER_ADMISSION', transferGrade: 3, transferRecognizedCredits: 65 });
  assert.equal(res.status, 200);
  const saved = await row();
  assert.equal(saved.transfer_recognized_credits, 65);
  assert.equal(saved.teaching_course, null);
});

test('프로필: 편입생이 아닌 유형으로 바꾸면 인정학점을 비우고, 교직 여부를 새로 받을 수 있다', async () => {
  const res = await patch({ enrollmentType: 'GENERAL', teachingCourse: false });
  assert.equal(res.status, 200);
  const saved = await row();
  assert.equal(saved.transfer_recognized_credits, null);
  assert.equal(saved.teaching_course, 0);
});

test('프로필: 같은 학과를 다시 보내면 교직 답을 유지하고, 학과가 바뀌면 함께 보내지 않은 교직 답을 비운다', async () => {
  await patch({ departmentId: deptA, teachingCourse: true });
  assert.equal((await patch({ departmentId: deptA })).status, 200);
  assert.equal((await row()).teaching_course, 1);
  assert.equal((await patch({ departmentId: deptB })).status, 200);
  assert.equal((await row()).teaching_course, null);
});

test('프로필: 편입생으로 바꾸면 보내지 않은 교직 답도 비운다(편입생은 교직과정 이수 불가)', async () => {
  await patch({ teachingCourse: true });
  const res = await patch({ enrollmentType: 'TRANSFER_ADMISSION', admissionYear: 2024, transferGrade: 3 });
  assert.equal(res.status, 200);
  assert.equal((await row()).teaching_course, null);
  const bad = await patch({ teachingCourse: true });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'TEACHING_COURSE_NOT_ALLOWED');
});
