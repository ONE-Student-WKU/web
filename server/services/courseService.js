const pool = require('../db');

/**
 * server/services/courseService.js
 * 과목 카탈로그 / 내 수강·성적(student_courses) DB 접근 계층.
 */

const GRADE_POINT_MAP = {
  'A+': 4.5,
  A0: 4.0,
  'B+': 3.5,
  B0: 3.0,
  'C+': 2.5,
  C0: 2.0,
  'D+': 1.5,
  D0: 1.0,
  F: 0.0,
};

function numOrNull(v) {
  return v === null || v === undefined ? null : Number(v);
}

async function searchCatalog(keyword) {
  const like = `%${keyword || ''}%`;
  const [courses] = await pool.query(
    'SELECT id, name, section, professor, credits, category FROM courses WHERE name LIKE ? ORDER BY name, section',
    [like]
  );
  if (courses.length === 0) return [];

  const courseIds = courses.map((c) => c.id);
  const [schedules] = await pool.query(
    `SELECT course_id, day, period FROM course_schedules
     WHERE course_id IN (?)
     ORDER BY course_id, FIELD(day, '월', '화', '수', '목', '금'), period`,
    [courseIds]
  );

  const scheduleMap = new Map();
  for (const s of schedules) {
    if (!scheduleMap.has(s.course_id)) scheduleMap.set(s.course_id, []);
    scheduleMap.get(s.course_id).push({ day: s.day, period: s.period });
  }

  return courses.map((c) => ({
    courseId: c.id,
    name: c.name,
    section: c.section,
    professor: c.professor,
    credits: Number(c.credits),
    category: c.category,
    schedule: scheduleMap.get(c.id) || [],
  }));
}

async function findCourseById(courseId) {
  const [rows] = await pool.query('SELECT id, name, credits, category FROM courses WHERE id = ?', [courseId]);
  return rows[0] || null;
}

function mapMyCourseRow(row) {
  return {
    id: row.id,
    courseId: row.course_id,
    name: row.name,
    professor: row.professor,
    credits: Number(row.credits),
    category: row.category,
    year: row.year,
    semester: row.semester,
    midterm: numOrNull(row.midterm),
    final: numOrNull(row.final),
    attendanceScore: numOrNull(row.attendance_score),
    assignment: numOrNull(row.assignment),
    etc: numOrNull(row.etc),
    letterGrade: row.letter_grade,
  };
}

async function listMyCourses(studentId, { year, semester }) {
  // course_id가 NULL인 교양 자유입력 과목도 나와야 하므로 LEFT JOIN.
  // name/credits/category는 student_courses에 항상 있으므로 그쪽을 기준으로 하고,
  // professor는 카탈로그에 연결된 경우에만 채워짐.
  let sql = `
    SELECT sc.id, sc.course_id, sc.name, sc.credits, sc.category, c.professor, sc.year, sc.semester,
           sc.midterm, sc.final, sc.attendance_score, sc.assignment, sc.etc, sc.letter_grade
    FROM student_courses sc
    LEFT JOIN courses c ON c.id = sc.course_id
    WHERE sc.student_id = ?`;
  const params = [studentId];

  if (year) {
    sql += ' AND sc.year = ?';
    params.push(year);
  }
  if (semester) {
    sql += ' AND sc.semester = ?';
    params.push(semester);
  }
  sql += ' ORDER BY sc.year DESC, sc.semester DESC, sc.id';

  const [rows] = await pool.query(sql, params);
  return rows.map(mapMyCourseRow);
}

// 전공: courseId만 넘어오면 카탈로그 값(name/credits/category)을 그대로 복사해 저장(스냅샷).
// 교양/직접입력: courseId 없이 name/credits/category를 그대로 사용.
async function addMyCourse(studentId, { courseId, name, credits, category, year, semester }) {
  let row = { course_id: null, name, credits, category };

  if (courseId) {
    const course = await findCourseById(courseId);
    if (!course) throw new Error('COURSE_NOT_FOUND');
    row = { course_id: courseId, name: course.name, credits: course.credits, category: course.category };
  }

  const [result] = await pool.query(
    'INSERT INTO student_courses (student_id, course_id, name, credits, category, year, semester) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [studentId, row.course_id, row.name, row.credits, row.category, year, semester]
  );
  return result.insertId;
}

