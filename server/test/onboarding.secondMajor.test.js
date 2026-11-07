const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const onboardingRouter = require('../routes/onboarding');

/**
 * server/test/onboarding.secondMajor.test.js
 * 가입할 때도 다전공을 받는다(DECISIONS D-93). 2학년 이상이 처음 가입하면 이미 다전공일 수 있어서다.
 * 규칙은 학적정보 수정과 같다(services/secondMajor.js). DB에 임시 학생 1명을 만들고 끝나면 지운다.
 */

let server;
let baseUrl;
let studentId;
let deptA;
let deptB;

before(async () => {
  const [depts] = await pool.query('SELECT id FROM departments ORDER BY id LIMIT 2');
  [deptA, deptB] = depts.map((d) => d.id);
  const [result] = await pool.query('INSERT INTO students (email, name) VALUES (?, ?)', [`onb-second-${Date.now()}@example.test`, `onbsm${Date.now()}`]);
  studentId = result.insertId;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: studentId };
    next();
  });
  app.use('/api/onboarding', onboardingRouter);
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

beforeEach(async () => {
  await pool.query('UPDATE students SET onboarding_completed_at = NULL, second_department_id = NULL, second_linked_major = NULL, second_major_type = NULL WHERE id = ?', [studentId]);
});

const submit = async (extra) => {
  const res = await fetch(`${baseUrl}/api/onboarding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ departmentId: deptA, admissionYear: 2022, enrollmentType: 'GENERAL', ...extra }),
  });
  return { status: res.status, body: await res.json() };
};
const saved = async () => {
  const [[row]] = await pool.query('SELECT second_department_id, second_linked_major, second_major_type, onboarding_completed_at FROM students WHERE id = ?', [studentId]);
  return row;
};

test('복수전공 학과를 고르면 저장되고 응답에도 실린다', async () => {
  const { status, body } = await submit({ secondDepartmentId: deptB, secondLinkedMajor: null, secondMajorType: 'DOUBLE' });
  assert.equal(status, 200);
  assert.equal(body.data.secondDepartmentId, deptB);
  assert.equal(body.data.secondMajorType, 'DOUBLE');
  const row = await saved();
  assert.equal(row.second_department_id, deptB);
  assert.equal(row.second_major_type, 'DOUBLE');
  assert.ok(row.onboarding_completed_at);
});

test('다전공을 보내지 않거나 없다고 하면 모두 비어 있다', async () => {
  for (const extra of [{}, { secondDepartmentId: null, secondLinkedMajor: null, secondMajorType: null }]) {
    await pool.query('UPDATE students SET onboarding_completed_at = NULL WHERE id = ?', [studentId]);
    assert.equal((await submit(extra)).status, 200);
    const row = await saved();
    assert.equal(row.second_department_id, null);
    assert.equal(row.second_linked_major, null);
    assert.equal(row.second_major_type, null);
  }
});

test('구분 없이 학과만 오면 복수전공으로 저장한다(학적정보 수정과 같다)', async () => {
  assert.equal((await submit({ secondDepartmentId: deptB })).status, 200);
  assert.equal((await saved()).second_major_type, 'DOUBLE');
});

test('잘못된 다전공은 거절하고 가입을 끝내지 않는다', async () => {
  const cases = [
    [{ secondDepartmentId: deptA, secondMajorType: 'DOUBLE' }, 'SECOND_DEPARTMENT_SAME_AS_PRIMARY'],
    [{ secondMajorType: 'MINOR' }, 'REQUIRED_SECOND_DEPARTMENT'],
    [{ secondDepartmentId: deptB, secondMajorType: 'TRIPLE' }, 'INVALID_SECOND_MAJOR_TYPE'],
    [{ secondDepartmentId: 2147483647, secondMajorType: 'DOUBLE' }, 'INVALID_SECOND_DEPARTMENT_ID'],
    [{ secondDepartmentId: 'abc', secondMajorType: 'DOUBLE' }, 'INVALID_SECOND_DEPARTMENT_ID'],
    [{ secondDepartmentId: deptB, secondLinkedMajor: '문화유산학전공', secondMajorType: 'DOUBLE' }, 'SECOND_MAJOR_BOTH_GIVEN'],
    [{ secondLinkedMajor: '없는 전공 이름', secondMajorType: 'DOUBLE' }, 'INVALID_SECOND_LINKED_MAJOR'],
  ];
  for (const [extra, code] of cases) {
    const { status, body } = await submit(extra);
    assert.equal(status, 400, code);
    assert.equal(body.code, code);
    assert.equal((await saved()).onboarding_completed_at, null, code);
  }
});
