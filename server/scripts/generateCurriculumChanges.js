const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const pool = require('../db');
const { buildRuleKey, buildCourseKey } = require('../services/curriculumKeys');
const {
  computeRequirementChanges,
  computeCourseChanges,
  computeDepartmentChanges,
} = require('../services/curriculumChanges');

/**
 * server/scripts/generateCurriculumChanges.js
 * curriculum_requirements / curriculum_courses / department_lineage의 학년도별 스냅샷을 비교해서
 * curriculum_changes(변경 이력)와 course_lineage의 자동 감지 행(source=AUTO)을 다시 만든다.
 * 계산 규칙은 server/services/curriculumChanges.js, 테이블 설명은 db/schema.sql 6.55~6.56절.
 *
 * 선행 조건: seed(요건), seed:curriculum-*(과목), seedLineage(학과 개편 간선)를 먼저 실행.
 * 몇 번을 실행해도 같은 결과(AUTO 행만 지우고 다시 넣음). 새 학년도 시드를 추가한 뒤에 다시 실행하면 된다.
 */

// 학번 universe: 데이터에 실제로 나온 닫힌 학번 범위의 최솟값~최댓값. 새 학년도가 들어오면 자동으로 넓어진다.
async function loadUniverse() {
  const [[a]] = await pool.query(
    `SELECT MIN(y) AS min_year, MAX(y) AS max_year FROM (
       SELECT min_admission_year AS y FROM curriculum_requirements WHERE min_admission_year IS NOT NULL
       UNION ALL SELECT max_admission_year FROM curriculum_requirements WHERE max_admission_year IS NOT NULL
       UNION ALL SELECT min_admission_year FROM curriculum_courses WHERE min_admission_year IS NOT NULL
       UNION ALL SELECT max_admission_year FROM curriculum_courses WHERE max_admission_year IS NOT NULL
     ) t`
  );
  return { min: a.min_year, max: a.max_year };
}

async function loadNames() {
  const [depts] = await pool.query('SELECT id, name FROM departments');
  const [tracks] = await pool.query('SELECT id, name FROM tracks');
  return {
    departments: new Map(depts.map((d) => [d.id, d.name])),
    tracks: new Map(tracks.map((t) => [t.id, t.name])),
  };
}

async function loadRequirementRows(names) {
  const [rows] = await pool.query(
    `SELECT department_id, category, required_credits, min_admission_year, max_admission_year,
            enrollment_type, min_course_count, rule_key
     FROM curriculum_requirements`
  );
  return rows.map((r) => ({
    departmentId: r.department_id,
    departmentName: names.departments.get(r.department_id),
    category: r.category,
    requiredCredits: r.required_credits,
    minAdmissionYear: r.min_admission_year,
    maxAdmissionYear: r.max_admission_year,
    enrollmentType: r.enrollment_type,
    minCourseCount: r.min_course_count,
    ruleKey: r.rule_key || buildRuleKey(names.departments.get(r.department_id), r.category, r.enrollment_type),
  }));
}

async function loadCourseRows() {
  const [rows] = await pool.query(
    `SELECT department_id, track_id, min_admission_year, max_admission_year, grade, semester,
            category, course_code, course_name, credits, course_key
     FROM curriculum_courses`
  );
  return rows.map((r) => ({
    departmentId: r.department_id,
    trackId: r.track_id,
    minAdmissionYear: r.min_admission_year,
    maxAdmissionYear: r.max_admission_year,
    grade: r.grade,
    semester: r.semester,
    category: r.category,
    courseCode: r.course_code,
    courseName: r.course_name,
    credits: r.credits,
    courseKey: r.course_key || buildCourseKey(r.course_code, r.course_name),
  }));
}

async function loadEdges() {
  const [rows] = await pool.query(
    `SELECT from_department_id, from_track_id, to_department_id, to_track_id, relation, effective_year, source, note
     FROM department_lineage`
  );
  return rows.map((r) => ({
    fromDepartmentId: r.from_department_id,
    fromTrackId: r.from_track_id,
    toDepartmentId: r.to_department_id,
    toTrackId: r.to_track_id,
    relation: r.relation,
    effectiveYear: r.effective_year,
    source: r.source,
    note: r.note,
  }));
}

async function insertChanges(changes) {
  const CHUNK = 500;
  for (let i = 0; i < changes.length; i += CHUNK) {
    const part = changes.slice(i, i + CHUNK);
    await pool.query(
      `INSERT INTO curriculum_changes
        (subject_type, subject_key, display_name, department_id, track_id, successor_department_id, successor_track_id,
         from_year, to_year, field, change_type, old_value, new_value, note, source)
       VALUES ?`,
      [
        part.map((c) => [
          c.subjectType, c.subjectKey, c.displayName ? String(c.displayName).slice(0, 150) : null,
          c.departmentId, c.trackId, c.successorDepartmentId, c.successorTrackId,
          c.fromYear, c.toYear, c.field, c.changeType,
          c.oldValue == null ? null : String(c.oldValue).slice(0, 255),
          c.newValue == null ? null : String(c.newValue).slice(0, 255),
          c.note ? String(c.note).slice(0, 255) : null, c.source,
        ]),
      ]
    );
  }
}

async function insertCourseLineage(rows) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    await pool.query(
      `INSERT INTO course_lineage
        (from_course_key, to_course_key, from_name, to_name, department_id, relation, effective_year, source, note)
       VALUES ?`,
      [part.map((l) => [l.fromCourseKey, l.toCourseKey, l.fromName, l.toName, l.departmentId, l.relation, l.effectiveYear, l.source, l.note])]
    );
  }
}

async function run() {
  try {
    const universe = await loadUniverse();
    if (universe.min == null) throw new Error('curriculum_requirements/curriculum_courses에 학번 범위가 있는 행이 없음');
    const names = await loadNames();
    const [requirementRows, courseRows, edges] = await Promise.all([loadRequirementRows(names), loadCourseRows(), loadEdges()]);

    const requirementChanges = computeRequirementChanges({ rows: requirementRows, edges, universe });
    const { changes: courseChanges, courseLineage } = computeCourseChanges({ rows: courseRows, edges, universe, names });
    const departmentChanges = computeDepartmentChanges({ edges, names });

    const all = [...departmentChanges, ...requirementChanges, ...courseChanges];
    await pool.query("DELETE FROM curriculum_changes WHERE source = 'AUTO'");
    await insertChanges(all);
    await pool.query("DELETE FROM course_lineage WHERE source = 'AUTO'");
    await insertCourseLineage(courseLineage);

    const count = (type) => all.filter((c) => c.subjectType === type).length;
    console.log(`학번 범위 ${universe.min}~${universe.max}, lineage 간선 ${edges.length}건`);
    console.log(`curriculum_changes(AUTO): 학과 개편 ${count('DEPARTMENT')} / 요건 ${count('REQUIREMENT')} / 과목 ${count('COURSE')} = ${all.length}건`);
    console.log(`course_lineage(AUTO, 학수번호 변경): ${courseLineage.length}건`);
  } catch (err) {
    console.error('생성 실패:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
