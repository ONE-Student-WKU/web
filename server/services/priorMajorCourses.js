const { normalizeCourseName } = require('./courseNameMatch');

/**
 * server/services/priorMajorCourses.js
 * 전과생이 전과 전 학과에서 들은 전공 과목을 어떻게 셀지(2026-10-16 규정 대조, DECISIONS D-77). 순수 함수.
 *
 * 시행규칙 제3조 제4항 제1호: 타 학과(부)의 전공 교과목을 이수한 경우 이수구분은 일반선택이다. 학교 전과 안내(전과.md 11절)·제115조:
 *  - 전과한 학과의 전공과목을 이미 들었으면 그대로 인정한다(개설 학과가 새 학과).
 *  - 전과 전에 들은 전공과목이 전과한 학과의 전공과목과 같으면 "전과생 전공학점 인정 신청"을 한 학생에 한해 전공선택으로 인정한다.
 *  - 그 밖의 전과 전 전공 학점은 일반선택으로 총 이수학점에만 들어간다.
 * 학년과 무관하게 모든 전과생에게 적용한다(결정 1번-나). 신청 여부는 학생이 답한 값(students.major_change_recognition)을 쓴다(1번-가).
 * 학생이 과목마다 고친 값(student_courses.counted_major)이 있으면 그것이 우선한다 — 호출자(courseCounting.js)가 처리한다.
 */

const MAJOR_CATEGORIES = new Set(['전공필수', '전공선택', '전공']);

// 학기 순서: 1학기 → 여름 → 2학기 → 겨울(DB 학기 코드 1·2·3·4).
const courseTermIndex = (year, semesterCode) => Number(year) * 4 + (Number(semesterCode) - 1);
// 전과한 학기(1·2학기)의 시작. 그 전 학기(그 해 1학기 뒤 여름학기 포함)까지가 전과 전이다.
const changeTermIndex = (year, semester) => Number(year) * 4 + (Number(semester) === 2 ? 2 : 0);

/**
 * @param {{ name, category, year, semester, offering_department_id }} course
 * @param {{ changeIndex, newIds: Set, newNames: Set, recognitionApplied: boolean }} ctx
 * @returns {{ category, reason: 'DEMOTED'|'RECOGNIZED'|null }}
 */
function classifyPriorMajorCourse(course, ctx) {
  const unchanged = { category: course.category, reason: null };
  if (!MAJOR_CATEGORIES.has(course.category)) return unchanged;
  if (courseTermIndex(course.year, course.semester) >= ctx.changeIndex) return unchanged;
  if (course.offering_department_id != null && ctx.newIds.has(Number(course.offering_department_id))) return unchanged;
  const sameCourse = ctx.newNames.has(normalizeCourseName(String(course.name || '')));
  if (sameCourse && ctx.recognitionApplied) return { category: '전공선택', reason: 'RECOGNIZED' }; // 제115조 제4항: 인정 시 전공선택
  return { category: '일반선택', reason: 'DEMOTED' };
}

module.exports = { classifyPriorMajorCourse, courseTermIndex, changeTermIndex, MAJOR_CATEGORIES };
