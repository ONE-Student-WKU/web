const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const studentService = require('../services/studentService');
const { buildRuleKey } = require('../services/curriculumKeys');

/**
 * server/test/onboarding.departmentYearRange.test.js
 * 온보딩 학과 목록이 내려주는 학번 범위 두 벌을 확인한다.
 *  - min/maxAdmissionYear: 졸업인증제 같은 부가 행까지 포함한 넓은 범위(전과생용)
 *  - coreMin/MaxAdmissionYear: 교양·전공 요건 행만 본 범위(일반·편입용)
 * 임시 학과와 요건 행을 만들고 끝나면 지운다(요건 행을 먼저 지워야 학과를 지울 수 있다). 로컬 DB 전용.
 */

const run = Date.now();
let deptId;
let openEndedDeptId;
let successorAId;
let successorBId;

// rule_key는 실제 시드와 같은 규칙(buildRuleKey)으로 채운다: 서버 테스트 파일은 병렬로 돌고, curriculumHistoryService.test.js가
// 전체 테이블에서 "rule_key가 JS 규칙과 같다"와 "같은 (학과, rule_key)의 학번 범위는 겹치지 않는다"를 검사한다.
// 임시 행의 rule_key가 비어 있거나 임의 값이면 그 사이에 돌 때 간헐적으로 실패한다.
async function addRow(departmentId, departmentName, category, min, max, { enrollmentType = null, minCourseCount = null } = {}) {
  await pool.query(
    `INSERT INTO curriculum_requirements
       (department_id, category, required_credits, min_admission_year, max_admission_year, enrollment_type, min_course_count, rule_key)
     VALUES (?, ?, 10, ?, ?, ?, ?, ?)`,
    [departmentId, category, min, max, enrollmentType, minCourseCount, buildRuleKey(departmentName, category, enrollmentType)]
  );
}

before(async () => {
  const name1 = `yr-test-${run}`;
  const [d1] = await pool.query('INSERT INTO departments (name) VALUES (?)', [name1]);
  deptId = d1.insertId;
  // 전공·교양 요건은 2023~2025, 졸업인증제 행은 2020~2025, 전과 특례 행은 2018~2025.
  await addRow(deptId, name1, '전공필수', 2023, 2023);
  await addRow(deptId, name1, '전공선택', 2024, 2025);
  await addRow(deptId, name1, '교양필수', 2023, 2025);
  await addRow(deptId, name1, '졸업인증제', 2020, 2025, { minCourseCount: 1 });
  await addRow(deptId, name1, '전공', 2018, 2025, { enrollmentType: 'MAJOR_CHANGE' });

  // 상한이 열린 학과(2026학번부터 max=NULL) — 졸업인증제는 더 이른 학번부터.
  const name2 = `yr-open-${run}`;
  const [d2] = await pool.query('INSERT INTO departments (name) VALUES (?)', [name2]);
  openEndedDeptId = d2.insertId;
  await addRow(openEndedDeptId, name2, '전공선택', 2026, null);
  await addRow(openEndedDeptId, name2, '졸업인증제', 2022, null, { minCourseCount: 1 });

  // 개편 이력: 옛 학과(openEndedDeptId)가 후속 두 학과로 분리(추정 1건, 문서 확인 1건).
  const [s1] = await pool.query('INSERT INTO departments (name) VALUES (?)', [`yr-succ-a-${run}`]);
  const [s2] = await pool.query('INSERT INTO departments (name) VALUES (?)', [`yr-succ-b-${run}`]);
  successorAId = s1.insertId;
  successorBId = s2.insertId;
  await pool.query(
    `INSERT INTO department_lineage (from_department_id, to_department_id, relation, effective_year, source) VALUES
       (?, ?, 'SPLIT', 2026, 'NAME_MATCH'), (?, ?, 'SPLIT', 2026, 'DOC')`,
    [openEndedDeptId, successorAId, openEndedDeptId, successorBId]
  );
});

after(async () => {
  try {
    const ids = [deptId, openEndedDeptId, successorAId, successorBId].filter(Boolean);
    await pool.query('DELETE FROM department_lineage WHERE from_department_id IN (?) OR to_department_id IN (?)', [ids, ids]);
    await pool.query('DELETE FROM curriculum_requirements WHERE department_id IN (?)', [ids]);
    await pool.query('DELETE FROM departments WHERE id IN (?)', [ids]);
  } finally {
    await pool.end();
  }
});

test('부가 행(졸업인증제)은 넓은 범위에만 들어가고 core 범위에는 들어가지 않는다', async () => {
  const dept = (await studentService.listDepartments()).find((d) => d.id === deptId);
  assert.equal(dept.minAdmissionYear, 2020);
  assert.equal(dept.maxAdmissionYear, 2025);
  assert.equal(dept.coreMinAdmissionYear, 2023);
  assert.equal(dept.coreMaxAdmissionYear, 2025);
});

test('상한이 열린 학과는 core 하한이 요건 시작 학번이고 상한은 NULL이다', async () => {
  const dept = (await studentService.listDepartments()).find((d) => d.id === openEndedDeptId);
  assert.equal(dept.minAdmissionYear, 2022);
  assert.equal(dept.coreMinAdmissionYear, 2026);
  assert.equal(dept.coreMaxAdmissionYear, null);
});

test('요건 행이 하나도 없는 학과는 두 범위 모두 NULL이다', async () => {
  const [r] = await pool.query('INSERT INTO departments (name) VALUES (?)', [`yr-empty-${run}`]);
  try {
    const dept = (await studentService.listDepartments()).find((d) => d.id === r.insertId);
    assert.equal(dept.coreMinAdmissionYear, null);
    assert.equal(dept.minAdmissionYear, null);
  } finally {
    await pool.query('DELETE FROM departments WHERE id = ?', [r.insertId]);
  }
});

test('개편 이력이 있는 옛 학과는 후속 학과 이름을 내려주고, 하나라도 추정이면 confirmed=false다', async () => {
  const depts = await studentService.listDepartments();
  const old = depts.find((d) => d.id === openEndedDeptId);
  assert.deepEqual(
    old.successors.map((x) => [x.name, x.effectiveYear, x.confirmed]).sort(),
    [[`yr-succ-a-${run}`, 2026, false], [`yr-succ-b-${run}`, 2026, true]].sort()
  );
  // 이력이 없는 학과, 그리고 후속 학과 자신은 빈 배열이다.
  assert.deepEqual(depts.find((d) => d.id === deptId).successors, []);
  assert.deepEqual(depts.find((d) => d.id === successorAId).successors, []);
});
