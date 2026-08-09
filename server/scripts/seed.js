const path = require('path');
// server/scripts에서 실행돼도 항상 리포지토리 루트의 .env를 찾도록 절대경로로 지정.
// (npm workspace로 실행하면 cwd가 server/가 되어 기본 dotenv 탐색이 .env를 못 찾는 문제 방지)
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const bcrypt = require('bcryptjs');
const pool = require('../db');

const courses = require('../../db/seed/courses.json');
const courseSchedules = require('../../db/seed/course_schedules.json');
const students = require('../../db/seed/students.json');
const studentCourses = require('../../db/seed/student_courses.json');

const BCRYPT_ROUNDS = 10;

async function seedCourses() {
  for (const c of courses) {
    await pool.query(
      'INSERT IGNORE INTO courses (id, name, professor, credits, category) VALUES (?, ?, ?, ?, ?)',
      [c.id, c.name, c.professor ?? null, c.credits, c.category ?? null]
    );
  }
  console.log(`courses: ${courses.length}건 처리`);
}

async function seedCourseSchedules() {
  for (const s of courseSchedules) {
    await pool.query(
      'INSERT IGNORE INTO course_schedules (course_id, day, period) VALUES (?, ?, ?)',
      [s.course_id, s.day, s.period]
    );
  }
  console.log(`course_schedules: ${courseSchedules.length}건 처리`);
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

async function seedStudentCourses() {
  for (const sc of studentCourses) {
    const [rows] = await pool.query('SELECT id FROM students WHERE email = ?', [sc.student_email]);
    if (rows.length === 0) {
      console.warn(`[SKIP] student_courses: 학생을 찾을 수 없음 (${sc.student_email})`);
      continue;
    }
    const studentId = rows[0].id;

    await pool.query(
      `INSERT IGNORE INTO student_courses
        (student_id, course_id, year, semester, midterm, final, attendance_score, assignment, etc, gpa, letter_grade)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        studentId,
        sc.course_id,
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

async function run() {
  try {
    // FK 의존 순서: courses → course_schedules, students → student_courses
    await seedCourses();
    await seedCourseSchedules();
    await seedStudents();
    await seedStudentCourses();
    console.log('시딩 완료');
  } catch (err) {
    console.error('시딩 실패:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
