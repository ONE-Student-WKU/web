const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const curriculumService = require('../services/curriculumService');

/**
 * server/test/curriculumService.scoping.test.js
 * lookupFromMessage가 학생의 department_id를 알면 그 학과로 좁히고, 모르면(온보딩 전 등)
 * 전체 학과를 대상으로 하는지 검증. 전체 학과 확장 대비 성능 점검 중 findMentionedCourseNames를
 * 학과 필터 없이 전체 스캔하던 걸 고친 부분(server/services/curriculumService.js)의 회귀 방지용.
 *
 * db/curriculum(npm run seed:curriculum)이 미리 시딩돼 있어야 한다 — 컴퓨터·소프트웨어공학과
 * (department_id=1)와 공학3계열(department_id=2, 트랙 2개)의 실제 교육과정 데이터를 사용한다.
 */

let dept1Id;
let dept1CourseName;
let dept2OnlyCourseName;

before(async () => {
  const [depts] = await pool.query("SELECT id FROM departments WHERE name = '컴퓨터·소프트웨어공학과'");
  if (depts.length === 0) {
    throw new Error(
      "테스트 전제 조건 미충족: '컴퓨터·소프트웨어공학과'가 시딩돼 있지 않음. `npm run seed:curriculum --workspace=server`를 먼저 실행하세요."
    );
  }
  dept1Id = depts[0].id;

  const [dept1Courses] = await pool.query('SELECT DISTINCT course_name FROM curriculum_courses WHERE department_id = ?', [
    dept1Id,
  ]);
  const [otherDeptCourses] = await pool.query(
    'SELECT DISTINCT course_name FROM curriculum_courses WHERE department_id != ?',
    [dept1Id]
  );
  if (dept1Courses.length === 0 || otherDeptCourses.length === 0) {
    throw new Error('테스트 전제 조건 미충족: curriculum_courses에 최소 2개 학과 데이터가 필요합니다.');
  }

  const dept1Names = new Set(dept1Courses.map((r) => r.course_name));
  dept1CourseName = dept1Courses[0].course_name;
  dept2OnlyCourseName = otherDeptCourses.map((r) => r.course_name).find((name) => !dept1Names.has(name));
});

after(async () => {
  await pool.end();
});

test('학과를 모르면(온보딩 전) 다른 학과 과목명도 결과에 포함된다', async () => {
  const message = `${dept1CourseName} 이랑 ${dept2OnlyCourseName} 알려줘`;
  const results = await curriculumService.lookupFromMessage(message, { department_id: null, track_id: null });
  const titles = results.map((r) => r.documentTitle).join(' / ');

  assert.ok(results.length >= 2, `학과 모를 땐 최소 두 학과 결과가 나와야 함 (실제: ${titles})`);
});

test('학과를 알면 다른 학과 과목명이 섞여도 자기 학과 결과만 나온다', async () => {
  const message = `${dept1CourseName} 이랑 ${dept2OnlyCourseName} 알려줘`;
  const results = await curriculumService.lookupFromMessage(message, { department_id: dept1Id, track_id: null });

  assert.ok(results.length > 0, '학과를 아는데 결과가 하나도 없으면 안 됨(최소 dept1CourseName은 나와야 함)');
  for (const r of results) {
    assert.ok(
      !r.documentTitle.includes(dept2OnlyCourseName),
      `학과=1로 스코핑했는데 다른 학과 전용 과목(${dept2OnlyCourseName})이 결과에 섞임: ${r.documentTitle}`
    );
  }
});
