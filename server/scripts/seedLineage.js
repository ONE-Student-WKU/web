const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const pool = require('../db');
const departmentLineage = require('../../db/seed/department_lineage.json');
const courseLineage = require('../../db/seed/course_lineage.json');

/**
 * server/scripts/seedLineage.js
 * db/seed/department_lineage.json(학과 개편 간선)과 db/seed/course_lineage.json(사람이 확인해 넣은 과목 계보)을
 * department_lineage / course_lineage 테이블에 시딩한다. 근거: db/schema.sql 6.55절.
 *
 * departments/tracks가 먼저 시딩돼 있어야 한다(seed.js, seed:curriculum-*). 학과·세부전공은 이름으로 찾는다.
 * department_lineage는 이 JSON이 유일한 원천이라 통째로 지우고 다시 넣고,
 * course_lineage는 사람이 넣은 행(source=MANUAL)만 지우고 다시 넣는다 — 자동 감지한 행(source=AUTO)은
 * generateCurriculumChanges.js가 관리한다.
 */

async function findDepartmentId(name) {
  const [rows] = await pool.query('SELECT id FROM departments WHERE name = ?', [name]);
  return rows[0]?.id || null;
}

async function findTrackId(departmentId, name) {
  if (!name) return null;
  const [rows] = await pool.query('SELECT id FROM tracks WHERE department_id = ? AND name = ?', [departmentId, name]);
  return rows[0]?.id || null;
}

// 학과/세부전공 이름 한 쌍을 id로 바꾼다. 이름이 있는데 못 찾으면 { error } — 조용히 NULL(신설·폐지)로 취급하면 안 된다.
async function resolveUnit(departmentName, trackName, label) {
  if (!departmentName) return { departmentId: null, trackId: null };
  const departmentId = await findDepartmentId(departmentName);
  if (!departmentId) return { error: `${label} 학과를 찾을 수 없음 (${departmentName})` };
  const trackId = await findTrackId(departmentId, trackName);
  if (trackName && !trackId) return { error: `${label} 세부전공을 찾을 수 없음 (${departmentName}/${trackName})` };
  return { departmentId, trackId };
}

async function seedDepartmentLineage() {
  await pool.query('DELETE FROM department_lineage');

  let inserted = 0;
  for (const edge of departmentLineage) {
    const from = await resolveUnit(edge.fromDepartment, edge.fromTrack, 'from');
    const to = await resolveUnit(edge.toDepartment, edge.toTrack, 'to');
    const error = from.error || to.error;
    if (error) {
      console.warn(`[SKIP] department_lineage ${edge.fromDepartment}/${edge.fromTrack ?? ''} → ${edge.toDepartment}/${edge.toTrack ?? ''}: ${error}`);
      continue;
    }
    await pool.query(
      `INSERT INTO department_lineage
        (from_department_id, from_track_id, to_department_id, to_track_id, relation, effective_year, source, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [from.departmentId, from.trackId, to.departmentId, to.trackId, edge.relation, edge.effectiveYear, edge.source, edge.note ?? null]
    );
    inserted++;
  }
  console.log(`department_lineage: ${inserted}/${departmentLineage.length}건 시딩`);
}

async function seedManualCourseLineage() {
  await pool.query("DELETE FROM course_lineage WHERE source = 'MANUAL'");

  let inserted = 0;
  for (const row of courseLineage) {
    const departmentId = row.department ? await findDepartmentId(row.department) : null;
    if (row.department && !departmentId) {
      console.warn(`[SKIP] course_lineage ${row.fromCourseKey} → ${row.toCourseKey}: 학과를 찾을 수 없음 (${row.department})`);
      continue;
    }
    await pool.query(
      `INSERT INTO course_lineage
        (from_course_key, to_course_key, from_name, to_name, department_id, relation, effective_year, source, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?)`,
      [row.fromCourseKey ?? null, row.toCourseKey ?? null, row.fromName ?? null, row.toName ?? null, departmentId, row.relation, row.effectiveYear, row.note ?? null]
    );
    inserted++;
  }
  console.log(`course_lineage(MANUAL): ${inserted}/${courseLineage.length}건 시딩`);
}

async function run() {
  try {
    await seedDepartmentLineage();
    await seedManualCourseLineage();
  } catch (err) {
    console.error('시딩 실패:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
