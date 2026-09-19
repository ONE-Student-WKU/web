const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const courseService = require('../services/courseService');

/**
 * server/test/courseService.ownership.test.js
 * updateMyCourse/deleteMyCourse가 SQL 자체에서 student_id로 소유권을 강제하는지 검증
 * (IDOR 방지 — server/routes/myCourses.js의 사전 체크(findMyCourseById)가 없어도
 * 이 두 함수 자체가 안전해야 한다는 게 이 테스트의 취지).
 *
 * 실제 로컬 DB(로컬 개발과 동일한 wku-mysql)에 붙는 통합 테스트 — 이 서비스 계층이
 * mysql2 pool을 직접 쓰는 구조라 모킹보다 실제 DB로 검증하는 게 더 신뢰도 높다.
 * student_id=1, student_id=2는 db/seed의 기본 시드 학생(hong/kim)을 그대로 사용한다.
 */

const OWNER_STUDENT_ID = 1;
const OTHER_STUDENT_ID = 2;
const FIXTURE_NAME = '__TEST_FIXTURE_ownership__';
// 실제 시드 데이터와 절대 안 겹치게 연도를 비현실적인 값으로 잡는다.
const FIXTURE_YEAR = 1900;
const FIXTURE_SEMESTER = 1;

async function cleanupFixtures() {
  await pool.query('DELETE FROM student_courses WHERE name = ?', [FIXTURE_NAME]);
}

async function insertFixtureCourse() {
  const [result] = await pool.query(
    'INSERT INTO student_courses (student_id, course_id, name, credits, category, year, semester) VALUES (?, NULL, ?, 3.0, ?, ?, ?)',
    [OWNER_STUDENT_ID, FIXTURE_NAME, '전공선택', FIXTURE_YEAR, FIXTURE_SEMESTER]
  );
  return result.insertId;
}

before(cleanupFixtures); // 이전 실행이 중간에 죽어서 남긴 fixture가 있으면 먼저 정리
after(cleanupFixtures);

test('updateMyCourse: 소유자가 아닌 studentId로는 수정되지 않는다', async () => {
  const id = await insertFixtureCourse();
  try {
    await courseService.updateMyCourse(OTHER_STUDENT_ID, id, { midterm: 99 });
    const [rows] = await pool.query('SELECT midterm FROM student_courses WHERE id = ?', [id]);
    assert.equal(rows[0].midterm, null, '다른 학생의 studentId로 수정 시도했는데 값이 바뀌면 안 됨');
  } finally {
    await pool.query('DELETE FROM student_courses WHERE id = ?', [id]);
  }
});

test('updateMyCourse: 진짜 소유자는 정상적으로 수정된다', async () => {
  const id = await insertFixtureCourse();
  try {
    await courseService.updateMyCourse(OWNER_STUDENT_ID, id, { midterm: 88 });
    const [rows] = await pool.query('SELECT midterm FROM student_courses WHERE id = ?', [id]);
    assert.equal(Number(rows[0].midterm), 88);
  } finally {
    await pool.query('DELETE FROM student_courses WHERE id = ?', [id]);
  }
});

test('deleteMyCourse: 소유자가 아닌 studentId로는 삭제되지 않는다', async () => {
  const id = await insertFixtureCourse();
  try {
    await courseService.deleteMyCourse(OTHER_STUDENT_ID, id);
    const [rows] = await pool.query('SELECT id FROM student_courses WHERE id = ?', [id]);
    assert.equal(rows.length, 1, '다른 학생의 studentId로 삭제 시도했는데 실제로 지워지면 안 됨');
  } finally {
    await pool.query('DELETE FROM student_courses WHERE id = ?', [id]);
  }
});

test('deleteMyCourse: 진짜 소유자는 정상적으로 삭제된다', async () => {
  const id = await insertFixtureCourse();
  await courseService.deleteMyCourse(OWNER_STUDENT_ID, id);
  const [rows] = await pool.query('SELECT id FROM student_courses WHERE id = ?', [id]);
  assert.equal(rows.length, 0);
});

after(async () => {
  await pool.end();
});
