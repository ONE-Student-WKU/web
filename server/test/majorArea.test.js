const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const myCoursesRouter = require('../routes/myCourses');
const { majorAreaOf } = require('../services/categoryMap');

/**
 * server/test/majorArea.test.js
 * 광역 계열전공 과목의 원래 이수구분(기초·심화·응용)을 student_courses.major_area에 남기는지(#378 결정 3-3 A).
 * 예전에는 category가 5종으로 합쳐져(기초·심화·응용 → 전공선택) 시행규칙 제7조 제3항의 이수구분별 학점을 판정할 수 없었다.
 * 임시 학생·개설과목(2099학년도)을 만들고 끝나면 지운다.
 */

let server;
let baseUrl;
let studentId;
let offeringId;

before(async () => {
  const [s] = await pool.query('INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())', [`area-${Date.now()}@example.test`, `area${Date.now()}`]);
  studentId = s.insertId;
  const [[dept]] = await pool.query('SELECT id FROM departments ORDER BY id LIMIT 1');
  const [o] = await pool.query(
    "INSERT INTO course_offerings (department_id, year, semester, raw_category, category, course_name, credits) VALUES (?, 2099, 1, '심화', '전공선택', '테스트심화과목', 3)",
    [dept.id]
  );
  offeringId = o.insertId;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { userId: studentId }; next(); });
  app.use('/api/my-courses', myCoursesRouter);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.query('DELETE FROM course_offerings WHERE id = ?', [offeringId]);
  await pool.end();
});

const post = async (path, body) => {
  const res = await fetch(baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const areaOf = async (name) => (await pool.query('SELECT major_area FROM student_courses WHERE student_id = ? AND name = ?', [studentId, name]))[0][0].major_area;

test('원문 구분 코드와 편성표 구분을 이수구분으로 바꾼다 — 의약계열 "전기"는 광역 계열전공의 기초가 아니다', () => {
  assert.deepEqual(['기초', '심화', '응용', '전공기초', '전공응용', '전기', '선전', '', null].map(majorAreaOf), ['기초', '심화', '응용', '기초', '응용', null, null, null, null]);
});

test('성적표 가져오기: 전공 과목의 이수구분을 저장하고, 전공이 아닌 과목에는 남기지 않는다', async () => {
  const rows = [
    { name: '테스트기초과목', credits: 3, category: '전공선택', majorArea: '기초', year: 2025, semester: 1 },
    { name: '테스트교양과목', credits: 2, category: '교양선택', majorArea: '응용', year: 2025, semester: 1 },
    { name: '테스트구분없음', credits: 3, category: '전공선택', year: 2025, semester: 1 },
  ];
  assert.equal((await post('/api/my-courses/import/confirm', { rows })).status, 201);
  assert.equal(await areaOf('테스트기초과목'), '기초');
  assert.equal(await areaOf('테스트교양과목'), null);
  assert.equal(await areaOf('테스트구분없음'), null);
});

test('성적표 가져오기: 모르는 이수구분 값은 거절한다', async () => {
  const res = await post('/api/my-courses/import/confirm', { rows: [{ name: 'x', credits: 3, category: '전공선택', majorArea: '고급', year: 2025, semester: 1 }] });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_MAJOR_AREA');
});

test('카탈로그에서 추가: 개설과목의 원문 구분(심화)을 남긴다', async () => {
  const res = await post('/api/my-courses', { courseId: offeringId, year: 2099, semester: 1 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(await areaOf('테스트심화과목'), '심화');
});
