const curriculumService = require('./curriculumService');
const { buildCompletedNameSet, isCompleted } = require('./courseNameMatch');

/**
 * server/services/designatedMajorCourses.js
 * 학칙시행규칙 제9조 제1호 학과의 "지정된 전공기초·전공필수 교과목"을 안내용으로 모은다(#378 결정 5-1 A — 판정하지 않고 안내만).
 *
 * 제9조 제1호: 의과대학, 치과대학, 한의과대학, 약학대학, 간호대학, 응급구조학과, 보건의료대학(언어재활학과, 식품영양학과,
 * 보건행정학과 제외)은 "학과(부) 교육과정에 따르되, 지정된 전공기초·전공필수 교과목을 반드시 이수"한다.
 * 어떤 과목이 "지정" 과목인지는 학과 내규로 정해 교육혁신과도 알 수 없다(답변 A-5, 2026-10-14). 그래서 충족 여부는 판정하지 않고,
 * 그 학과의 가장 최근 편성표(앞으로 들을 과목 — curriculumService.resolveCourseListYear)에서 전공기초·전공필수 과목을 보여 주며
 * 학과 확인을 안내한다. 이미 들은 과목은 표시만 한다.
 */

// 학과 이름은 2026 소속 기준(단과대학 이름이 바뀌어도 학과 이름으로 고정한다). 보건의료대학은 제외 3개 학과를 뺀 7개 학과.
const DESIGNATED_MAJOR_COURSE_DEPARTMENTS = Object.freeze([
  '의예과', '의학과', '치의예과', '치의학과', '한의예과', '한의학과', '약학과', '한약학과', '간호학과', '응급구조학과',
  '작업치료학과', '임상병리학과', '물리치료학과', '방사선학과', '치기공학과', '치위생학과', '안경광학과',
]);
const DESIGNATED_CATEGORIES = ['전공기초', '전공필수'];

/**
 * @param {object} student  students 행(department_id, department_name, track_id, admission_year)
 * @param {string[]} passedCourseNames  이수로 인정되는 학생 과목명
 * @returns {Promise<{ courseListYear, courses: Array<{ courseName, category, grade, semester, credits, taken }> } | null>}
 */
async function loadDesignatedMajorCourses(student, passedCourseNames) {
  if (!student || !DESIGNATED_MAJOR_COURSE_DEPARTMENTS.includes(student.department_name)) return null;
  const filter = { departmentId: student.department_id, trackId: student.track_id || null, admissionYear: student.admission_year };
  const courseListYear = await curriculumService.resolveCourseListYear(filter);
  const rows = await curriculumService.findCourses({ ...filter, admissionYear: courseListYear });
  const completed = buildCompletedNameSet(passedCourseNames);
  const byName = new Map();
  for (const r of rows) {
    if (!DESIGNATED_CATEGORIES.includes(r.category) || byName.has(r.courseName)) continue;
    byName.set(r.courseName, {
      courseName: r.courseName, category: r.category, grade: r.grade, semester: r.semester, credits: r.credits,
      taken: isCompleted(r.courseName, completed),
    });
  }
  return { courseListYear, courses: [...byName.values()] };
}

module.exports = { loadDesignatedMajorCourses, DESIGNATED_MAJOR_COURSE_DEPARTMENTS };
