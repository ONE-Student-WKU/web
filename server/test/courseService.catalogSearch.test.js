const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const courseService = require('../services/courseService');

/**
 * server/test/courseService.catalogSearch.test.js
 * 카탈로그 검색: 띄어쓰기 무시·이름 시작 우선·교수명·초성·약칭·오타 허용.
 * 실제 학기와 겹치지 않는 임시 연도(2999)에 개설과목을 만들고 끝나면 지운다. 로컬 DB 전용.
 */

const YEAR = 2999;
const SEMESTER = 1;
let departmentId;

async function addOffering(name, professor, credits = 3, schedule = []) {
  const [r] = await pool.query(
    "INSERT INTO course_offerings (department_id, year, semester, category, course_name, section, credits, professor) VALUES (?, ?, ?, '전공선택', ?, '01', ?, ?)",
    [departmentId, YEAR, SEMESTER, name, credits, professor]
  );
  for (const [day, period] of schedule) {
    await pool.query('INSERT INTO course_offering_schedules (offering_id, day, period) VALUES (?, ?, ?)', [r.insertId, day, period]);
  }
  return r.insertId;
}

const search = async (keyword) => (await courseService.searchCatalog(keyword, YEAR, SEMESTER)).map((c) => c.name);

before(async () => {
  const [[dept]] = await pool.query('SELECT id FROM departments ORDER BY id LIMIT 1');
  departmentId = dept.id;
  await pool.query('DELETE FROM course_offerings WHERE year = ?', [YEAR]);
  await addOffering('컴퓨터네트워크', '고성현', 3, [['월', 5], ['월', 6]]);
  await addOffering('컴퓨터구조', '이종민');
  await addOffering('알고리즘', '김영수');
  await addOffering('고급알고리즘', '박철수');
  await addOffering('자료구조', '정영지');
  await addOffering('데이터베이스', '최민호');
  await addOffering('기업연계프로젝트1(종합설계1)', '한기업');
  await addOffering('졸업(시험.작품)논문', '교직원김', 0);
  courseService.clearCatalogCache();
});

after(async () => {
  await pool.query('DELETE FROM course_offerings WHERE year = ?', [YEAR]); // 시간표는 CASCADE
  courseService.clearCatalogCache();
  await pool.end();
});

test('띄어쓰기가 달라도 찾고, 시간표도 같이 내려준다', async () => {
  const found = await courseService.searchCatalog('컴퓨터 네트워크', YEAR, SEMESTER);
  assert.deepEqual(found.map((c) => c.name), ['컴퓨터네트워크']);
  assert.deepEqual(found[0].schedule, [{ day: '월', period: 5 }, { day: '월', period: 6 }]);
  assert.equal(found[0].professor, '고성현');
  assert.equal(typeof found[0].credits, 'number');
});

test('이름이 검색어로 시작하는 과목이 포함만 하는 과목보다 먼저 나온다', async () => {
  assert.deepEqual(await search('알고리즘'), ['알고리즘', '고급알고리즘']);
});

test('초성으로 찾는다', async () => {
  assert.deepEqual(await search('ㅇㄱㄹㅈ'), ['알고리즘', '고급알고리즘']);
  assert.deepEqual(await search('ㅈㄹㄱㅈ'), ['자료구조']);
});

test('약칭으로 찾는다', async () => {
  assert.deepEqual(await search('기연프1'), ['기업연계프로젝트1(종합설계1)']);
  assert.deepEqual(await search('디비'), ['데이터베이스']);
  assert.deepEqual(await search('자구'), ['자료구조']);
});

test('교수명으로 찾는다(이름 일치가 먼저)', async () => {
  assert.deepEqual(await search('정영지'), ['자료구조']);
  assert.deepEqual(await search('이종민'), ['컴퓨터구조']);
});

test('0학점 과목의 담당교수는 검색에도 쓰지 않고 응답에도 내려주지 않는다', async () => {
  assert.deepEqual(await search('교직원김'), []);
  const [thesis] = await courseService.searchCatalog('졸업시험작품논문', YEAR, SEMESTER);
  assert.equal(thesis.professor, null);
});

test('정확히 일치하는 과목이 없을 때만 오타를 허용해 찾는다', async () => {
  assert.deepEqual(await search('자료구죠'), ['자료구조']);
  assert.deepEqual(await search('데이터베이쓰'), ['데이터베이스']);
});

test('구두점 표기 차이를 흡수한다', async () => {
  assert.deepEqual(await search('졸업(시험·작품)논문'), ['졸업(시험.작품)논문']);
});

test('문장부호뿐인 검색어는 아무것도 찾지 않고, 검색어가 없으면 그 학기 전체를 준다', async () => {
  assert.deepEqual(await search('?!'), []);
  assert.equal((await search('')).length, 8);
  assert.equal((await search(undefined)).length, 8);
});

test('다른 학기에는 결과가 없다', async () => {
  assert.deepEqual(await courseService.searchCatalog('알고리즘', YEAR, 3), []);
});