async function findMyCourseById(studentId, id) {
  const [rows] = await pool.query('SELECT * FROM student_courses WHERE id = ? AND student_id = ?', [id, studentId]);
  return rows[0] || null;
}

async function updateMyCourse(id, updates) {
  const columnMap = {
    midterm: 'midterm',
    final: 'final',
    attendanceScore: 'attendance_score',
    assignment: 'assignment',
    etc: 'etc',
  };

  const fields = [];
  const params = [];

  for (const [key, column] of Object.entries(columnMap)) {
    if (updates[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(updates[key]);
    }
  }

  if (updates.letterGrade !== undefined) {
    fields.push('letter_grade = ?', 'gpa = ?');
    params.push(updates.letterGrade, GRADE_POINT_MAP[updates.letterGrade]);
  }

  if (fields.length === 0) return;

  params.push(id);
  await pool.query(`UPDATE student_courses SET ${fields.join(', ')} WHERE id = ?`, params);
}

async function deleteMyCourse(id) {
  await pool.query('DELETE FROM student_courses WHERE id = ?', [id]);
}

async function getTimetable(studentId, { year, semester }) {
  // 시간표는 course_schedules(카탈로그 분반 시간)가 있어야 나오므로, course_id가 없는
  // 교양 자유입력 과목은 시간표에 표시되지 않음(시간 정보 자체가 없으므로 정상 동작).
  const [rows] = await pool.query(
    `SELECT cs.day, cs.period, sc.course_id, sc.name
     FROM student_courses sc
     JOIN course_schedules cs ON cs.course_id = sc.course_id
     WHERE sc.student_id = ? AND sc.year = ? AND sc.semester = ?
     ORDER BY FIELD(cs.day, '월', '화', '수', '목', '금'), cs.period`,
    [studentId, year, semester]
  );

  return rows.map((r) => ({ day: r.day, period: r.period, courseId: r.course_id, name: r.name }));
}

async function getSummary(studentId) {
  // credits가 이제 student_courses 자체에 저장돼 있으므로 courses JOIN이 필요 없음.
  const [rows] = await pool.query(
    `SELECT sc.year, sc.semester, sc.credits, sc.gpa, sc.letter_grade
     FROM student_courses sc
     WHERE sc.student_id = ? AND sc.letter_grade IS NOT NULL`,
    [studentId]
  );

  const bySemesterMap = new Map();
  let totalCredits = 0;
  let totalPoints = 0;
  let totalGpaCredits = 0;

  for (const row of rows) {
    const key = `${row.year}-${row.semester}`;
    if (!bySemesterMap.has(key)) {
      bySemesterMap.set(key, { year: row.year, semester: row.semester, earnedCredits: 0, gpaCredits: 0, points: 0 });
    }
    const bucket = bySemesterMap.get(key);
    const credits = Number(row.credits);
    const gpaPoint = Number(row.gpa);

    // F는 GPA 계산에는 포함되지만 취득학점(earnedCredits)에는 포함하지 않음 (표준 학점 계산 관행)
    bucket.gpaCredits += credits;
    bucket.points += credits * gpaPoint;
    totalGpaCredits += credits;
    totalPoints += credits * gpaPoint;

    if (row.letter_grade !== 'F') {
      bucket.earnedCredits += credits;
      totalCredits += credits;
    }
  }

  const bySemester = Array.from(bySemesterMap.values())
    .sort((a, b) => a.year - b.year || a.semester - b.semester)
    .map((b) => ({
      year: b.year,
      semester: b.semester,
      earnedCredits: b.earnedCredits,
      gpa: b.gpaCredits > 0 ? Number((b.points / b.gpaCredits).toFixed(2)) : 0,
    }));

  return {
    bySemester,
    total: {
      earnedCredits: totalCredits,
      gpa: totalGpaCredits > 0 ? Number((totalPoints / totalGpaCredits).toFixed(2)) : 0,
    },
  };
}

module.exports = {
  GRADE_POINT_MAP,
  searchCatalog,
  findCourseById,
  listMyCourses,
  addMyCourse,
  findMyCourseById,
  updateMyCourse,
  deleteMyCourse,
  getTimetable,
  getSummary,
};
