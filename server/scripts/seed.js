const path = require('path');
// server/scripts에서 실행돼도 항상 리포지토리 루트의 .env를 찾도록 절대경로로 지정.
// (npm workspace로 실행하면 cwd가 server/가 되어 기본 dotenv 탐색이 .env를 못 찾는 문제 방지)
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const bcrypt = require('bcryptjs');
const pool = require('../db');

const departments = require('../../db/seed/departments.json');
const students = require('../../db/seed/students.json');
const studentCourses = require('../../db/seed/student_courses.json');
const curriculumRequirements = require('../../db/seed/curriculum_requirements.json');

const BCRYPT_ROUNDS = 10;

// student_courses.json의 course_id는 학수번호-분반 형태의 옛 표기("374124-01")로 남아있음 —
// course_offerings 조회 시 학수번호(course_code)/분반(section)으로 쪼개 쓴다.
function splitOldId(oldId) {
  const idx = oldId.lastIndexOf('-');
  return idx === -1 ? { code: oldId, section: null } : { code: oldId.slice(0, idx), section: oldId.slice(idx + 1) };
}

// departments/tracks는 curriculum_requirements/curriculum_courses의 FK 전제조건이라
// 그 둘보다 먼저 시딩한다. name이 자연키라 INSERT IGNORE로 충분히 idempotent함.
async function seedDepartments() {
  for (const dept of departments) {
    await pool.query('INSERT IGNORE INTO departments (name) VALUES (?)', [dept.name]);
    const [rows] = await pool.query('SELECT id FROM departments WHERE name = ?', [dept.name]);
    const departmentId = rows[0].id;

    for (const trackName of dept.tracks || []) {
      await pool.query('INSERT IGNORE INTO tracks (department_id, name) VALUES (?, ?)', [departmentId, trackName]);
    }
  }
  console.log(`departments: ${departments.length}건 처리`);
}

async function seedStudents() {
  for (const s of students) {
    const hashedPassword = await bcrypt.hash(s.password, BCRYPT_ROUNDS);
    await pool.query(
      `INSERT IGNORE INTO students
        (email, password, name, department_id, admission_year, enrollment_type, onboarding_completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        s.email,
        hashedPassword,
        s.name,
        s.department_id ?? null,
        s.admission_year ?? null,
        s.enrollment_type ?? null,
        s.onboarding_completed_at ?? null,
      ]
    );
  }
  console.log(`students: ${students.length}건 처리`);
}

// course_offerings가 먼저 시딩되어 있어야 함 (npm run seed:course-offerings).
async function seedStudentCourses() {
  // 시드 데이터의 student_courses는 전부 카탈로그 과목(course_id)을 참조하는 케이스만
  // 있음 — name/credits/category는 course_offerings에서 그대로 복사해 넣는다(런타임의
  // addMyCourse와 동일한 스냅샷 방식). 교양 자유입력 시드가 필요해지면 studentCourses
  // 항목에 course_id 대신 name/credits/category를 직접 넣는 케이스를 추가하면 됨.
  for (const sc of studentCourses) {
    const [rows] = await pool.query('SELECT id FROM students WHERE email = ?', [sc.student_email]);
    if (rows.length === 0) {
      console.warn(`[SKIP] student_courses: 학생을 찾을 수 없음 (${sc.student_email})`);
      continue;
    }
    const studentId = rows[0].id;

    const { code, section } = splitOldId(sc.course_id);
    const [offeringRows] = await pool.query(
      'SELECT id, course_name, credits, category FROM course_offerings WHERE course_code = ? AND section <=> ? AND year = ? AND semester = ? LIMIT 1',
      [code, section, sc.year, sc.semester]
    );
    if (offeringRows.length === 0) {
      console.warn(`[SKIP] student_courses: 개설 정보를 찾을 수 없음 (${sc.course_id}, ${sc.year}-${sc.semester})`);
      continue;
    }
    const offering = offeringRows[0];

    await pool.query(
      `INSERT IGNORE INTO student_courses
        (student_id, course_id, name, credits, category, year, semester,
         midterm, final, attendance_score, assignment, etc, gpa, letter_grade)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        studentId,
        offering.id,
        offering.course_name,
        offering.credits,
        offering.category ?? null,
        sc.year,
        sc.semester,
        sc.midterm ?? null,
        sc.final ?? null,
        sc.attendance_score ?? null,
        sc.assignment ?? null,
        sc.etc ?? null,
        sc.gpa ?? null,
        sc.letter_grade ?? null,
      ]
    );
  }
  console.log(`student_courses: ${studentCourses.length}건 처리`);
}

