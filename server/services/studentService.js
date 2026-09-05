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

// 클라이언트에 내려주는 학생 프로필 형태로 변환 — /api/auth/login과 /api/me가 같은
// 모양의 데이터를 줘야 한다(로그인 응답에 departmentId/admissionYear 등이 빠져있으면,
// 그 값을 그대로 믿는 화면(Onboarding.jsx 등)이 이미 등록된 정보를 "선택 필요"로 잘못
// 표시하는 문제가 실사용으로 확인됨 — 로그인 직후 재진입 시 재현).
function serializeStudent(student) {
  return {
    id: student.id,
    name: student.name,
    department: student.department_name,
    departmentId: student.department_id,
    track: student.track_name,
    trackId: student.track_id,
    onboardingCompleted: !!student.onboarding_completed_at,
    admissionYear: student.admission_year,
    enrollmentType: student.enrollment_type,
    majorChangeGrade: student.major_change_grade,
    majorChangeYear: student.major_change_year,
    majorChangeSemester: student.major_change_semester,
    secondDepartment: student.second_department_name,
    secondDepartmentId: student.second_department_id,
    careerCounselingCount: student.career_counseling_count,
    leaveSemesters: student.leave_semesters,
  };
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

// 온보딩 화면이 학과별로 실제 입력 가능한 학번 범위를 알아야 해서(예: 컴퓨터·소프트웨어공학과는
// 2017~2025학번만, 공학3계열은 2026학번부터), curriculum_requirements의 공통 요건
// (enrollment_type IS NULL — 전과/편입 특례 행은 학과의 "기본 학번 범위"가 아니므로 제외) 행에서
// 학번 범위를 집계해 함께 내려준다. 프론트에 학번 범위를 하드코딩하지 않기 위함.
async function listDepartments() {
  const [rows] = await pool.query(
    `SELECT d.id, d.name,
            MIN(cr.min_admission_year) AS min_admission_year,
            MAX(cr.max_admission_year) AS max_admission_year
     FROM departments d
     LEFT JOIN curriculum_requirements cr ON cr.department_id = d.id AND cr.enrollment_type IS NULL
     GROUP BY d.id, d.name
     ORDER BY d.id`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    minAdmissionYear: r.min_admission_year,
    maxAdmissionYear: r.max_admission_year,
  }));
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
    name: 'name',
    departmentId: 'department_id',
    trackId: 'track_id',
    admissionYear: 'admission_year',
    enrollmentType: 'enrollment_type',
    majorChangeGrade: 'major_change_grade',
    majorChangeYear: 'major_change_year',
    majorChangeSemester: 'major_change_semester',
    secondDepartmentId: 'second_department_id',
    careerCounselingCount: 'career_counseling_count',
    leaveSemesters: 'leave_semesters',
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

async function updatePassword(studentId, passwordHash) {
  await pool.query('UPDATE students SET password = ? WHERE id = ?', [passwordHash, studentId]);
}

// 계정 삭제 — students.id를 참조하는 student_courses/chat_conversations는 스키마에
// ON DELETE CASCADE로 걸려있어(db/schema.sql) 별도 정리 없이 이 한 줄로 연쇄 삭제된다.
async function deleteStudent(studentId) {
  await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
}

module.exports = {
  VALID_ENROLLMENT_TYPES,
  VALID_MAJOR_CHANGE_GRADES,
  VALID_MAJOR_CHANGE_SEMESTERS,
  serializeStudent,
  findByEmail,
  findById,
  createStudent,
  listDepartments,
  findDepartmentById,
  listTracks,
  findTrackById,
  completeOnboarding,
  updateProfile,
  updatePassword,
  deleteStudent,
};
