const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const meRouter = require('../routes/me');
const onboardingRouter = require('../routes/onboarding');

/**
 * server/test/onboarding.transferGrade.test.js
 * 편입생의 편입 학년(students.transfer_grade) 입력: 온보딩 POST와 프로필 PATCH /api/me가 같은 규칙으로 검증하고 저장한다.
 * 근거: 교육과정 운영에 관한 규정 제14조③ — 편입생은 "편입한 학년의 입학년도 교육과정"을 따르므로 학번(admission_year)은 화면이
 * "편입 연도 − 편입 학년 + 1"로 계산해 보내고, 서버는 편입 학년(2~4)을 함께 저장한다(편입 연도는 학번 + 학년 − 1로 되돌린다).
 * DB에 임시 학생 1명을 만들고 끝나면 지운다. 전제: db:migrate(students.transfer_grade).
 */

let server;
let baseUrl;
let studentId;
let departmentId;

before(async () => {
  const [[dept]] = await pool.query('SELECT id FROM departments LIMIT 1');
  departmentId = dept.id;
  const [result] = await pool.query('INSERT INTO students (email, name) VALUES (?, ?)', [`onb-transfer-${Date.now()}@example.test`, `onbtr${Date.now()}`]);
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
const post = (body) => send('POST', '/api/onboarding', { departmentId, ...body });
const patch = (body) => send('PATCH', '/api/me', body);
const row = async () => (await pool.query('SELECT enrollment_type, admission_year, transfer_grade FROM students WHERE id = ?', [studentId]))[0][0];

// ---------------------------------------------------------------- 온보딩 POST

test('온보딩: 편입생은 편입 학년이 필수다', async () => {
  const res = await post({ admissionYear: 2024, enrollmentType: 'TRANSFER_ADMISSION' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'REQUIRED_TRANSFER_GRADE');
});

test('온보딩: 편입 학년은 2~4만 받는다', async () => {
  for (const transferGrade of [1, 5, 0, 'x']) {
    const res = await post({ admissionYear: 2024, enrollmentType: 'TRANSFER_ADMISSION', transferGrade });
    assert.equal(res.status, 400, String(transferGrade));
    assert.equal(res.body.code, 'INVALID_TRANSFER_GRADE');
  }
});

test('온보딩: 편입생이 아닌 유형이 편입 학년을 보내면 거부한다', async () => {
  const res = await post({ admissionYear: 2024, enrollmentType: 'GENERAL', transferGrade: 3 });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_TRANSFER_GRADE');
});

test('온보딩: 2026년 3학년 편입 → 학번 2024 + 편입 학년 3이 저장되고 응답에도 실린다', async () => {
  const res = await post({ admissionYear: 2024, enrollmentType: 'TRANSFER_ADMISSION', transferGrade: 3 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.transferGrade, 3);
  assert.deepEqual(await row(), { enrollment_type: 'TRANSFER_ADMISSION', admission_year: 2024, transfer_grade: 3 });
  const me = await (await fetch(`${baseUrl}/api/me`)).json();
  assert.equal(me.data.transferGrade, 3);
  assert.equal(me.data.admissionYear + me.data.transferGrade - 1, 2026, '편입 연도 = 학번 + 학년 − 1');
});

// ---------------------------------------------------------------- 프로필 PATCH

test('프로필: 편입 학년을 고치면 반영된다', async () => {
  const res = await patch({ transferGrade: 4, admissionYear: 2023 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.transferGrade, 4);
  assert.deepEqual(await row(), { enrollment_type: 'TRANSFER_ADMISSION', admission_year: 2023, transfer_grade: 4 });
});

test('프로필: 편입 학년 값이 범위를 벗어나면 400', async () => {
  for (const transferGrade of [1, 5, 'x']) {
    const res = await patch({ transferGrade });
    assert.equal(res.status, 400, String(transferGrade));
    assert.equal(res.body.code, 'INVALID_TRANSFER_GRADE');
  }
});

test('프로필: 편입생에서 다른 유형으로 바꾸면 이전 편입 학년이 지워진다(학년을 같이 안 보내도)', async () => {
  const res = await patch({ enrollmentType: 'GENERAL' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.transferGrade, null);
  assert.equal((await row()).transfer_grade, null);
});

test('프로필: 편입생이 아닌 계정에 편입 학년을 넣으면 400', async () => {
  const res = await patch({ transferGrade: 3 });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_TRANSFER_GRADE');
});

test('프로필: 편입생으로 바꾸려면 편입 학년을 같이 보내야 한다(학번을 다시 계산해야 하므로)', async () => {
  const missing = await patch({ enrollmentType: 'TRANSFER_ADMISSION', admissionYear: 2024 });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'REQUIRED_TRANSFER_GRADE');
  const ok = await patch({ enrollmentType: 'TRANSFER_ADMISSION', admissionYear: 2024, transferGrade: 3 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.transferGrade, 3);
});

test('옛 방식으로 입력한 편입생(편입 학년 없음)은 다른 항목만 고칠 때 편입 학년을 요구받지 않는다', async () => {
  await pool.query("UPDATE students SET enrollment_type = 'TRANSFER_ADMISSION', transfer_grade = NULL WHERE id = ?", [studentId]);
  const res = await patch({ leaveSemesters: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.transferGrade, null);
  assert.equal(res.body.data.leaveSemesters, 2);
});
