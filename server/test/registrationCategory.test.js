const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { classifyByRegistration, applyAdjustments } = require('../services/regulationEngine/registrationCategory');
const { getGraduationStatus } = require('../services/graduationService');

/**
 * server/test/registrationCategory.test.js
 * 졸업진단의 제13조④ 반영(보정 라운드 B, D-46): 수강 학년도 기준 이수구분으로 다시 본 과목은 학점을 옮기고 "추정"으로 표시한다.
 * 앞부분은 DB 없는 순수 테스트, 뒷부분은 로컬 시드 + 임시 학생 1명.
 */

const change = (over) => ({ subjectKey: 'C:1', displayName: '창의융합프로젝트', field: 'category', toYear: 2020, oldValue: '전공선택', newValue: '전공필수', ...over });
const course = (over) => ({ name: '창의융합프로젝트', credits: 3, category: '전공선택', year: 2019, semester: 1, ...over });

test('수강 학년도 이수구분이 입력과 같으면 아무것도 옮기지 않는다', () => {
  const r = classifyByRegistration([course({ year: 2019, category: '전공선택' })], [change()]);
  assert.deepEqual(r, { adjusted: [], unresolved: [] });
});

test('변경 이후 학년도에 들었는데 옛 구분으로 입력했으면 새 구분으로 옮긴다(필수/선택 사이)', () => {
  const r = classifyByRegistration([course({ year: 2020, category: '전공선택' })], [change()]);
  assert.equal(r.adjusted.length, 1);
  assert.deepEqual([r.adjusted[0].entered, r.adjusted[0].applied, r.adjusted[0].credits], ['전공선택', '전공필수', 3]);
});

test('필수/선택 해석이 정해지지 않은 구분(전공기초 등)은 학점을 옮기지 않고 unresolved로만 알린다', () => {
  const r = classifyByRegistration([course({ year: 2026, category: '전공필수' })], [change({ toYear: 2026, oldValue: '전공필수', newValue: '전공기초' })]);
  assert.equal(r.adjusted.length, 0);
  assert.deepEqual(r.unresolved.map((u) => [u.entered, u.applied]), [['전공필수', '전공기초']]);
});

test('같은 이름이 서로 다른 학수번호로 둘 이상이면 어느 과목인지 모르므로 건너뛴다(추측 금지)', () => {
  const r = classifyByRegistration([course({ year: 2020 })], [change(), change({ subjectKey: 'C:2' })]);
  assert.deepEqual(r, { adjusted: [], unresolved: [] });
});

test('이수구분 변경이 없는 과목은 건드리지 않는다', () => {
  assert.deepEqual(classifyByRegistration([course({ name: '무관과목', year: 2022 })], [change()]), { adjusted: [], unresolved: [] });
});

test('학교 공지 override가 있으면 그 구분이 우선한다', () => {
  const r = classifyByRegistration([course({ year: 2020, category: '전공필수' })], [change()], [{ courseKey: 'C:1', academicYear: 2020, semester: null, category: '일반선택', basisArticleRef: 'ENFORCEMENT_RULES:제13조④' }]);
  assert.deepEqual(r.adjusted.map((a) => [a.applied, a.source]), [['일반선택', 'OVERRIDE']]);
});

test('applyAdjustments: 원본 맵은 그대로, 새 맵에서 학점이 이동한다', () => {
  const base = { 전공선택: 6, 전공필수: 3 };
  const out = applyAdjustments(base, [{ entered: '전공선택', applied: '전공필수', credits: 3 }]);
  assert.deepEqual(out, { 전공선택: 3, 전공필수: 6 });
  assert.deepEqual(base, { 전공선택: 6, 전공필수: 3 });
});

// ─── DB ───
let studentId;
let deptId;
before(async () => {
  const [[d]] = await pool.query("SELECT id FROM departments WHERE name = '컴퓨터·소프트웨어공학과' LIMIT 1");
  deptId = d.id;
  const [r] = await pool.query("INSERT INTO students (email, name, onboarding_completed_at, department_id, admission_year, enrollment_type) VALUES (?, ?, NOW(), ?, 2022, 'GENERAL')", [`reg-cat-${Date.now()}@example.test`, `regcat${Date.now()}`, deptId]);
  studentId = r.insertId;
});
after(async () => {
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

const earned = (s, category) => (s.categories.find((c) => c.category === category) || {}).earnedCredits;

test('DB: 창의융합프로젝트를 2020학년도에 전공선택으로 입력 → 그 해 구분(전공필수)으로 옮겨 합산 + 추정 표시', async () => {
  await pool.query('DELETE FROM student_courses WHERE student_id = ?', [studentId]);
  await pool.query("INSERT INTO student_courses (student_id, name, credits, category, year, semester) VALUES (?, '창의융합프로젝트', 3, '전공선택', 2020, 1)", [studentId]);
  const s = await getGraduationStatus(studentId);
  assert.deepEqual(s.regulation.registrationCategory.adjusted.map((a) => [a.entered, a.applied]), [['전공선택', '전공필수']]);
  assert.equal(earned(s, '전공필수'), 3);
  assert.equal(earned(s, '전공선택'), 0);
  assert.ok(s.regulation.flags.some((f) => f.code === 'REGISTRATION_CATEGORY_APPLIED'));
  assert.notEqual(s.regulation.confidence, 'CONFIRMED', '추정이어야 한다');
});

test('DB: 2020학년도에 입력한 구분과 같으면(전공필수) 이동 없음', async () => {
  await pool.query('DELETE FROM student_courses WHERE student_id = ?', [studentId]);
  await pool.query("INSERT INTO student_courses (student_id, name, credits, category, year, semester) VALUES (?, '창의융합프로젝트', 3, '전공필수', 2020, 1)", [studentId]);
  const s = await getGraduationStatus(studentId);
  assert.equal(s.regulation.registrationCategory.adjusted.length, 0);
  assert.equal(earned(s, '전공필수'), 3);
});

test('DB: 2026학년도 편성표의 전공기초 등은 학점을 옮기지 않고 알리기만 한다(신뢰도는 이 항목 때문에 내려가지 않는다)', async () => {
  await pool.query('DELETE FROM student_courses WHERE student_id = ?', [studentId]);
  await pool.query("INSERT INTO student_courses (student_id, name, credits, category, year, semester) VALUES (?, '데이터구조', 3, '전공필수', 2026, 1)", [studentId]);
  const s = await getGraduationStatus(studentId);
  assert.equal(s.regulation.registrationCategory.adjusted.length, 0);
  assert.deepEqual(s.regulation.registrationCategory.unresolved.map((u) => u.applied), ['전공기초']);
  assert.equal(earned(s, '전공필수'), 3);
  const info = s.regulation.flags.find((f) => f.code === 'REGISTRATION_CATEGORY_NOT_COMPARABLE');
  assert.equal(info.level, 'INFO');
});
