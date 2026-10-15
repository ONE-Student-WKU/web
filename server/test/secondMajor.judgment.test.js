const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const myCoursesRouter = require('../routes/myCourses');
const { getGraduationStatus } = require('../services/graduationService');
const { resolveRequirementsForStudent } = require('../services/regulationEngine');
const { assignCourseMajor, secondMajorRequirement, hasSecondThesis, isRestrictedCombination } = require('../services/secondMajorCredits');

/**
 * server/test/secondMajor.judgment.test.js
 * 다전공 판정(#378 G-2, 결정 4-3·4-4):
 *  - 복수전공이면 주전공도 최소전공 인정학점(시행규칙 제8조 제1항), 줄어든 학점은 일반선택으로 옮겨 졸업학점은 그대로
 *  - 과목은 개설 학과·편성표로 주전공/제2전공을 자동으로 정하고, 학생이 고친 값(counted_major)이 우선
 *  - 제2전공 학점(복수전공 = 제2전공 학과 최소전공, 부전공 = 21)과 복수전공 졸업논문2
 * DB에 임시 학생 1명을 만들고 끝나면 지운다.
 */

let studentId;
let server;
let baseUrl;
const D = {};

before(async () => {
  const [depts] = await pool.query('SELECT id, name FROM departments');
  for (const d of depts) D[d.name] = d.id;
  const [r] = await pool.query(
    "INSERT INTO students (email, name, department_id, admission_year, enrollment_type, onboarding_completed_at) VALUES (?, ?, ?, 2022, 'GENERAL', NOW())",
    [`second-judge-${Date.now()}@example.test`, `sj${Date.now()}`, D['컴퓨터·소프트웨어공학과']]
  );
  studentId = r.insertId;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { userId: studentId }; next(); });
  app.use('/api/my-courses', myCoursesRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

async function setSecond(type, department = '경영학과') {
  await pool.query('UPDATE students SET second_department_id = ?, second_major_type = ? WHERE id = ?', [type ? D[department] : null, type, studentId]);
  await pool.query('DELETE FROM student_courses WHERE student_id = ?', [studentId]);
}
const addCourse = async (name, credits, category, extra = {}) => {
  const [r] = await pool.query(
    'INSERT INTO student_courses (student_id, name, credits, category, year, semester, letter_grade, counted_major) VALUES (?, ?, ?, ?, 2024, 1, ?, ?)',
    [studentId, name, credits, category, extra.grade ?? null, extra.countedMajor ?? null]
  );
  return r.insertId;
};

const CTX = { primaryIds: new Set([1]), secondIds: new Set([28]), primaryNames: new Set(['자료구조', '공통과목']), secondNames: new Set(['마케팅원론', '공통과목']) };

test('과목 배정: 학생이 고친 값 → 교양은 주전공 → 개설 학과 → 제2전공 편성표에만 있는 이름 → 그 밖은 주전공', () => {
  assert.deepEqual(assignCourseMajor({ category: '전공선택', name: '자료구조', counted_major: 'SECOND' }, CTX), { major: 'SECOND', auto: false });
  assert.deepEqual(assignCourseMajor({ category: '교양선택', name: '마케팅원론' }, CTX), { major: 'PRIMARY', auto: true });
  assert.equal(assignCourseMajor({ category: '전공선택', name: '아무과목', offering_department_id: 28 }, CTX).major, 'SECOND');
  assert.equal(assignCourseMajor({ category: '전공선택', name: '마케팅원론', offering_department_id: 1 }, CTX).major, 'PRIMARY', '개설 학과가 이름보다 우선');
  assert.equal(assignCourseMajor({ category: '일반선택', name: '마케팅 원론' }, CTX).major, 'SECOND', '띄어쓰기 차이는 흡수');
  assert.equal(assignCourseMajor({ category: '전공선택', name: '공통과목' }, CTX).major, 'PRIMARY', '두 학과 공통 과목은 주전공');
});

test('제2전공 요건: 부전공 21, 계열 복수전공형 36, 복수전공은 최소전공(모르면 null)', () => {
  assert.deepEqual(secondMajorRequirement({ type: 'MINOR' }), { required: 21, basis: 'MINOR_21' });
  assert.deepEqual(secondMajorRequirement({ type: 'DOUBLE', broadSeriesDoubleMajorTrack: true }), { required: 36, basis: 'BROAD_SERIES_36' });
  assert.deepEqual(secondMajorRequirement({ type: 'DOUBLE', minimumMajorCredits: 48 }), { required: 48, basis: 'DOUBLE_MINIMUM' });
  assert.deepEqual(secondMajorRequirement({ type: 'DOUBLE', minimumMajorCredits: null }), { required: null, basis: 'DOUBLE_MINIMUM_UNKNOWN' });
});

test('졸업논문2는 합격 성적이 있어야 하고, 신청 제한 조합을 알아본다', () => {
  assert.equal(hasSecondThesis([{ name: '졸업(시험·작품)논문2', letter_grade: 'P' }], ['F', 'NP']), true);
  assert.equal(hasSecondThesis([{ name: '졸업(시험,작품)논문2', letter_grade: null }], ['F', 'NP']), false);
  assert.equal(hasSecondThesis([{ name: '졸업(시험·작품)논문', letter_grade: 'P' }], ['F', 'NP']), false, '졸업논문1은 아니다');
  assert.equal(isRestrictedCombination('약학과', '경영학과'), true);
  assert.equal(isRestrictedCombination('경영학과', '건축학과'), true);
  assert.equal(isRestrictedCombination('경영학과', '국어교육과'), true, '사범계열로의 다전공');
  assert.equal(isRestrictedCombination('컴퓨터·소프트웨어공학과', '경영학과'), false);
});

test('엔진: 복수전공이면 주전공을 최소전공으로 바꾸고 일반선택으로 옮겨 졸업학점은 같다. 부전공·완화 받은 학생은 그대로', async () => {
  const base = { admissionYear: 2022, enrollmentType: 'GENERAL', departmentName: '컴퓨터·소프트웨어공학과' };
  const rows = async (input) => (await resolveRequirementsForStudent(input)).rules.find((r) => r.id === 'REQUIREMENTS').value;
  const none = await rows(base);
  const dbl = await rows({ ...base, secondMajorType: 'DOUBLE' });
  const minor = await rows({ ...base, secondMajorType: 'MINOR' });
  const total = (v) => v.categories.reduce((s, c) => s + c.requiredCredits, 0);
  assert.equal(total(dbl), total(none));
  assert.deepEqual(dbl.categories.filter((c) => c.category === '전공').map((c) => c.requiredCredits), [48]);
  assert.ok(dbl.adjustments.includes('DOUBLE_MAJOR_MINIMUM'));
  assert.deepEqual(minor.categories, none.categories);
  const changed = await rows({ ...base, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 3, year: 2024, semester: 1 }, secondMajorType: 'DOUBLE' });
  assert.ok(!changed.adjustments.includes('DOUBLE_MAJOR_MINIMUM'), '이미 최소전공 완화를 받았다');
});

