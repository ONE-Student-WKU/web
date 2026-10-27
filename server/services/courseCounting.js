const { getDepartmentChain } = require('./curriculumHistoryService');
const { loadAssignmentContext, assignCourseMajor, curriculumNames, loadOfferingDepartments } = require('./secondMajorCredits');
const { classifyPriorMajorCourse, changeTermIndex } = require('./priorMajorCourses');

/**
 * server/services/courseCounting.js
 * 과목을 졸업요건 진단에서 어떻게 셀지 한 곳에서 정한다 — 전과 전 과목(priorMajorCourses.js, D-77)과 다전공(secondMajorCredits.js, D-76).
 * 졸업요건 진단(graduationService)과 과목 목록(GET /api/my-courses)이 같은 결과를 쓴다.
 *
 * 순서: 학생이 고친 값 → 전과 전 과목 재분류 → 다전공 배정.
 *  - counted_major 'GENERAL': 일반선택으로 센다. 'PRIMARY': 저장된 구분 그대로 주전공 쪽(전과 전 과목이면 "전공으로 인정"). 'SECOND': 제2전공.
 * 결과 counted: 'PRIMARY'(주전공 쪽, 저장된 구분 또는 인정된 전공선택) | 'GENERAL'(일반선택으로 바뀜) | 'SECOND'(제2전공).
 */

async function loadPriorContext(student) {
  if (!student || student.enrollment_type !== 'MAJOR_CHANGE' || student.major_change_year == null || student.major_change_semester == null) return null;
  const chain = await getDepartmentChain(student.department_id);
  return {
    changeIndex: changeTermIndex(student.major_change_year, student.major_change_semester),
    newIds: new Set(chain.departmentIds.map(Number)),
    newNames: await curriculumNames(chain.departmentIds),
    recognitionApplied: Number(student.major_change_recognition) === 1,
  };
}

/** 순수 함수 — 과목 하나. */
function countCourse(course, { prior, second }) {
  const override = course.counted_major;
  let category = course.category;
  let reason = null;
  if (override === 'GENERAL') {
    category = '일반선택';
  } else if (prior && override == null) {
    ({ category, reason } = classifyPriorMajorCourse(course, prior));
  }
  let counted = override === 'GENERAL' || reason === 'DEMOTED' ? 'GENERAL' : 'PRIMARY';
  if (second && override !== 'GENERAL') {
    const assigned = assignCourseMajor({ ...course, category }, second);
    if (assigned.major === 'SECOND') counted = 'SECOND';
  }
  return { counted, category, reason, auto: override == null };
}

/**
 * @param {object} student  studentService.findById 행
 * @param {Array<{ id, name, category, year, semester, counted_major }>} courses
 * @returns {Promise<{ byId: Map<number, { counted, category, reason, auto }>, priorApplies: boolean, secondApplies: boolean } | null>}
 *   전과 전 과목도 다전공도 해당하지 않으면 null(저장된 구분 그대로)
 */
async function resolveCourseCounting(student, courses) {
  const [prior, second] = await Promise.all([loadPriorContext(student), loadAssignmentContext(student)]);
  if (!prior && !second) return null;
  const offering = await loadOfferingDepartments(student.id);
  const byId = new Map(courses.map((c) => [c.id, countCourse({ ...c, offering_department_id: offering.get(c.id) ?? null }, { prior, second })]));
  // linked: 제2전공이 연계·복합전공이면 그 전공(과목 목록 포함, services/linkedMajors.js) — 진단이 중복 인정·교양 인정 학점을 센다.
  return { byId, priorApplies: Boolean(prior), secondApplies: Boolean(second), linked: second ? second.linked || null : null };
}

module.exports = { resolveCourseCounting, countCourse };
