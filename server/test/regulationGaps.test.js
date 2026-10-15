const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const meRouter = require('../routes/me');
const { getGraduationStatus, evaluateCertifications } = require('../services/graduationService');
const { classifyPriorMajorCourse, changeTermIndex } = require('../services/priorMajorCourses');
const { countCourse } = require('../services/courseCounting');

/**
 * server/test/regulationGaps.test.js
 * 2026-10-16 학칙·시행규칙과 진단을 대조해 찾은 어긋남(DECISIONS D-77):
 *  - 전과생의 전과 전 전공 과목은 일반선택, 전과한 학과의 같은 과목은 인정 신청을 했을 때만 전공선택(시행규칙 제3조 제4항·제115조)
 *  - 교직이수자는 졸업인증제 기본영역을 교직(교육봉사활동·교육실습)으로 대체(2026 책자 졸업인증제 공통)
 */

const CTX = { changeIndex: changeTermIndex(2024, 1), newIds: new Set([1]), newNames: new Set(['C언어프로그래밍']), recognitionApplied: false };
const course = (over) => ({ name: '마케팅원론', category: '전공선택', year: 2023, semester: 1, offering_department_id: null, ...over });

test('전과 전 과목: 전과 학기 전의 전공 과목만 일반선택, 교양·전과 뒤·새 학과 개설 과목은 그대로', () => {
  assert.deepEqual(classifyPriorMajorCourse(course(), CTX), { category: '일반선택', reason: 'DEMOTED' });
  assert.equal(classifyPriorMajorCourse(course({ category: '교양선택' }), CTX).reason, null);
  assert.equal(classifyPriorMajorCourse(course({ year: 2024, semester: 1 }), CTX).reason, null, '전과한 학기부터는 새 학과 과목');
  assert.equal(classifyPriorMajorCourse(course({ year: 2023, semester: 4 }), CTX).reason, 'DEMOTED', '전과 전 겨울학기');
  assert.equal(classifyPriorMajorCourse(course({ offering_department_id: 1 }), CTX).reason, null, '새 학과가 개설한 과목은 그대로 인정');
  const summer = { ...CTX, changeIndex: changeTermIndex(2024, 2) };
  assert.equal(classifyPriorMajorCourse(course({ year: 2024, semester: 2 }), summer).reason, 'DEMOTED', '2학기에 전과하면 그 해 여름학기는 전과 전');
});

test('전과 전 과목: 새 학과와 같은 과목은 인정 신청을 했을 때만 전공선택(제115조 제4항)', () => {
  const same = course({ name: 'C언어 프로그래밍', category: '전공필수' });
  assert.deepEqual(classifyPriorMajorCourse(same, CTX), { category: '일반선택', reason: 'DEMOTED' });
  assert.deepEqual(classifyPriorMajorCourse(same, { ...CTX, recognitionApplied: true }), { category: '전공선택', reason: 'RECOGNIZED' });
});

test('과목 세기: 학생이 고친 값이 우선하고, 전과 전 과목이 제2전공 학과 과목이면 제2전공으로 센다', () => {
  const prior = CTX;
  assert.deepEqual(countCourse(course({ counted_major: 'PRIMARY' }), { prior }), { counted: 'PRIMARY', category: '전공선택', reason: null, auto: false });
  assert.equal(countCourse(course({ category: '교양선택', counted_major: 'GENERAL' }), { prior }).category, '일반선택');
  const second = { primaryIds: new Set([1]), secondIds: new Set([28]), primaryNames: new Set(), secondNames: new Set(['마케팅원론']) };
  assert.deepEqual(countCourse(course(), { prior, second }), { counted: 'SECOND', category: '일반선택', reason: 'DEMOTED', auto: true });
});

test('교직이수자는 졸업인증제 기본영역을 교육봉사활동·교육실습으로 대체한다. 포기로 바꾸면 원래대로, 다른 실습 과목은 아니다', () => {
  const rows = [
    { category: '졸업인증제', description: '기본영역', min_course_count: 1, requiredCourses: ['전공현장실습', '캡스톤디자인', '사회봉사'] },
    { category: '졸업인증제', description: '학과', min_course_count: 2, requiredCourses: ['기업연계프로젝트1', '기업연계프로젝트2'] },
  ];
  const passed = (...names) => names.map((name) => ({ name, letter_grade: 'A0' }));
  const teaching = evaluateCertifications(rows, passed('교육봉사활동', '교육실습및교육윤리(중등)'), { teachingCourse: true });
  assert.deepEqual(teaching.map((r) => [r.requiredCourses.join(','), r.satisfied]), [['교육봉사활동,교육실습', true], ['기업연계프로젝트1,기업연계프로젝트2', false]]);
  assert.equal(evaluateCertifications(rows, passed('교육봉사활동', '평생교육실습'), { teachingCourse: true })[0].satisfied, false);
  assert.equal(evaluateCertifications(rows, passed('캡스톤디자인1'), { teachingCourse: true })[0].satisfied, false, '교직이수자는 캡스톤으로 채우지 않는다');
  assert.equal(evaluateCertifications(rows, passed('캡스톤디자인1'), { teachingCourse: false })[0].satisfied, true, '교직을 포기하면 원래 기본영역');
  assert.equal(evaluateCertifications(rows, passed('캡스톤디자인1'), { teachingCourse: null })[0].satisfied, true, '답하지 않았으면 원래 기본영역');
});

