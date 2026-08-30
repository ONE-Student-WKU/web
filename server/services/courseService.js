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

// courses.category / student_courses.category ENUM과 동일 — DB ENUM 에러를 그대로
// 흘려보내지 않고 서버에서 먼저 검증하기 위함 (letterGrade와 동일한 패턴).
const VALID_CATEGORIES = ['전공필수', '전공선택', '교양필수', '교양선택', '일반선택'];

// GRADE_POINT_MAP의 9종 + P(Pass)/NP(Not Pass) — 둘 다 "전체성적조회" PDF의 P/F 채점
// 과목(원어민영어인증, 오리엔테이션성 교양 등)에서만 나오는 값이라 GRADE_POINT_MAP엔 없다
// (평점 자체가 없는 채점 방식이므로 GRADE_POINT_MAP[grade]가 항상 undefined → gpa는 NULL로
// 남는다). PATCH(과목 관리 화면 수동 수정)와 import 양쪽에서 공통으로 이 목록으로 검증한다.
const LETTER_GRADES = [...Object.keys(GRADE_POINT_MAP), 'P', 'NP'];

// 이수학점(졸업요건 포함)에서 제외되는 등급 — "불합격"을 의미하는 두 가지: 일반 등급의 F,
// P/F 채점 과목의 NP. graduationService.js의 이수학점 집계도 이 목록과 동일한 규칙을 쓴다.
const FAILING_GRADES = ['F', 'NP'];

function numOrNull(v) {
  return v === null || v === undefined ? null : Number(v);
}

