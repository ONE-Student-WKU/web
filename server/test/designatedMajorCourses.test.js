const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const studentService = require('../services/studentService');
const { loadDesignatedMajorCourses, DESIGNATED_MAJOR_COURSE_DEPARTMENTS } = require('../services/designatedMajorCourses');

/**
 * server/test/designatedMajorCourses.test.js
 * 학칙시행규칙 제9조 제1호 학과의 지정 전공 과목 안내(#378 결정 5-1 A — 판정하지 않고 편성표 목록만). 시드 DB를 쓴다.
 */

after(() => pool.end());

const studentOf = async (name, admissionYear) => {
  const d = (await studentService.listDepartments()).find((x) => x.name === name);
  return { department_id: d.id, department_name: name, track_id: null, admission_year: admissionYear };
};

test('간호학과: 가장 최근 편성의 전공기초·전공필수 목록을 내고, 들은 과목을 표시한다', async () => {
  const student = await studentOf('간호학과', 2024);
  const first = await loadDesignatedMajorCourses(student, []);
  assert.ok(first, '제9조 학과면 목록을 낸다');
  assert.ok(first.courses.length > 0);
  assert.ok(first.courses.every((c) => c.category === '전공기초' || c.category === '전공필수'));
  assert.equal(new Set(first.courses.map((c) => c.courseName)).size, first.courses.length, '과목은 한 번씩만');
  assert.ok(first.courses.every((c) => c.taken === false));

  const name = first.courses[0].courseName;
  const again = await loadDesignatedMajorCourses(student, [name]);
  assert.equal(again.courses.find((c) => c.courseName === name).taken, true);
});

test('제9조 제1호 학과가 아니면(경영학과, 제외된 보건행정학과) 내지 않는다', async () => {
  assert.equal(await loadDesignatedMajorCourses(await studentOf('경영학과', 2024), []), null);
  assert.equal(await loadDesignatedMajorCourses(await studentOf('보건행정학과', 2024), []), null);
});

test('지정 학과 목록은 모두 실제 학과 이름이다(이름이 바뀌면 이 테스트가 잡는다)', async () => {
  const names = new Set((await studentService.listDepartments()).map((d) => d.name));
  for (const n of DESIGNATED_MAJOR_COURSE_DEPARTMENTS) assert.ok(names.has(n), n);
});
