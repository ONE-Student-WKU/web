const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const history = require('../services/curriculumHistoryService');
const { buildRuleKey, buildCourseKey } = require('../services/curriculumKeys');

/**
 * server/test/curriculumHistoryService.test.js
 * 시딩된 DB로 변경 이력 조회와 "학생 적용 규정 vs 변경 이력" 분리를 검증한다.
 * 전제: npm run db:migrate, seed(요건), seed:curriculum / seed:curriculum-2024·2025·2026, seed:lineage,
 * generate:curriculum-changes가 실행돼 있어야 한다.
 */

let cseId;

before(async () => {
  const [rows] = await pool.query("SELECT id FROM departments WHERE name = '컴퓨터·소프트웨어공학과'");
  const [[changes]] = await pool.query("SELECT COUNT(*) AS n FROM curriculum_changes WHERE source = 'AUTO'");
  if (rows.length === 0 || changes.n === 0) {
    throw new Error(
      '테스트 전제 조건 미충족: 시드와 `npm run seed:lineage`, `npm run generate:curriculum-changes`(--workspace=server)를 먼저 실행하세요.'
    );
  }
  cseId = rows[0].id;
});

after(async () => {
  await pool.end();
});

test('모든 요건 행에 rule_key, 모든 과목 행에 course_key가 있고 JS 규칙과 같은 값이다', async () => {
  const [reqs] = await pool.query(
    `SELECT d.name AS dept, cr.category, cr.enrollment_type, cr.rule_key
     FROM curriculum_requirements cr JOIN departments d ON d.id = cr.department_id`
  );
  assert.ok(reqs.length > 0);
  for (const r of reqs) assert.equal(r.rule_key, buildRuleKey(r.dept, r.category, r.enrollment_type));

  const [courses] = await pool.query('SELECT course_code, course_name, course_key FROM curriculum_courses');
  assert.ok(courses.length > 0);
  for (const c of courses) assert.equal(c.course_key, buildCourseKey(c.course_code, c.course_name));
});

test('같은 rule_key의 버전들은 학번 범위가 겹치지 않는다(같은 규정의 시간순 버전)', async () => {
  const [rows] = await pool.query(
    `SELECT rule_key, department_id, min_admission_year AS a, max_admission_year AS b
     FROM curriculum_requirements ORDER BY rule_key, department_id`
  );
  const lo = (v) => v ?? -Infinity;
  const hi = (v) => v ?? Infinity;
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.department_id}|${r.rule_key}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  for (const [k, list] of byKey) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        assert.ok(!(lo(list[i].a) <= hi(list[j].b) && lo(list[j].a) <= hi(list[i].b)), `학번 범위 겹침: ${k}`);
      }
    }
  }
});

test('학생 적용 규정과 변경 이력 분리: 2018학번 컴소공은 136을 유지하고 2026학번의 130은 "이후 변경"으로만 나온다', async () => {
  const r = await history.describeRuleForCohort({ departmentId: cseId, category: 'GRAD_TOTAL', admissionYear: 2018 });
  assert.equal(r.applied.requiredCredits, 136);
  assert.equal(r.earlierChanges.length, 0);
  const later = r.laterChanges.find((c) => c.toYear === 2026 && c.field === 'required_credits');
  assert.equal(later.oldValue, '136');
  assert.equal(later.newValue, '130');
  assert.equal(later.fromYear, 2025);
  assert.ok(later.successorDepartmentId, '학과 개편(공학3계열)을 건넌 변경이라 이후 학과가 있어야 함');
});

test('교양 합계: 2018학번은 23, 2022학번부터 39로 바뀐 이력이 있다(2024→2025에는 37)', async () => {
  const r2018 = await history.describeRuleForCohort({ departmentId: cseId, category: 'LIBERAL_TOTAL', admissionYear: 2018 });
  assert.equal(r2018.applied.requiredCredits, 23);
  assert.deepEqual(
    r2018.laterChanges.map((c) => [c.fromYear, c.toYear, c.oldValue, c.newValue]),
    [[2021, 2022, '23', '39'], [2024, 2025, '39', '37']]
  );

  const r2023 = await history.describeRuleForCohort({ departmentId: cseId, category: 'LIBERAL_TOTAL', admissionYear: 2023 });
  assert.equal(r2023.applied.requiredCredits, 39);
  assert.equal(r2023.earlierChanges.length, 1, '2022학번 이전에 이미 바뀐 것은 "이전 변경"');
});

test('규정 버전: 컴소공 일반선택은 2017~2021 38, 2022~2024 22, 2025 24', async () => {
  const { versions } = await history.getRuleVersions({ departmentId: cseId, category: '일반선택' });
  assert.deepEqual(
    versions.map((v) => [v.minAdmissionYear, v.maxAdmissionYear, v.requiredCredits]),
    [[2017, 2021, 38], [2022, 2024, 22], [2025, 2025, 24]]
  );
});

test('학과 개편 이력: 컴소공 → 공학3계열은 후손으로만 연결되고 형제(게임콘텐츠학과)는 섞이지 않는다', async () => {
  const chain = await history.getDepartmentChain(cseId);
  const [[eng3]] = await pool.query("SELECT id FROM departments WHERE name = '공학3계열'");
  const [[game]] = await pool.query("SELECT id FROM departments WHERE name = '게임콘텐츠학과'");
  assert.ok(chain.descendantIds.includes(eng3.id));
  assert.ok(!chain.departmentIds.includes(game.id));
});

test('과목 이력: 학수번호로 연도별 버전과 폐지(마지막으로 있던 학번)를 찾는다', async () => {
  const [h] = await history.findCourseHistory({ courseCode: '169041' });
  assert.equal(h.courseKey, 'C:169041');
  assert.deepEqual(h.versions.map((v) => v.minAdmissionYear).slice(-3), [2023, 2024, 2025]);
  assert.equal(h.removed, true);
  assert.equal(h.lastSeenYear, 2025);
});

test('과목 이력: 이름이 같아도 학수번호가 다른 과목은 키별로 따로 나온다(연도별 데이터가 섞이지 않음)', async () => {
  const list = await history.findCourseHistory({ courseName: '군대윤리' });
  assert.ok(list.length >= 2);
  assert.equal(new Set(list.map((x) => x.courseKey)).size, list.length);
});

test('변경 이력 조회: 과목의 필수→선택 변경을 시점과 함께 찾는다', async () => {
  const rows = await history.listChanges({ subjectType: 'COURSE', field: 'category', sinceYear: 2025, untilYear: 2025 });
  const converted = rows.find((c) => c.oldValue === '전공필수' && c.newValue === '전공선택');
  assert.ok(converted, '2024→2025에 전공필수→전공선택으로 바뀐 과목이 있어야 함');
  assert.equal(converted.fromYear, 2024);
  assert.equal(converted.toYear, 2025);
});