test('진단: 복수전공 — 제2전공으로 센 과목은 주전공에서 일반선택, 제2전공 학과 최소전공·졸업논문2를 싣는다', async () => {
  await setSecond('DOUBLE');
  await addCourse('마케팅원론', 3, '전공선택');
  await addCourse('경제학원론', 3, '일반선택');
  await addCourse('자료구조', 3, '전공필수');
  const s = await getGraduationStatus(studentId);
  assert.equal(s.secondMajor.type, 'DOUBLE');
  assert.equal(s.secondMajor.earned, 6);
  assert.equal(s.secondMajor.basis, 'DOUBLE_MINIMUM');
  assert.ok(s.secondMajor.required > 0);
  assert.deepEqual(s.secondMajor.thesis, { satisfied: false });
  const major = s.categories.find((c) => c.category === '전공');
  assert.equal(major.earnedCredits, 3, '주전공에는 자료구조만');
  assert.ok(s.regulation.flags.some((f) => f.code === 'SECOND_MAJOR_COURSES_ASSIGNED'));
});

test('진단: 학생이 고친 값이 자동 배정보다 우선하고, 부전공은 21학점이다', async () => {
  await setSecond('MINOR');
  await addCourse('마케팅원론', 3, '전공선택', { countedMajor: 'PRIMARY' });
  await addCourse('자료구조', 3, '전공필수', { countedMajor: 'SECOND' });
  const s = await getGraduationStatus(studentId);
  assert.deepEqual([s.secondMajor.required, s.secondMajor.earned, s.secondMajor.thesis], [21, 3, null]);
  assert.deepEqual(s.secondMajor.courses.map((c) => [c.name, c.auto]), [['자료구조', false]]);
  assert.ok(s.regulation.flags.some((f) => f.code === 'MINOR_DESIGNATED_COURSES'));
});

test('다전공이 없으면 secondMajor는 null이고 과목 목록에 countedMajor가 없다', async () => {
  await setSecond(null);
  await addCourse('마케팅원론', 3, '전공선택');
  assert.equal((await getGraduationStatus(studentId)).secondMajor, null);
  const res = await (await fetch(`${baseUrl}/api/my-courses`)).json();
  assert.equal('countedMajor' in res.data[0], false);
  assert.equal('countedMajorChoice' in res.data[0], false, '내부 필드는 응답에 싣지 않는다');
});

test('과목 API: 다전공 학생은 목록에 countedMajor(자동 여부 포함)가 붙고, PATCH로 고치거나 자동으로 되돌린다', async () => {
  await setSecond('DOUBLE');
  const id = await addCourse('마케팅원론', 3, '전공선택');
  const list = async () => (await (await fetch(`${baseUrl}/api/my-courses`)).json()).data.find((c) => c.id === id);
  assert.deepEqual([(await list()).countedMajor, (await list()).countedMajorAuto], ['SECOND', true]);
  const patch = (body) => fetch(`${baseUrl}/api/my-courses/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await patch({ countedMajor: 'PRIMARY' })).status, 200);
  assert.deepEqual([(await list()).countedMajor, (await list()).countedMajorAuto], ['PRIMARY', false]);
  await patch({ countedMajor: null });
  assert.equal((await list()).countedMajorAuto, true);
  assert.equal((await (await patch({ countedMajor: 'BOTH' })).json()).code, 'INVALID_COUNTED_MAJOR');
});