// year/semester로 카탈로그를 학기별로 좁힌다 — 예전엔 courses가 "지금 학기" 단일
// 스냅샷이라 과거/미래 학기 검색이 아예 막혀있었는데(CourseManagement.jsx의 isCurrentTerm
// 게이트), course_offerings가 학기별 실제 개설 정보를 갖고 있어 그 제한을 없앨 수 있다.
async function searchCatalog(keyword, year, semester) {
  const like = `%${keyword || ''}%`;
  const [courses] = await pool.query(
    `SELECT id, course_name AS name, section, professor, credits, category
     FROM course_offerings
     WHERE course_name LIKE ? AND year = ? AND semester = ?
     ORDER BY course_name, section`,
    [like, year, semester]
  );
  if (courses.length === 0) return [];

  const courseIds = courses.map((c) => c.id);
  const [schedules] = await pool.query(
    `SELECT offering_id AS course_id, day, period FROM course_offering_schedules
     WHERE offering_id IN (?)
     ORDER BY offering_id, FIELD(day, '월', '화', '수', '목', '금'), period`,
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
  const [rows] = await pool.query(
    'SELECT id, course_name AS name, credits, category FROM course_offerings WHERE id = ?',
    [courseId]
  );
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
    LEFT JOIN course_offerings c ON c.id = sc.course_id
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
//
// schedule(선택, [{day,period}])은 course_id가 없는(직접입력) 경우에만 의미가 있다 —
// 카탈로그 과목이 course_schedules에 이미 확정된 시간이 있으면 그걸 그대로 쓰고 사용자
// 입력은 무시한다(시간표에 중복/충돌 표시가 생기지 않도록). 다만 저학년 필수과목처럼
// 교수/시간을 확보 못 해 이름만 카탈로그에 올라간 과목은 course_schedules가 비어있으므로,
// 그 경우엔 직접입력 과목과 동일하게 사용자가 입력한 시간표를 받아준다.
async function addMyCourse(studentId, { courseId, name, credits, category, year, semester, schedule }) {
  let row = { course_id: null, name, credits, category };
  let hasOfficialSchedule = false;

  if (courseId) {
    const course = await findCourseById(courseId);
    if (!course) throw new Error('COURSE_NOT_FOUND');
    row = { course_id: courseId, name: course.name, credits: course.credits, category: course.category };

    const [scheduleRows] = await pool.query('SELECT 1 FROM course_offering_schedules WHERE offering_id = ? LIMIT 1', [
      courseId,
    ]);
    hasOfficialSchedule = scheduleRows.length > 0;
  }

  const scheduleToInsert = !hasOfficialSchedule && Array.isArray(schedule) ? schedule : [];

  // 이미 그 학기에 등록된 다른 과목과 요일/교시가 겹치면 시간표 칸이 한쪽만 보이게 되어
  // "추가했는데 사라진 것처럼" 보이는 문제가 있었다 — 등록 자체를 막고 어느 과목과
  // 겹치는지 알려준다.
  if (scheduleToInsert.length > 0) {
    const existing = await getTimetable(studentId, { year, semester });
    for (const s of scheduleToInsert) {
      const conflict = existing.find((e) => e.day === s.day && e.period === s.period);
      if (conflict) {
        const err = new Error('SCHEDULE_CONFLICT');
        err.code = 'SCHEDULE_CONFLICT';
        err.conflictDay = s.day;
        err.conflictPeriod = s.period;
        err.conflictCourseName = conflict.name;
        throw err;
      }
    }
  }

  const [result] = await pool.query(
    'INSERT INTO student_courses (student_id, course_id, name, credits, category, year, semester) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [studentId, row.course_id, row.name, row.credits, row.category, year, semester]
  );

  if (scheduleToInsert.length > 0) {
    for (const s of scheduleToInsert) {
      await pool.query(
        'INSERT INTO student_course_schedules (student_course_id, day, period) VALUES (?, ?, ?)',
        [result.insertId, s.day, s.period]
      );
    }
  }

  return result.insertId;
}

// PDF 가져오기 전용 — course_id/schedule 없이 name/credits/category만 받는 직접입력과
// 동일한 경로. row.letterGrade는 선택 입력: "이수과목확인리스트"는 등급이 없는 문서라
// 항상 undefined/null로 들어오고(letter_grade는 NULL로 남아 과목 관리 화면에서 직접
// 입력), "전체성적조회"는 파싱된 등급을 그대로 넘겨준다.
// 이미 등록된(name+year+semester 동일) 과목은 새로 삽입하지 않는다 — 다만 기존 행에
// 등급이 아직 없고 이번에 등급이 들어왔다면(전체성적조회로 뒤늦게 등급만 채우는 흔한
// 케이스) 그 등급만 채워준다. 이미 등급이 있는 행은 사용자가 직접 입력했을 수 있어
// 덮어쓰지 않고 건너뛴다.
async function bulkAddMyCourses(studentId, rows) {
  const [existingRows] = await pool.query(
    'SELECT id, name, year, semester, letter_grade FROM student_courses WHERE student_id = ?',
    [studentId]
  );
  const existingMap = new Map(existingRows.map((r) => [`${r.name}__${r.year}__${r.semester}`, r]));

  let inserted = 0;
  let skipped = 0;
  let gradesFilled = 0;

  for (const row of rows) {
    const key = `${row.name}__${row.year}__${row.semester}`;
    const letterGrade = row.letterGrade ?? null;
    const gpa = GRADE_POINT_MAP[letterGrade] ?? null;
    const existing = existingMap.get(key);

    if (existing) {
      if (letterGrade && existing.letter_grade === null) {
        await pool.query('UPDATE student_courses SET letter_grade = ?, gpa = ? WHERE id = ?', [
          letterGrade,
          gpa,
          existing.id,
        ]);
        existing.letter_grade = letterGrade;
        gradesFilled += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const [result] = await pool.query(
      'INSERT INTO student_courses (student_id, course_id, name, credits, category, year, semester, letter_grade, gpa) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)',
      [studentId, row.name, row.credits, row.category, row.year, row.semester, letterGrade, gpa]
    );
    existingMap.set(key, { id: result.insertId, name: row.name, year: row.year, semester: row.semester, letter_grade: letterGrade });
    inserted += 1;
  }

  return { inserted, skipped, gradesFilled };
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
    // letterGrade가 null이면(성적 미입력으로 되돌리기) GRADE_POINT_MAP[null]이 undefined인데,
    // mysql2는 undefined 바인드 파라미터를 거부한다("must not contain undefined") — SQL NULL은
    // 명시적으로 null을 넘겨야 해서 ?? null로 변환.
    fields.push('letter_grade = ?', 'gpa = ?');
    params.push(updates.letterGrade, GRADE_POINT_MAP[updates.letterGrade] ?? null);
  }

  if (fields.length === 0) return;

  params.push(id);
  await pool.query(`UPDATE student_courses SET ${fields.join(', ')} WHERE id = ?`, params);
}

async function deleteMyCourse(id) {
  await pool.query('DELETE FROM student_courses WHERE id = ?', [id]);
}

async function getTimetable(studentId, { year, semester }) {
  // 두 소스를 합친다: ① 카탈로그 과목의 course_offering_schedules(분반 시간),
  // ② 직접입력 과목에 선택적으로 넣은 student_course_schedules.
  // 둘 다 없으면(시간을 모르는 과거 기록 등) 그 과목은 시간표에 안 뜨는 게 정상.
  const [rows] = await pool.query(
    `SELECT cs.day, cs.period, sc.course_id, sc.name
     FROM student_courses sc
     JOIN course_offering_schedules cs ON cs.offering_id = sc.course_id
     WHERE sc.student_id = ? AND sc.year = ? AND sc.semester = ?
     UNION ALL
     SELECT scs.day, scs.period, sc.course_id, sc.name
     FROM student_courses sc
     JOIN student_course_schedules scs ON scs.student_course_id = sc.id
     WHERE sc.student_id = ? AND sc.year = ? AND sc.semester = ?
     ORDER BY FIELD(day, '월', '화', '수', '목', '금'), period`,
    [studentId, year, semester, studentId, year, semester]
  );

  return rows.map((r) => ({ day: r.day, period: r.period, courseId: r.course_id, name: r.name }));
}

// getSummary의 학기 집계는 letter_grade IS NOT NULL로 걸러지는데(GPA 계산 목적상 맞음),
// 화면의 학기 탭은 성적 입력 여부와 무관하게 "수강 기록이 있는 학기"를 전부 보여줘야
// 한다 — 안 그러면 성적을 아직 안 넣은 학기가 새로고침할 때마다 탭에서 사라져 보인다.
// courseCount도 같이 내려줘야 학기 탭만 보고도 "여기 뭐가 들어있는지" 감이 온다 —
// 안 그러면 매번 탭을 눌러봐야 비어있는지 아닌지 알 수 있어서 여러 학기를 훑어볼 때 불편하다.
async function listSemesters(studentId) {
  const [rows] = await pool.query(
    `SELECT year, semester, COUNT(*) AS course_count
     FROM student_courses
     WHERE student_id = ?
     GROUP BY year, semester
     ORDER BY year, semester`,
    [studentId]
  );
  return rows.map((r) => ({ year: r.year, semester: r.semester, courseCount: r.course_count }));
}

async function getSummary(studentId) {
  // credits가 이제 student_courses 자체에 저장돼 있으므로 courses JOIN이 필요 없음.
  // 성적 필터를 걸지 않고 전부 가져온다 — 이수학점(진행률)에는 이번 학기처럼 등록만
  // 해두고 성적이 아직 없는 과목도 "진행 중"으로 포함해야 하기 때문 (실사용 확인,
  // FAILING_GRADES만 제외).
  const [rows] = await pool.query(
    `SELECT sc.year, sc.semester, sc.credits, sc.gpa, sc.letter_grade
     FROM student_courses sc
     WHERE sc.student_id = ?`,
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

    // GPA는 실제 평점이 있는 과목만 반영(F도 평점 계산엔 포함 — 표준 관행). 성적 미입력
    // 과목은 gpa 컬럼이 NULL이라 계산에서 자연히 빠짐. letter_grade가 아니라 gpa로 판단하는
    // 이유: "전체성적조회" 가져오기로 들어온 P(Pass) 등급은 letter_grade는 채워지지만
    // GRADE_POINT_MAP에 없어 gpa가 NULL로 남는데, 여기서 letter_grade만 보면 P를 평점
    // 0.0으로 잘못 반영해 평균을 깎아먹는다(P/NP는 원래 평균평점 계산에서 제외돼야 함 —
    // 실제 전체성적조회 PDF의 "평균평점" 값과 대조해 확인).
    if (row.gpa !== null) {
      const gpaPoint = Number(row.gpa);
      bucket.gpaCredits += credits;
      bucket.points += credits * gpaPoint;
      totalGpaCredits += credits;
      totalPoints += credits * gpaPoint;
    }

    // 이수학점(진행률)은 불합격(FAILING_GRADES: F/NP)만 제외 — 성적 미입력(진행 중) 과목은 포함.
    if (!FAILING_GRADES.includes(row.letter_grade)) {
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
  VALID_CATEGORIES,
  LETTER_GRADES,
  FAILING_GRADES,
  searchCatalog,
  findCourseById,
  listMyCourses,
  addMyCourse,
  bulkAddMyCourses,
  findMyCourseById,
  updateMyCourse,
  deleteMyCourse,
  getTimetable,
  getSummary,
  listSemesters,
};
