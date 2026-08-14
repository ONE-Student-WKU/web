const pool = require('../db');

/**
 * server/services/studentService.js
 * 학생 계정(인증/온보딩) 관련 DB 접근 계층.
 */

// onboarding.js / me.js에서 공통으로 쓰는 검증값 (courseService.VALID_CATEGORIES와 동일한 패턴)
const VALID_ENROLLMENT_TYPES = ['GENERAL', 'TRANSFER_ADMISSION', 'MAJOR_CHANGE'];
const VALID_MAJOR_CHANGE_GRADES = [1, 2, 3, 4];
const VALID_MAJOR_CHANGE_SEMESTERS = [1, 2];

async function findByEmail(email) {
  const [rows] = await pool.query('SELECT * FROM students WHERE email = ?', [email]);
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT s.*, d.name AS department_name, t.name AS track_name, sd.name AS second_department_name
     FROM students s
     LEFT JOIN departments d ON d.id = s.department_id
     LEFT JOIN tracks t ON t.id = s.track_id
     LEFT JOIN departments sd ON sd.id = s.second_department_id
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

async function findDepartmentById(id) {
  const [rows] = await pool.query('SELECT id, name FROM departments WHERE id = ?', [id]);
  return rows[0] || null;
}

// 광역단위 학과(공학3계열)만 결과가 있고, 그 외 학과는 빈 배열이 정상 응답.
async function listTracks(departmentId) {
  const [rows] = await pool.query('SELECT id, name FROM tracks WHERE department_id = ? ORDER BY id', [departmentId]);
  return rows;
}

async function findTrackById(id) {
  const [rows] = await pool.query('SELECT id, department_id, name FROM tracks WHERE id = ?', [id]);
  return rows[0] || null;
}

async function completeOnboarding(studentId, { departmentId, admissionYear, enrollmentType, trackId, majorChangeGrade, majorChangeYear, majorChangeSemester }) {
  await pool.query(
    `UPDATE students
     SET department_id = ?, admission_year = ?, enrollment_type = ?, track_id = ?, major_change_grade = ?,
         major_change_year = ?, major_change_semester = ?, onboarding_completed_at = NOW()
     WHERE id = ?`,
    [departmentId, admissionYear, enrollmentType, trackId ?? null, majorChangeGrade ?? null,
      majorChangeYear ?? null, majorChangeSemester ?? null, studentId]
  );
}

// 프로필 수정(PATCH /api/me) 전용 — 넘어온 필드만 부분 갱신 (courseService.updateMyCourse와 동일한 패턴)
async function updateProfile(studentId, updates) {
  const columnMap = {
    departmentId: 'department_id',
    trackId: 'track_id',
    admissionYear: 'admission_year',
    enrollmentType: 'enrollment_type',
    majorChangeGrade: 'major_change_grade',
    majorChangeYear: 'major_change_year',
    majorChangeSemester: 'major_change_semester',
    secondDepartmentId: 'second_department_id',
    careerCounselingCount: 'career_counseling_count',
  };

  const fields = [];
  const params = [];

  for (const [key, column] of Object.entries(columnMap)) {
    if (updates[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(updates[key]);
    }
  }

  if (fields.length === 0) return;

  params.push(studentId);
  await pool.query(`UPDATE students SET ${fields.join(', ')} WHERE id = ?`, params);
}

module.exports = {
  VALID_ENROLLMENT_TYPES,
  VALID_MAJOR_CHANGE_GRADES,
  VALID_MAJOR_CHANGE_SEMESTERS,
  findByEmail,
  findById,
  createStudent,
  listDepartments,
  findDepartmentById,
  listTracks,
  findTrackById,
  completeOnboarding,
  updateProfile,
};
