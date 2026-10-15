const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { seedScrapedData } = require('../scripts/seedCourseOfferings');

/**
 * server/test/seedCourseOfferings.rerun.test.js
 * 개설과목 시딩을 다시 돌려도(재시딩) 실패하지 않는지 확인한다(#375).
 * uq_course_offerings에는 학과가 없어서, 두 학과가 같은 분반을 가지면 예전 코드는 두 번째 실행에서 아직 지우지 않은 다른 학과의
 * 행과 부딪혀 Duplicate entry로 실패했다. 그 실패로 재시딩 크론이 멈춰 뒤의 규정 재임베딩이 실행되지 않았다.
 * 로컬 DB에 2099년 가짜 개설과목만 넣고 끝나면 지운다.
 */

const YEAR = 2099;
const SEMESTER = 1;
const row = (courseCode) => ({ grade: '1', category: '기전', courseCode, courseName: `재시딩검사${courseCode}`, section: '01', credits: '3.0', professor: '검사', time: '월12' });
const dataset = (departmentName, rows) => ({ label: `${departmentName} ${YEAR}`, departmentName, trackName: null, year: YEAR, semester: SEMESTER, rows });

after(async () => {
  await pool.query('DELETE FROM course_offerings WHERE year = ?', [YEAR]);
  await pool.end();
});

test('두 학과가 같은 분반을 가져도, 순서를 바꿔 다시 시딩하면 실패하지 않고 그 분반은 한 행만 남는다', async () => {
  const shared = row('RERUN01');
  const a = dataset('컴퓨터·소프트웨어공학과', [shared, row('RERUN02')]);
  const b = dataset('공학3계열', [shared]);

  await seedScrapedData([a, b]);
  // 예전 코드: b를 먼저 처리하면 b만 지우고 넣다가, 아직 지우지 않은 a의 같은 분반 행과 부딪혔다.
  await seedScrapedData([b, a]);

  const [rows] = await pool.query('SELECT course_code FROM course_offerings WHERE year = ? AND semester = ? ORDER BY course_code', [YEAR, SEMESTER]);
  assert.deepEqual(rows.map((r) => r.course_code), ['RERUN01', 'RERUN02']);
});
