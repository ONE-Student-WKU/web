const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const myCoursesRouter = require('../routes/myCourses');
const courseService = require('../services/courseService');
const { getGraduationStatus } = require('../services/graduationService');
const { countCourse } = require('../services/courseCounting');

/**
 * server/test/courseCategoryEdit.test.js
 * 과목 이수구분 직접 바꾸기(2026-11 문의: 학교가 일선 과목을 전공으로 바꿔 줄 예정인데 앱에서는 지우고 다시 넣는 방법뿐이었다).
 *  - 처음 바꿀 때 바꾸기 전 값을 category_original에 남기고, 원래대로 되돌릴 수 있다.
 *  - 학생 값이 자동 재분류(전과 전 과목 D-77, 다른 학과 전공 과목 D-88)보다 우선이다.
 *  - 성적표를 다시 가져오면: 학교 값이 학생 값과 같아지면 표시만 지우고, 옛 값 그대로면 두고, 제3의 값이면 원래 값만 고친다(학생 값 유지).
 */

const OWN = { ids: new Set([1]), names: new Set() };
const course = (over) => ({ name: '테스트타학과과목', category: '전공선택', year: 2024, semester: 1, offering_department_id: 958, offering_from_catalog: true, counted_major: null, ...over });

test('학생이 이수구분을 바꾼 과목은 다른 학과 전공 과목 자동 일반선택(D-88)을 건너뛴다', () => {
  assert.equal(countCourse(course(), { own: OWN }).counted, 'GENERAL', '바꾸지 않았으면 예전처럼 일반선택');
  assert.deepEqual(countCourse(course({ category_original: '일반선택' }), { own: OWN }), { counted: 'PRIMARY', category: '전공선택', reason: null, auto: true });
});

test('학생이 이수구분을 바꾼 과목은 전과 전 과목 재분류(D-77)도 건너뛴다', () => {
  const prior = { changeIndex: 2025 * 4, newIds: new Set([1]), newNames: new Set(), recognitionApplied: false };
  assert.equal(countCourse(course(), { own: OWN, prior }).reason, 'DEMOTED');
  assert.deepEqual(countCourse(course({ category_original: '일반선택' }), { own: OWN, prior }), { counted: 'PRIMARY', category: '전공선택', reason: null, auto: true });
});

// ---- DB(로컬 시드) ----
const D = {};
const offeringIds = [];
let studentId;
let server;
let baseUrl;

before(async () => {
  const [depts] = await pool.query("SELECT id, name FROM departments WHERE name IN ('컴퓨터·소프트웨어공학과', '국어국문학과')");
  for (const d of depts) D[d.name] = d.id;
  const [s] = await pool.query(
    "INSERT INTO students (email, name, department_id, admission_year, enrollment_type, onboarding_completed_at) VALUES (?, ?, ?, 2024, 'GENERAL', NOW())",
    [`catedit-${Date.now()}@example.test`, `catedit${Date.now()}`, D['컴퓨터·소프트웨어공학과']]
  );
  studentId = s.insertId;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { userId: studentId }; next(); });
  app.use('/api/my-courses', myCoursesRouter);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  if (offeringIds.length) await pool.query('DELETE FROM course_offerings WHERE id IN (?)', [offeringIds]);
  await pool.end();
});