// curriculum_requirements/curriculum_required_courses는 학생이 API로 건드릴 일이 없는 참조 데이터라서,
// (name, section)처럼 자연키를 잡아 INSERT IGNORE하는 대신 시딩 대상 학과 것만 지우고 다시 넣는
// 방식으로 idempotent하게 만든다. min_admission_year/enrollment_type처럼 NULL 허용 컬럼이 섞여 있어
// UNIQUE 제약을 걸어도 MySQL은 NULL끼리 같은 값으로 안 봐서 INSERT IGNORE로는 중복을 못 거른다.
async function seedCurriculumRequirements() {
  const departmentNames = [...new Set(curriculumRequirements.map((r) => r.departmentName))];
  const deptIdByName = new Map();

  for (const name of departmentNames) {
    const [rows] = await pool.query('SELECT id FROM departments WHERE name = ?', [name]);
    if (rows.length === 0) {
      console.warn(`[SKIP] curriculum_requirements: 학과를 찾을 수 없음 (${name})`);
      continue;
    }
    deptIdByName.set(name, rows[0].id);
    // curriculum_required_courses는 FK ON DELETE CASCADE라 같이 정리됨
    await pool.query('DELETE FROM curriculum_requirements WHERE department_id = ?', [rows[0].id]);
  }

  for (const req of curriculumRequirements) {
    const departmentId = deptIdByName.get(req.departmentName);
    if (!departmentId) continue; // 위에서 이미 경고 출력함

    const [result] = await pool.query(
      `INSERT INTO curriculum_requirements
        (department_id, category, required_credits, description, min_admission_year, max_admission_year, enrollment_type, min_course_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        departmentId,
        req.category,
        req.requiredCredits,
        req.description ?? null,
        req.minAdmissionYear ?? null,
        req.maxAdmissionYear ?? null,
        req.enrollmentType ?? null,
        req.minCourseCount ?? null,
      ]
    );

    for (const courseName of req.requiredCourses || []) {
      await pool.query(
        'INSERT INTO curriculum_required_courses (requirement_id, course_name) VALUES (?, ?)',
        [result.insertId, courseName]
      );
    }
  }
  console.log(`curriculum_requirements: ${curriculumRequirements.length}건 처리`);
}

async function run() {
  try {
    // FK 의존 순서: departments/tracks → students/curriculum_requirements/student_courses.
    // course_offerings는 이 스크립트가 아니라 npm run seed:course-offerings로 별도 시딩한다
    // (seedCurriculum.js/seedRegulations.js와 같은 패턴 — 원본이 db/curriculum/_source의
    // 대용량 스크래핑 JSON이라 매번 이 스크립트에 묶어 돌릴 이유가 없음). student_courses가
    // course_offerings를 참조하므로 seed:course-offerings를 먼저 실행해야 함.
    await seedDepartments();
    await seedStudents();
    await seedStudentCourses();
    await seedCurriculumRequirements();
    console.log('시딩 완료');
  } catch (err) {
    console.error('시딩 실패:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// seedStudents/seedStudentCourses(가짜 계정 생성)는 제외하고 두 함수만 노출 —
// 운영 자동화 파이프라인이 이 모듈을 require해도 가짜 계정이 생성될 경로가 없다.
module.exports = { seedDepartments, seedCurriculumRequirements };

if (require.main === module) {
  run();
}
