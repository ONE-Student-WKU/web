const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const meRouter = require('../routes/me');
const { secondMajorTypeOf, validateSecondMajor } = require('../services/secondMajor');

/**
 * server/test/secondMajor.input.test.js
 * 다전공(복수전공·부전공) 입력(#378 G-1, 결정 4-1 A·4-2 A): PATCH /api/me가 제2전공 학과와 구분을 함께 저장하고 검증한다.
 * DB에 임시 학생 1명을 만들고 끝나면 지운다.
 */

let server;
let baseUrl;
let studentId;
let primary;
let other;
let third;

before(async () => {
  [[primary]] = await pool.query("SELECT id FROM departments WHERE name = '컴퓨터·소프트웨어공학과'");
  [[other]] = await pool.query("SELECT id FROM departments WHERE name = '경영학과'");
  [[third]] = await pool.query("SELECT id FROM departments WHERE name = '국어국문학과'");
  const [result] = await pool.query(
    "INSERT INTO students (email, name, department_id, admission_year, enrollment_type, onboarding_completed_at) VALUES (?, ?, ?, 2022, 'GENERAL', NOW())",
    [`second-major-${Date.now()}@example.test`, `sm${Date.now()}`, primary.id]
  );
  studentId = result.insertId;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { userId: studentId }; next(); });
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

const patch = async (body) => {
  const res = await fetch(`${baseUrl}/api/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const stored = async () => (await pool.query('SELECT second_department_id AS d, second_major_type AS t FROM students WHERE id = ?', [studentId]))[0][0];

test('구분: 학과가 없으면 null, 구분 없이 학과만 있는 옛 행은 복수전공으로 본다', () => {
  assert.equal(secondMajorTypeOf({ second_department_id: null, second_major_type: 'MINOR' }), null);
  assert.equal(secondMajorTypeOf({ second_department_id: 3, second_major_type: null }), 'DOUBLE');
  assert.equal(secondMajorTypeOf({ second_department_id: 3, second_major_type: 'MINOR' }), 'MINOR');
});

test('검증: 잘못된 구분, 학과 없는 구분, 주전공과 같은 학과는 거절한다', () => {
  assert.equal(validateSecondMajor({ secondMajorType: 'TRIPLE' }, { departmentId: 1, secondDepartmentId: 2 }), 'INVALID_SECOND_MAJOR_TYPE');
  assert.equal(validateSecondMajor({ secondMajorType: 'MINOR' }, { departmentId: 1, secondDepartmentId: null }), 'REQUIRED_SECOND_DEPARTMENT');
  assert.equal(validateSecondMajor({ secondDepartmentId: 1 }, { departmentId: 1, secondDepartmentId: 1 }), 'SECOND_DEPARTMENT_SAME_AS_PRIMARY');
  assert.equal(validateSecondMajor({}, { departmentId: 1, secondDepartmentId: null }), null);
});

test('프로필: 부전공을 저장하고 응답에 구분이 실린다', async () => {
  const r = await patch({ secondDepartmentId: other.id, secondMajorType: 'MINOR' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(await stored(), { d: other.id, t: 'MINOR' });
  assert.equal(r.body.data.secondMajorType, 'MINOR');
  assert.equal(r.body.data.secondDepartmentId, other.id);
});

test('프로필: 학과만 바꾸면 구분은 그대로, 구분 없이 처음 고르면 복수전공, 학과를 지우면 구분도 지운다', async () => {
  await patch({ secondDepartmentId: third.id });
  assert.deepEqual(await stored(), { d: third.id, t: 'MINOR' });
  await patch({ secondDepartmentId: null });
  assert.deepEqual(await stored(), { d: null, t: null });
  await patch({ secondDepartmentId: other.id });
  assert.deepEqual(await stored(), { d: other.id, t: 'DOUBLE' });
  await patch({ language: 'ko' });
  assert.deepEqual(await stored(), { d: other.id, t: 'DOUBLE' }, '다른 항목만 바꾸면 그대로');
});

test('프로필: 주전공과 같은 학과, 주전공을 제2전공 학과로 바꾸는 요청은 거절한다', async () => {
  assert.equal((await patch({ secondDepartmentId: primary.id, secondMajorType: 'DOUBLE' })).body.code, 'SECOND_DEPARTMENT_SAME_AS_PRIMARY');
  assert.equal((await patch({ departmentId: other.id })).body.code, 'SECOND_DEPARTMENT_SAME_AS_PRIMARY');
  assert.equal((await patch({ secondMajorType: 'NONE' })).body.code, 'INVALID_SECOND_MAJOR_TYPE');
});