const patch = (id, body) => fetch(`${baseUrl}/api/my-courses/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const list = async () => (await (await fetch(`${baseUrl}/api/my-courses`)).json()).data;
const row = async (id) => (await pool.query('SELECT category, category_original FROM student_courses WHERE id = ?', [id]))[0][0];
const earned = (s, category) => (s.categories.find((c) => c.category === category) || {}).earnedCredits;
async function addCourse(name, category) {
  const [r] = await pool.query('INSERT INTO student_courses (student_id, name, credits, category, year, semester) VALUES (?, ?, 3, ?, 2024, 1)', [studentId, name, category]);
  return r.insertId;
}

test('PATCH: 이수구분을 바꾸면 바꾸기 전 값을 남기고, 여러 번 바꿔도 처음 값을 지키며, 원래 값을 고르거나 되돌리면 표시가 지워진다', async () => {
  const id = await addCourse('테스트대지및생태경관공학', '일반선택');

  assert.equal((await patch(id, { category: '전공선택' })).status, 200);
  assert.deepEqual(await row(id), { category: '전공선택', category_original: '일반선택' });
  const item = (await list()).find((c) => c.id === id);
  assert.deepEqual([item.category, item.originalCategory], ['전공선택', '일반선택']);

  await patch(id, { category: '교양선택' });
  assert.deepEqual(await row(id), { category: '교양선택', category_original: '일반선택' }, '두 번째로 바꿔도 처음 값(학교 값)을 지킨다');

  await patch(id, { category: '일반선택' });
  assert.deepEqual(await row(id), { category: '일반선택', category_original: null }, '원래 값을 다시 고르면 바꾸지 않은 것과 같다');

  await patch(id, { category: '전공필수' });
  assert.equal((await patch(id, { revertCategory: true })).status, 200);
  assert.deepEqual(await row(id), { category: '일반선택', category_original: null }, '원래대로');
  assert.equal((await patch(id, { revertCategory: true })).status, 200, '바꾼 적 없는 과목을 되돌려도 그대로');
  assert.deepEqual(await row(id), { category: '일반선택', category_original: null });

  await patch(id, { category: '일반선택' });
  assert.deepEqual(await row(id), { category: '일반선택', category_original: null }, '같은 값을 고르면 아무것도 남기지 않는다');
});

test('PATCH: 이수구분 값이 틀리거나 바꾸기·되돌리기를 같이 보내면 400', async () => {
  const id = await addCourse('테스트잘못된구분', '일반선택');
  for (const body of [{ category: '전공' }, { category: '기초' }, { category: 3 }, { revertCategory: 'yes' }, { category: '전공선택', revertCategory: true }]) {
    const res = await patch(id, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await res.json()).code, 'INVALID_CATEGORY');
  }
  assert.deepEqual(await row(id), { category: '일반선택', category_original: null });
});

test('진단: 바꾼 구분대로 세고, 바꾼 과목을 editedCategoryCourses로 알린다(엔진 신뢰도는 그대로)', async () => {
  await pool.query('DELETE FROM student_courses WHERE student_id = ?', [studentId]);
  const id = await addCourse('테스트바꿀과목', '일반선택');
  await addCourse('테스트그대로과목', '전공선택');
  const before = await getGraduationStatus(studentId);
  assert.deepEqual(before.editedCategoryCourses, []);

  await patch(id, { category: '전공선택' });
  const after = await getGraduationStatus(studentId);
  assert.equal(earned(after, '전공선택'), earned(before, '전공선택') + 3);
  assert.deepEqual(after.editedCategoryCourses, [{ id, name: '테스트바꿀과목', credits: 3, from: '일반선택', to: '전공선택' }]);
  assert.equal(after.regulation.confidence, before.regulation.confidence, '엔진 신뢰도는 바꾸지 않는다 — 화면·인쇄본이 "미정"으로 보여 준다');
});

test('진단: 다른 학과 개설 전공 과목도 학생이 이수구분을 바꿨으면 자동 일반선택으로 돌리지 않는다(학생 값 우선)', async () => {
  await pool.query('DELETE FROM student_courses WHERE student_id = ?', [studentId]);
  const [o] = await pool.query(
    "INSERT INTO course_offerings (department_id, year, semester, raw_category, category, course_name, credits) VALUES (?, 2099, 1, '선택', '전공선택', '테스트국문캡스톤', 3)",
    [D['국어국문학과']]
  );
  offeringIds.push(o.insertId);
  const [r] = await pool.query("INSERT INTO student_courses (student_id, course_id, name, credits, category, year, semester) VALUES (?, ?, '테스트국문캡스톤', 3, '전공선택', 2024, 1)", [studentId, o.insertId]);

  assert.ok((await getGraduationStatus(studentId)).otherDepartmentCourses, '바꾸기 전에는 다른 학과 과목으로 일반선택');
  await patch(r.insertId, { category: '전공필수' });
  const s = await getGraduationStatus(studentId);
  assert.equal(s.otherDepartmentCourses, null);
  assert.equal(earned(s, '전공필수'), 3);
});

test('성적표 다시 가져오기: 학교 값이 학생 값과 같아지면 표시만 지우고, 옛 값이면 그대로, 제3의 값이면 원래 값만 고친다', async () => {
  await pool.query('DELETE FROM student_courses WHERE student_id = ?', [studentId]);
  const id = await addCourse('테스트성적표과목', '일반선택');
  await patch(id, { category: '전공선택' });
  const reimport = (category) => courseService.bulkAddMyCourses(studentId, [{ name: '테스트성적표과목', credits: 3, category, year: 2024, semester: 1 }]);

  await reimport('일반선택');
  assert.deepEqual(await row(id), { category: '전공선택', category_original: '일반선택' }, '학교가 아직 안 바꿨으면 학생 값 그대로');

  await reimport('교양선택');
  assert.deepEqual(await row(id), { category: '전공선택', category_original: '교양선택' }, '제3의 값이면 학생 값은 두고 원래 값만 최신 학교 값으로');

  await reimport('전공선택');
  assert.deepEqual(await row(id), { category: '전공선택', category_original: null }, '학교가 학생이 바꾼 대로 바꿨으면 표시를 지운다');

  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM student_courses WHERE student_id = ?', [studentId]);
  assert.equal(n, 1, '다시 가져와도 과목이 늘지 않는다');
});
