const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const pool = require('../db');
const linkedMajors = require('../../db/seed/linked_majors.json');
const microDegrees = require('../../db/seed/micro_degrees.json');

/**
 * server/scripts/seedLinkedMajorsAndMicroDegrees.js
 * db/seed/linked_majors.json / micro_degrees.json(2025_교육과정.pdf Ⅴ~Ⅵ, Ⅷ~Ⅸ장에서
 * pdfplumber로 추출)을 linked_majors/linked_major_courses, micro_degrees/micro_degree_courses에
 * 적재한다. 두 프로그램 다 department_id에 안 묶이는 부가 전공이라(어떤 학과 학생이든
 * 복수전공/부전공/그 자체로 추가 이수 가능) 독립 테이블에 이름 기준으로 시딩한다.
 *
 * 이름 기준으로 기존 행을 지우고 다시 넣는 방식(INSERT IGNORE 대신)이라 재실행해도 안전하다.
 */

async function seedLinkedMajors() {
  let total = 0;
  for (const major of linkedMajors) {
    const [existing] = await pool.query('SELECT id FROM linked_majors WHERE name = ?', [major.name]);
    if (existing.length > 0) {
      await pool.query('DELETE FROM linked_majors WHERE id = ?', [existing[0].id]);
    }
    const [result] = await pool.query(
      `INSERT INTO linked_majors
        (name, program_group, required_credits, minor_required_credits, lead_professor, participating_departments)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        major.name,
        major.programGroup || null,
        major.requiredCredits ?? null,
        major.minorRequiredCredits ?? null,
        major.leadProfessor || null,
        major.participatingDepartments || null,
      ]
    );
    const linkedMajorId = result.insertId;
    for (const c of major.courses) {
      await pool.query(
        `INSERT INTO linked_major_courses
          (linked_major_id, semester, category, course_code, course_name, credits, offering_department)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [linkedMajorId, c.semester, c.category, c.courseCode, c.courseName, Number(c.credits) || null, c.offeringDepartment || null]
      );
      total += 1;
    }
  }
  console.log(`linked_majors: ${linkedMajors.length}개 프로그램, ${total}개 과목 시딩 완료`);
}

async function seedMicroDegrees() {
  let total = 0;
  for (const md of microDegrees) {
    const [existing] = await pool.query('SELECT id FROM micro_degrees WHERE name = ?', [md.name]);
    if (existing.length > 0) {
      await pool.query('DELETE FROM micro_degrees WHERE id = ?', [existing[0].id]);
    }
    const [result] = await pool.query(
      `INSERT INTO micro_degrees (name, program_group, required_credits, lead_professor)
       VALUES (?, ?, ?, ?)`,
      [md.name, md.programGroup || null, md.requiredCredits ?? null, md.leadProfessor || null]
    );
    const microDegreeId = result.insertId;
    for (const c of md.courses) {
      await pool.query(
        `INSERT INTO micro_degree_courses
          (micro_degree_id, semester, category, course_code, course_name, credits, offering_department)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [microDegreeId, c.semester, c.category, c.courseCode, c.courseName, Number(c.credits) || null, c.offeringDepartment || null]
      );
      total += 1;
    }
  }
  console.log(`micro_degrees: ${microDegrees.length}개 프로그램, ${total}개 과목 시딩 완료`);
}

async function run() {
  try {
    await seedLinkedMajors();
    await seedMicroDegrees();
  } catch (err) {
    console.error('시딩 실패:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
