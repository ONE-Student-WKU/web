const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const meRouter = require('../routes/me');

/**
 * server/test/me.homeLayout.test.js
 * 홈 화면 편집 설정 저장(PATCH /api/me의 homeLayout): 저장하면 GET에 그대로 내려오고, 잘못된 값은 거부하며, null은 기본 배치로 되돌린다.
 * DB에 임시 학생을 만들고 끝나면 지운다. 전제: db:migrate(students.home_layout).
 */

let server;
let baseUrl;
let studentId;

before(async () => {
  const [result] = await pool.query(
    `INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())`,
    [`me-home-${Date.now()}@example.test`, `mehome${Date.now()}`]
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
  const res = await fetch(`${baseUrl}/api/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

const layout = { tabs: ['courses', 'home', 'career', 'inquiry'], showTabBar: false };

test('편집한 적 없는 계정은 homeLayout이 null(기본 배치)이다', async () => {
  assert.equal((await getMe()).data.homeLayout, null);
});

test('저장하면 응답과 이후 GET에 그대로 반영된다', async () => {
  const res = await patchMe({ homeLayout: layout });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.homeLayout, layout);
  assert.deepEqual((await getMe()).data.homeLayout, layout);
});

test('잘못된 설정은 거부하고 기존 값을 그대로 둔다', async () => {
  const res = await patchMe({ homeLayout: { ...layout, tabs: ['courses', 'career', 'home'] } });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_HOME_LAYOUT');
  assert.deepEqual((await getMe()).data.homeLayout, layout);
});

test('빈 자리(null)가 있는 설정과 메뉴 순서도 저장된다', async () => {
  const partial = { tabs: [null, 'home', null, null], showTabBar: true, menu: ['inquiry', 'community', 'career', 'graduation', 'courses'] };
  const res = await patchMe({ homeLayout: partial });
  assert.equal(res.status, 200);
  assert.deepEqual((await getMe()).data.homeLayout, partial);
});

test('null을 보내면 기본 배치로 되돌린다', async () => {
  const res = await patchMe({ homeLayout: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.homeLayout, null);
});
