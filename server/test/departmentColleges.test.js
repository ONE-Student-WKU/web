const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { attachColleges, currentColleges, cleanUnitName } = require('../services/departmentColleges');
const studentService = require('../services/studentService');

/**
 * server/test/departmentColleges.test.js
 * 온보딩 학과 트리: 학칙 [별표 1] 2026학년도 표로 학과의 소속 대학을 붙이는 규칙.
 * ① 순수 규칙(가짜 표) ② 실제 자료 파일과 로컬 DB로 만든 학과 목록.
 */

after(async () => {
  await pool.end();
});

const FAKE = {
  tables: [
    { cohort: { min: 2027, max: null }, colleges: [{ college: '미래대학', units: ['새학과'] }] },
    {
      cohort: { min: 2026, max: 2026 },
      colleges: [
        { college: '교학대학', units: ['원불교학과'] },
        { college: '공과대학', units: ['공학3계열', '<건축학과>**', '(외국인전용)'] },
        { college: '빈대학', units: ['(비고)'] },
      ],
    },
    { cohort: { min: 2025, max: 2025 }, colleges: [{ college: '창의공과대학', units: ['컴퓨터·소프트웨어공학과'] }] },
  ],
};

test('표시 기호(<>*)는 지우고, 괄호만 있는 비고 칸은 학과가 아니라서 버린다', () => {
  assert.equal(cleanUnitName('<의학과>**'), '의학과');
  assert.equal(cleanUnitName(' 공학1계열 '), '공학1계열');
  assert.equal(cleanUnitName('(외국인전용)'), null);
  assert.equal(cleanUnitName(''), null);
});

test('현재 기준은 2026학년도 표이고, 학과가 없는 대학(비고만 있는 칸)은 목록에서 빠진다', () => {
  const colleges = currentColleges(FAKE);
  assert.deepEqual(colleges.map((c) => c.college), ['교학대학', '공과대학']);
  assert.deepEqual(colleges[1].units, ['공학3계열', '건축학과']);
});

test('규칙 1: 2026 표에 이름이 있으면 그 대학, 지금 있는 학과(former=false), 대학 순서(collegeOrder)가 붙는다', () => {
  const [a, b] = attachColleges([{ id: 1, name: '원불교학과', successors: [] }, { id: 2, name: '건축학과', successors: [] }], FAKE);
  assert.deepEqual([a.college, a.former, a.collegeOrder], ['교학대학', false, 0]);
  assert.deepEqual([b.college, b.former, b.collegeOrder], ['공과대학', false, 1]);
});

test('규칙 2: 이름이 바뀐 옛 학과는 후속 학과가 속한 대학 아래 "이전 학과"로 붙는다(옛 소속 대학 이름은 쓰지 않는다)', () => {
  const [d] = attachColleges([{ id: 3, name: '컴퓨터·소프트웨어공학과', successors: [{ name: '공학3계열' }] }], FAKE);
  assert.deepEqual([d.college, d.former], ['공과대학', true]); // 2025 표의 "창의공과대학"이 아니라 현재 대학
});

test('규칙 3: 어디에도 못 붙으면 추측하지 않고 college=null(이전 학과)로 둔다', () => {
  const [d] = attachColleges([{ id: 4, name: '폐지된학과', successors: [] }, ], FAKE);
  assert.deepEqual([d.college, d.former, d.collegeOrder], [null, true, null]);
});

test('자료를 못 읽으면(null) 모두 college=null, former=false — 화면이 평평한 목록으로 되돌아간다', () => {
  const [d] = attachColleges([{ id: 5, name: '원불교학과', successors: [] }], null);
  assert.deepEqual([d.college, d.former], [null, false]);
});

test('후속 학과가 2026 표에 없으면(예: 후속이 신설 전) 대학을 붙이지 않는다', () => {
  const [d] = attachColleges([{ id: 6, name: '옛학과', successors: [{ name: '표에없는계열' }] }], FAKE);
  assert.equal(d.college, null);
});

test('실제 학과 목록: 현재 학과와 이전 학과가 알려진 대학에 붙고, 기존 필드(요건 학번 범위·후속 학과)는 그대로 있다', async () => {
  const departments = await studentService.listDepartments();
  const byName = new Map(departments.map((d) => [d.name, d]));

  const engineering3 = byName.get('공학3계열');
  assert.equal(engineering3.college, '공과대학');
  assert.equal(engineering3.former, false);

  const cse = byName.get('컴퓨터·소프트웨어공학과');
  assert.equal(cse.college, '공과대학');
  assert.equal(cse.former, true);
  assert.ok(cse.successors.some((s) => s.name === '공학3계열'));
  assert.ok('coreMinAdmissionYear' in cse && 'maxAdmissionYear' in cse);

  const business = byName.get('경영학과');
  assert.equal(business.college, '경상대학');
  assert.equal(business.former, true);

  assert.equal(byName.get('간호학과').college, '간호대학');
  // 어느 대학에도 못 붙은 학과는 이름을 그대로 두고 college만 비운다
  assert.ok(departments.filter((d) => d.college === null).every((d) => d.former === true));
  // 같은 학과가 두 대학에 중복으로 들어가지 않는다
  assert.equal(new Set(departments.map((d) => d.id)).size, departments.length);
});