// ---- DB(로컬 시드) ----
let studentId;
let server;
let baseUrl;
const D = {};

before(async () => {
  const [depts] = await pool.query('SELECT id, name FROM departments');
  for (const d of depts) D[d.name] = d.id;
  const [r] = await pool.query(
    "INSERT INTO students (email, name, department_id, admission_year, enrollment_type, major_change_grade, major_change_year, major_change_semester, onboarding_completed_at) VALUES (?, ?, ?, 2022, 'MAJOR_CHANGE', 2, 2023, 2, NOW())",
    [`gap-${Date.now()}@example.test`, `gap${Date.now()}`, D['컴퓨터·소프트웨어공학과']]
  );
  studentId = r.insertId;
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

const addCourse = (name, credits, category, year, semester) =>
  pool.query('INSERT INTO student_courses (student_id, name, credits, category, year, semester) VALUES (?, ?, ?, ?, ?, ?)', [studentId, name, credits, category, year, semester]);
const majorCredits = (s) => Object.fromEntries(s.categories.filter((c) => ['전공필수', '전공선택', '일반선택'].includes(c.category)).map((c) => [c.category, c.earnedCredits]));

test('진단: 전과 전 과목은 일반선택, 같은 과목은 인정 신청 시 전공선택 — 제13조④ 보정이 되돌리지 않는다', async () => {
  await addCourse('마케팅원론', 3, '전공선택', 2022, 1);
  await addCourse('C언어프로그래밍', 3, '전공필수', 2022, 3);
  await addCourse('운영체제', 3, '전공선택', 2024, 1);
  let s = await getGraduationStatus(studentId);
  assert.deepEqual(majorCredits(s), { 전공필수: 0, 전공선택: 3, 일반선택: 6 });
  assert.deepEqual(s.priorMajorCourses.demoted.map((c) => c.name).sort(), ['C언어프로그래밍', '마케팅원론']);
  assert.ok(s.regulation.flags.some((f) => f.code === 'MAJOR_CHANGE_PRIOR_COURSES'));

  await pool.query('UPDATE students SET major_change_recognition = 1 WHERE id = ?', [studentId]);
  s = await getGraduationStatus(studentId);
  assert.deepEqual(majorCredits(s), { 전공필수: 0, 전공선택: 6, 일반선택: 3 });
  assert.deepEqual(s.priorMajorCourses.recognized.map((c) => c.name), ['C언어프로그래밍']);
});

test('진단: 전과 학기를 모르는 옛 전과 계정은 가려내지 않고 "추정"으로 알린다', async () => {
  await pool.query('UPDATE students SET major_change_year = NULL, major_change_semester = NULL WHERE id = ?', [studentId]);
  const s = await getGraduationStatus(studentId);
  assert.equal(s.priorMajorCourses, null);
  assert.ok(s.regulation.flags.some((f) => f.code === 'MAJOR_CHANGE_TERM_UNKNOWN_FOR_COURSES'));
  await pool.query('UPDATE students SET major_change_year = 2023, major_change_semester = 2 WHERE id = ?', [studentId]);
});

test('프로필: 전공학점 인정 신청 여부는 전과생만 받고, 일반 재학생으로 바꾸면 지운다', async () => {
  const patch = async (body) => (await fetch(`${baseUrl}/api/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  assert.equal((await patch({ majorChangeRecognition: 'yes' })).code, 'INVALID_MAJOR_CHANGE_RECOGNITION');
  assert.equal((await patch({ majorChangeRecognition: false })).data.majorChangeRecognition, false);
  const general = await patch({ enrollmentType: 'GENERAL', majorChangeGrade: null, majorChangeYear: null, majorChangeSemester: null });
  assert.equal(general.data.majorChangeRecognition, null);
  assert.equal((await patch({ majorChangeRecognition: true })).code, 'INVALID_MAJOR_CHANGE_RECOGNITION');
});
