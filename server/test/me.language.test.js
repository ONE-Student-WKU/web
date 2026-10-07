const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const meRouter = require('../routes/me');

/**
 * server/test/me.language.test.js
 * 계정에 화면·챗봇 답변 언어 저장(students.language): GET /api/me가 값을 내려주고, PATCH /api/me가 지원하는 언어만 받는다.
 * 언어를 정한 적 없는 계정은 null. DB에 임시 학생을 만들고 끝나면 지운다. 전제: db:migrate(students.language).
 */

let server;
let baseUrl;
let studentId;

before(async () => {
  const [result] = await pool.query(
    `INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())`,
    [`me-lang-${Date.now()}@example.test`, `melang${Date.now()}`]
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

const getMe = async () => (await fetch(`${baseUrl}/api/me`)).json();
const patchMe = async (body) => {
  const res = await fetch(`${baseUrl}/api/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('언어를 정한 적 없는 계정은 language가 null이다', async () => {
  const me = await getMe();
  assert.equal(me.data.language, null);
});

test('PATCH /api/me로 en을 저장하면 응답과 이후 GET에 반영된다', async () => {
  const res = await patchMe({ language: 'en' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.language, 'en');
  assert.equal((await getMe()).data.language, 'en');
});

test('ko로 다시 바꿀 수 있다', async () => {
  const res = await patchMe({ language: 'ko' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.language, 'ko');
});

test('지원하지 않는 값은 400 INVALID_LANGUAGE이고 기존 값은 그대로다', async () => {
  await patchMe({ language: 'en' });
  for (const language of ['ja', 'EN', '', null, 1, { x: 1 }]) {
    const res = await patchMe({ language });
    assert.equal(res.status, 400, String(language));
    assert.equal(res.body.code, 'INVALID_LANGUAGE');
  }
  assert.equal((await getMe()).data.language, 'en');
});

test('다른 필드만 수정해도 언어는 바뀌지 않는다', async () => {
  const res = await patchMe({ leaveSemesters: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.language, 'en');
  assert.equal(res.body.data.leaveSemesters, 2);
});
