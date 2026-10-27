const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const myCoursesRouter = require('../routes/myCourses');
const { getGraduationStatus } = require('../services/graduationService');
const { countCourse, isOtherDepartmentMajorCourse, pairedMedicalDepartment } = require('../services/courseCounting');

/**
 * server/test/otherDepartmentCourses.test.js
 * 다른 학과에서 연 전공 과목은 일반선택(시행규칙 제3조 제4항 제1호, #253 설계안 2, DECISIONS D-88).
 * 개설과목에서 고르면 개설 학과의 구분이 저장되므로, 진단할 때마다 지금 소속과 대조한다 — 프로필에서 학과를 고치면 결과가 바로 바뀐다.
 */

const OWN = { ids: new Set([1]), names: new Set(['자료구조']) };
const course = (over) => ({ name: '현대소설론', category: '전공선택', year: 2024, semester: 1, offering_department_id: 958, counted_major: null, ...over });

test('다른 학과 전공 과목: 개설 학과가 내 학과가 아니고 내 편성표에도 없는 전공 과목만 일반선택', () => {
  assert.deepEqual(countCourse(course(), { own: OWN }), { counted: 'GENERAL', category: '일반선택', reason: 'OTHER_DEPARTMENT', auto: true });
  assert.equal(isOtherDepartmentMajorCourse(course({ offering_department_id: 1 }), OWN), false, '내 학과(통폐합 전후 포함) 개설');
  assert.equal(isOtherDepartmentMajorCourse(course({ name: '자료 구조' }), OWN), false, '내 편성표에 있는 공통 과목');
  assert.equal(isOtherDepartmentMajorCourse(course({ offering_department_id: null }), OWN), false, '성적표·직접 입력 과목은 개설 학과를 몰라 그대로');
  assert.equal(isOtherDepartmentMajorCourse(course({ category: '교양선택' }), OWN), false, '교양은 소속과 무관');
  assert.equal(isOtherDepartmentMajorCourse(course({ category: '일반선택' }), OWN), false);
  assert.equal(isOtherDepartmentMajorCourse(course(), null), false, '학과가 없으면(온보딩 전) 판정하지 않는다');
});

test('다른 학과 전공 과목: 학생이 고친 값·전과 전 과목·제2전공이 먼저다', () => {
  assert.deepEqual(countCourse(course({ counted_major: 'PRIMARY' }), { own: OWN }), { counted: 'PRIMARY', category: '전공선택', reason: null, auto: false });
  const second = { primaryIds: new Set([1]), secondIds: new Set([958]), primaryNames: new Set(), secondNames: new Set() };
  assert.equal(countCourse(course(), { own: OWN, second }).counted, 'SECOND', '제2전공 학과 과목은 제2전공');
  const prior = { changeIndex: 2025 * 4, newIds: new Set([1]), newNames: new Set(), recognitionApplied: false };
  assert.equal(countCourse(course(), { own: OWN, prior }).reason, 'DEMOTED', '전과 전 과목은 전과 안내로 센다');
  assert.equal(countCourse(course({ year: 2025, semester: 3 }), { own: OWN, prior }).reason, 'OTHER_DEPARTMENT', '전과 뒤 다른 학과 과목');
});

test('예과와 본과는 한 과정이라 서로 다른 학과로 보지 않는다', () => {
  assert.equal(pairedMedicalDepartment('의예과'), '의학과');
  assert.equal(pairedMedicalDepartment('한의학과'), '한의예과');
  assert.equal(pairedMedicalDepartment('컴퓨터·소프트웨어공학과'), null);
});

// ---- DB(로컬 시드) ----
const D = {};
const offeringIds = [];
let studentId;
let server;
let baseUrl;

