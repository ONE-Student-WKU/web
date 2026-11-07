const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const careerRouter = require('../routes/career');

/**
 * server/test/career.history.test.js
 * GET /api/career/history: 진로를 확정한 지난 진단을 최근 5개까지 최신순으로 돌려준다(DECISIONS D-93).
 * 남의 진단과 확정하지 않은 진단은 보이지 않아야 한다. 임시 학생을 만들고 끝나면 지운다(세션·로드맵은 FK CASCADE).
 */

let server;
let baseUrl;
let studentId;
let otherId;

const addSession = async (owner, status, career) => {
  const [r] = await pool.query('INSERT INTO career_sessions (student_id, status, confirmed_career) VALUES (?, ?, ?)', [owner, status, career]);
  return r.insertId;
};

before(async () => {
  const stamp = Date.now();
  const [a] = await pool.query('INSERT INTO students (email, name) VALUES (?, ?)', [`career-history-a-${stamp}@example.test`, `cha${stamp}`]);
  const [b] = await pool.query('INSERT INTO students (email, name) VALUES (?, ?)', [`career-history-b-${stamp}@example.test`, `chb${stamp}`]);
  studentId = a.insertId;
  otherId = b.insertId;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: studentId };
    next();
  });
  app.use('/api/career', careerRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.query('DELETE FROM students WHERE id IN (?, ?)', [studentId, otherId]);
  await pool.end();
});

const history = async () => {
  const res = await fetch(`${baseUrl}/api/career/history`);
  assert.equal(res.status, 200);
  return (await res.json()).data;
};

test('진단이 없으면 빈 목록이다', async () => {
  assert.deepEqual(await history(), []);
});

test('확정한 진단만 최신순으로 5개까지, 로드맵과 함께 돌려준다', async () => {
  for (let i = 1; i <= 6; i += 1) await addSession(studentId, 'CONFIRMED', `진로${i}`);
  const newest = await addSession(studentId, 'CONFIRMED', '진로7');
  await pool.query('INSERT INTO career_roadmap_items (session_id, grade, semester, course_name, reason, sort_order) VALUES (?, 3, 1, ?, ?, 0)', [newest, '데이터베이스', '이유']);
  await addSession(studentId, 'IN_PROGRESS', null);
  await addSession(studentId, 'CANDIDATES_READY', null);
  await addSession(otherId, 'CONFIRMED', '남의 진로');

  const rows = await history();
  assert.deepEqual(rows.map((r) => r.confirmedCareer), ['진로7', '진로6', '진로5', '진로4', '진로3']);
  assert.ok(rows[0].confirmedAt);
  assert.equal(rows[0].roadmap.length, 1);
  assert.equal(rows[0].roadmap[0].courseName, '데이터베이스');
  assert.deepEqual(rows[1].roadmap, []);
});
