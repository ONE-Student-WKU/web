const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const meRouter = require('../routes/me');
const { secondMajorTypeOf, validateSecondMajor, hasSecondMajor } = require('../services/secondMajor');
const { evaluateMicroDegrees, validateMicroDegreeList, listLinkedMajors, MICRO_DEGREE_CREDITS } = require('../services/linkedMajors');
const { linkedMajorStatus, getGraduationStatus } = require('../services/graduationService');

/**
 * server/test/linkedMajor.test.js
 * 연계·복합전공(제2전공 선택지)과 사업단 마이크로디그리(#412 1·2단계): 입력 검증·저장(PATCH /api/me), 연계전공 학점 계산, 마이크로디그리 학점.
 * DB에 임시 학생 1명을 만들고 끝나면 지운다. 연계전공·마이크로디그리는 시드(seed:linked-majors)가 있어야 한다.
 */

let server;
let baseUrl;
let studentId;
let primary;
let linkedName;
let microName;

before(async () => {
  [[primary]] = await pool.query("SELECT id FROM departments WHERE name = '컴퓨터·소프트웨어공학과'");
  [[{ name: linkedName }]] = await pool.query("SELECT name FROM linked_majors WHERE name LIKE '%문화유산학%' LIMIT 1");
  [[{ name: microName }]] = await pool.query('SELECT name FROM micro_degrees ORDER BY id LIMIT 1');
  const [result] = await pool.query(
    "INSERT INTO students (email, name, department_id, admission_year, enrollment_type, onboarding_completed_at) VALUES (?, ?, ?, 2022, 'GENERAL', NOW())",
    [`linked-major-${Date.now()}@example.test`, `lm${Date.now()}`, primary.id]
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
const stored = async () =>
  (await pool.query('SELECT second_department_id AS d, second_linked_major AS l, second_major_type AS t FROM students WHERE id = ?', [studentId]))[0][0];

test('구분·검증: 연계전공만 있어도 제2전공이 있고, 학과와 연계전공을 한 요청에 둘 다 보내면 거절한다', () => {
  assert.equal(hasSecondMajor({ second_department_id: null, second_linked_major: '문화유산학전공' }), true);
  assert.equal(secondMajorTypeOf({ second_department_id: null, second_linked_major: '문화유산학전공', second_major_type: 'MINOR' }), 'MINOR');
  assert.equal(validateSecondMajor({ secondDepartmentId: 3, secondLinkedMajor: 'x' }, { departmentId: 1, secondDepartmentId: 3, secondLinkedMajor: 'x' }), 'SECOND_MAJOR_BOTH_GIVEN');
  assert.equal(validateSecondMajor({ secondLinkedMajor: 5 }, { departmentId: 1, secondLinkedMajor: 5 }), 'INVALID_SECOND_LINKED_MAJOR');
  assert.equal(validateSecondMajor({ secondMajorType: 'MINOR', secondLinkedMajor: 'x' }, { departmentId: 1, secondDepartmentId: null, secondLinkedMajor: 'x' }), null);
  assert.equal(validateMicroDegreeList(['a', 'b']), null);
  assert.equal(validateMicroDegreeList('a'), 'INVALID_MICRO_DEGREES');
  assert.equal(validateMicroDegreeList(['a', '']), 'INVALID_MICRO_DEGREES');
});

test('목록: 연계전공 목록에서 자율융합학부(학부라 연계전공이 아님)를 뺀다', async () => {
  const list = await listLinkedMajors();
  assert.ok(list.length > 0);
  assert.ok(!list.some((m) => m.name === '자율융합학부'));
  assert.ok(list.some((m) => m.name === linkedName));
});

test('저장: 연계전공을 고르면 학과 칸을 비우고, 학과를 고르면 연계전공 칸을 비운다. 없는 연계전공은 거절한다', async () => {
  const [[other]] = await pool.query("SELECT id FROM departments WHERE name = '경영학과'");
  assert.equal((await patch({ secondDepartmentId: other.id, secondMajorType: 'DOUBLE' })).status, 200);
  const linked = await patch({ secondLinkedMajor: linkedName, secondMajorType: 'MINOR' });
  assert.equal(linked.status, 200);
  assert.deepEqual(await stored(), { d: null, l: linkedName, t: 'MINOR' });
  assert.equal(linked.body.data.secondLinkedMajor, linkedName);
  assert.equal(linked.body.data.secondMajorType, 'MINOR');

  assert.equal((await patch({ secondDepartmentId: other.id })).status, 200);
  assert.deepEqual(await stored(), { d: other.id, l: null, t: 'MINOR' });

  assert.equal((await patch({ secondLinkedMajor: '없는연계전공' })).body.code, 'INVALID_SECOND_LINKED_MAJOR');
  assert.equal((await patch({ secondLinkedMajor: '자율융합학부' })).body.code, 'INVALID_SECOND_LINKED_MAJOR');

  // 둘 다 지우면 구분도 지운다.
  assert.equal((await patch({ secondDepartmentId: null, secondLinkedMajor: null })).status, 200);
  assert.deepEqual(await stored(), { d: null, l: null, t: null });
});

test('저장: 마이크로디그리는 이름 목록 전체를 바꾸고, 없는 과정은 거절한다', async () => {
  const saved = await patch({ microDegrees: [microName] });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.data.microDegrees, [microName]);
  assert.equal((await patch({ microDegrees: ['없는과정'] })).body.code, 'INVALID_MICRO_DEGREES');
  assert.deepEqual((await patch({ microDegrees: [] })).body.data.microDegrees, []);
});

test('연계전공 학점: 전공 과목 + 교양 9학점까지 + 주전공과 같은 이름의 과목은 이수학점의 1/3까지', () => {
  const linked = { name: '연계', requiredCredits: 36, majorNames: new Set(['문화유산의이해', '공통과목']) };
  const courseMajors = new Map([[1, { auto: true }], [2, { auto: false }], [3, { auto: false }]]);
  const secondCourses = [
    { id: 1, name: '문화유산의이해', category: '일반선택', credits: 3 },
    { id: 2, name: '교양A', category: '교양선택', credits: 6 },
    { id: 3, name: '교양B', category: '교양선택', credits: 6 },
  ];
  const primaryCourses = [
    { id: 10, name: '공통과목', category: '전공선택', credits: 9 },
    { id: 11, name: '공통과목', category: '전공필수', credits: 9 },
    { id: 12, name: '다른과목', category: '전공선택', credits: 3 },
  ];
  const s = linkedMajorStatus({ type: 'DOUBLE', linked, secondCourses, primaryCourses, courseMajors });
  assert.equal(s.required, 36);
  assert.equal(s.liberalCredits, 9); // 12 → 9
  assert.equal(s.overlapCredits, 12); // 18 → 36/3 = 12
  assert.equal(s.earned, 3 + 9 + 12);
  assert.equal(s.satisfied, false);
  assert.equal(s.kind, 'LINKED');
  assert.equal(s.department, '연계');
  assert.ok(s.courses.some((c) => c.shared && c.name === '공통과목'));

  const minor = linkedMajorStatus({ type: 'MINOR', linked, secondCourses: [], primaryCourses: [], courseMajors });
  assert.equal(minor.required, 21);
  assert.equal(minor.basis, 'LINKED_MINOR_21');
});

test('마이크로디그리 학점: 과정 과목명으로 맞추고 12학점이면 충족, 목록에서 사라진 과정은 표시만 한다', () => {
  const programs = [
    { name: 'MD1', programGroup: 'JST공유대학', courseNames: new Set(['이차전지개론', '배터리설계']) },
    { name: 'MD2', programGroup: null, courseNames: new Set(), missing: true },
  ];
  const courses = [
    { name: '이차전지개론', credits: 3 },
    { name: '배터리 설계', credits: 9 },
    { name: '무관한과목', credits: 3 },
  ];
  const [md1, md2] = evaluateMicroDegrees(programs, courses);
  assert.equal(md1.required, MICRO_DEGREE_CREDITS);
  assert.equal(md1.earned, 12);
  assert.equal(md1.satisfied, true);
  assert.deepEqual(md1.courses.map((c) => c.name), ['이차전지개론', '배터리 설계']);
  assert.equal(md2.missing, true);
  assert.equal(md2.earned, 0);
});

test('진단: 연계전공 부전공 학생은 다전공 카드가 연계전공으로 나오고, 고른 마이크로디그리가 함께 실린다', async () => {
  await pool.query('UPDATE students SET second_department_id = NULL, second_linked_major = ?, second_major_type = ? WHERE id = ?', [linkedName, 'MINOR', studentId]);
  await pool.query('DELETE FROM student_micro_degrees WHERE student_id = ?', [studentId]);
  await pool.query('INSERT INTO student_micro_degrees (student_id, micro_degree_name) VALUES (?, ?)', [studentId, microName]);
  const status = await getGraduationStatus(studentId);
  assert.equal(status.secondMajor.kind, 'LINKED');
  assert.equal(status.secondMajor.linkedMajor, linkedName);
  assert.equal(status.secondMajor.required, 21);
  assert.ok(status.regulation.flags.some((f) => f.code === 'LINKED_MAJOR_RULES_ESTIMATED'));
  assert.deepEqual(status.microDegrees.map((m) => m.name), [microName]);
  assert.equal(status.microDegrees[0].required, MICRO_DEGREE_CREDITS);
});