before(async () => {
  const [depts] = await pool.query("SELECT id, name FROM departments WHERE name IN ('컴퓨터·소프트웨어공학과', '국어국문학과', '의예과', '의학과')");
  for (const d of depts) D[d.name] = d.id;
  const [s] = await pool.query(
    "INSERT INTO students (email, name, department_id, admission_year, enrollment_type, onboarding_completed_at) VALUES (?, ?, ?, 2024, 'GENERAL', NOW())",
    [`otherdept-${Date.now()}@example.test`, `otherdept${Date.now()}`, D['컴퓨터·소프트웨어공학과']]
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

// 개설과목에서 고른 과목(course_id 있음) — 저장되는 구분은 개설 학과 기준이다.
async function addCatalogCourse(departmentId, name, category = '전공선택') {
  const [o] = await pool.query(
    "INSERT INTO course_offerings (department_id, year, semester, raw_category, category, course_name, credits) VALUES (?, 2099, 1, '선택', ?, ?, 3)",
    [departmentId, category, name]
  );
  offeringIds.push(o.insertId);
  const [r] = await pool.query('INSERT INTO student_courses (student_id, course_id, name, credits, category, year, semester) VALUES (?, ?, ?, 3, ?, 2024, 1)', [studentId, o.insertId, name, category]);
  return r.insertId;
}
const majorCredits = (s) => Object.fromEntries(s.categories.filter((c) => ['전공선택', '일반선택'].includes(c.category)).map((c) => [c.category, c.earnedCredits]));

test('진단: 다른 학과 개설 전공 과목은 일반선택으로 세고, 학과를 고치면 바로 그 학과 기준으로 바뀐다', async () => {
  const ownId = await addCatalogCourse(D['컴퓨터·소프트웨어공학과'], '테스트컴소공전공과목');
  const otherId = await addCatalogCourse(D['국어국문학과'], '테스트국문전공과목');
  // 직접 입력한 같은 이름 과목은 개설 학과를 몰라 그대로 둔다.
  await pool.query("INSERT INTO student_courses (student_id, name, credits, category, year, semester) VALUES (?, '테스트직접입력전공', 3, '전공선택', 2024, 1)", [studentId]);

  let s = await getGraduationStatus(studentId);
  assert.deepEqual(majorCredits(s), { 전공선택: 6, 일반선택: 3 });
  assert.deepEqual(s.otherDepartmentCourses, { courses: [{ id: otherId, name: '테스트국문전공과목', credits: 3 }], credits: 3 });
  assert.ok(s.regulation.flags.some((f) => f.code === 'OTHER_DEPARTMENT_MAJOR_COURSES'));

  // 프로필에서 학과를 국어국문학과로 바로잡은 경우 — 저장된 값은 그대로인데 진단이 바뀐다.
  await pool.query('UPDATE students SET department_id = ? WHERE id = ?', [D['국어국문학과'], studentId]);
  s = await getGraduationStatus(studentId);
  assert.deepEqual(s.otherDepartmentCourses.courses.map((c) => c.id), [ownId]);
  await pool.query('UPDATE students SET department_id = ? WHERE id = ?', [D['컴퓨터·소프트웨어공학과'], studentId]);
});

test('과목 목록: 다른 학과 과목은 자동으로 일반선택, "전공으로 셈"으로 고치면 진단에서도 전공이고 자동 값을 함께 준다', async () => {
  const list = async () => (await (await fetch(`${baseUrl}/api/my-courses`)).json()).data;
  let other = (await list()).find((c) => c.name === '테스트국문전공과목');
  assert.equal(other.countedMajor, 'GENERAL');
  assert.equal(other.countedMajorAuto, true);

  const res = await fetch(`${baseUrl}/api/my-courses/${other.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ countedMajor: 'PRIMARY' }) });
  assert.equal(res.status, 200);
  other = (await list()).find((c) => c.name === '테스트국문전공과목');
  assert.deepEqual([other.countedMajor, other.countedMajorAuto, other.countedMajorAutoValue], ['PRIMARY', false, 'GENERAL']);
  const s = await getGraduationStatus(studentId);
  assert.equal(s.otherDepartmentCourses, null);
  assert.deepEqual(majorCredits(s), { 전공선택: 9, 일반선택: 0 });
});

test('진단: 본과 학생의 예과 개설 과목은 전공으로 둔다', async () => {
  await pool.query('DELETE FROM student_courses WHERE student_id = ?', [studentId]);
  await pool.query('UPDATE students SET department_id = ? WHERE id = ?', [D['의학과'], studentId]);
  await addCatalogCourse(D['의예과'], '테스트예과전공과목');
  const s = await getGraduationStatus(studentId);
  assert.equal(s.otherDepartmentCourses, null);
});
