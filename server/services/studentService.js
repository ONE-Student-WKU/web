const pool = require('../db');

/**
 * server/services/studentService.js
 * 학생 계정(인증/온보딩) 관련 DB 접근 계층.
 */

async function findByEmail(email) {
  const [rows] = await pool.query('SELECT * FROM students WHERE email = ?', [email]);
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT s.*, d.name AS department_name
     FROM students s
     LEFT JOIN departments d ON d.id = s.department_id
     WHERE s.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function createStudent({ email, passwordHash, name }) {
  const [result] = await pool.query(
    'INSERT INTO students (email, password, name) VALUES (?, ?, ?)',
    [email, passwordHash, name]
  );
  return result.insertId;
}

async function listDepartments() {
  const [rows] = await pool.query('SELECT id, name FROM departments ORDER BY id');
  return rows;
}

async function completeOnboarding(studentId, { departmentId, admissionYear, enrollmentType }) {
  await pool.query(
    `UPDATE students
     SET department_id = ?, admission_year = ?, enrollment_type = ?, onboarding_completed_at = NOW()
     WHERE id = ?`,
    [departmentId, admissionYear, enrollmentType, studentId]
  );
}

module.exports = {
  findByEmail,
  findById,
  createStudent,
  listDepartments,
  completeOnboarding,
};
