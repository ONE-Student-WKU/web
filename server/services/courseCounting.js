const pool = require('../db');
const { getDepartmentChain } = require('./curriculumHistoryService');
const { loadAssignmentContext, assignCourseMajor, curriculumNames, loadOfferingDepartments } = require('./secondMajorCredits');
const { classifyPriorMajorCourse, changeTermIndex, MAJOR_CATEGORIES } = require('./priorMajorCourses');
const { normalizeCourseName } = require('./courseNameMatch');
const { MEDICAL_SCHOOL_OF } = require('./studentProgress');

/**
 * server/services/courseCounting.js
 * 과목을 졸업요건 진단에서 어떻게 셀지 한 곳에서 정한다 — 전과 전 과목(priorMajorCourses.js, D-77), 다전공(secondMajorCredits.js, D-76),
 * 다른 학과 전공 과목(D-88). 졸업요건 진단(graduationService)과 과목 목록(GET /api/my-courses)이 같은 결과를 쓴다.
 *
 * 순서: 학생이 고친 값 → 전과 전 과목 재분류 → 다전공 배정 → 다른 학과 전공 과목.
 *  - counted_major 'GENERAL': 일반선택으로 센다. 'PRIMARY': 저장된 구분 그대로 주전공 쪽(전과 전 과목이면 "전공으로 인정"). 'SECOND': 제2전공.
 *  - 다른 학과 전공 과목(#253 설계안 2): 개설과목에서 고르면 개설 학과의 구분이 저장된다(courseService.addMyCourse). 진단할 때마다 지금 소속과
 *    대조해, 개설 학과가 내 학과(통폐합 전후·예과↔본과 포함)가 아니고 내 학과 편성표에도 없는 전공 과목은 일반선택으로 센다(시행규칙 제3조
 *    제4항 제1호). 학과를 고친 학생과 다른 학과 전공 과목을 고른 학생이 같이 바로잡힌다. 개설 학과를 모르는 과목(성적표·직접 입력)은
 *    학교가 찍은 구분이거나 학생이 고른 구분이라 그대로 둔다. 광역 계열 안의 다른 전공 과목은 학과가 같아 건드리지 않는다.
 * 결과 counted: 'PRIMARY'(주전공 쪽, 저장된 구분 또는 인정된 전공선택) | 'GENERAL'(일반선택으로 바뀜) | 'SECOND'(제2전공).
 * reason: 'DEMOTED'·'RECOGNIZED'(전과 전 과목) | 'OTHER_DEPARTMENT'(다른 학과 전공 과목) | null.
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

// 예과와 본과는 다른 학과로 저장되지만 한 과정이다(의예과 → 의학과 등). 서로의 과목을 다른 학과 과목으로 보지 않는다.
function pairedMedicalDepartment(name) {
  if (MEDICAL_SCHOOL_OF[name]) return MEDICAL_SCHOOL_OF[name];
  return Object.keys(MEDICAL_SCHOOL_OF).find((premed) => MEDICAL_SCHOOL_OF[premed] === name) || null;
}

/** 내 학과 문맥 — 학과 id(통폐합 전후·예과↔본과)와 그 편성표 과목명(정규화). */
async function loadOwnDepartmentContext(student) {
  if (!student || student.department_id == null) return null;
  const pairName = pairedMedicalDepartment(student.department_name);
  const [pairRows] = pairName ? await pool.query('SELECT id FROM departments WHERE name = ?', [pairName]) : [[]];
  const chains = await Promise.all([student.department_id, ...pairRows.map((r) => r.id)].map((id) => getDepartmentChain(id)));
  const ids = [...new Set(chains.flatMap((c) => c.departmentIds.map(Number)))];
  return { ids: new Set(ids), names: await curriculumNames(ids) };
}

/**
 * 순수 함수 — 개설 학과가 내 학과가 아니고 내 편성표에도 없는 전공 과목인가(D-88).
 * 개설과목에서 고른 과목만 본다 — 성적표 PDF 과목은 개설 학과를 알아도(courseOrigin.js) 이수구분을 학교가 찍은 값이라 바꾸지 않는다.
 */
function isOtherDepartmentMajorCourse(course, own) {
  if (!own || !MAJOR_CATEGORIES.has(course.category) || course.offering_department_id == null || !course.offering_from_catalog) return false;
  if (own.ids.has(Number(course.offering_department_id))) return false;
  return !own.names.has(normalizeCourseName(String(course.name || '')));
}

/** 순수 함수 — 과목 하나. */
function countCourse(course, { prior, second, own }) {
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
  if (counted === 'PRIMARY' && override == null && reason == null && isOtherDepartmentMajorCourse({ ...course, category }, own)) {
    return { counted: 'GENERAL', category: '일반선택', reason: 'OTHER_DEPARTMENT', auto: true };
  }
  return { counted, category, reason, auto: override == null };
}

/**
 * @param {object} student  studentService.findById 행
 * @param {Array<{ id, name, category, year, semester, counted_major }>} courses
 * @returns {Promise<{ byId: Map<number, { counted, category, reason, auto, autoCounted? }>, priorApplies: boolean, secondApplies: boolean, linked } | null>}
 *   전과 전 과목·다전공에 해당하지 않고, 다른 학과 전공 과목도 학생이 고친 과목도 없으면 null(저장된 구분 그대로)
 */
async function resolveCourseCounting(student, courses) {
  if (!student) return null;
  const [prior, second, own, offering] = await Promise.all([
    loadPriorContext(student), loadAssignmentContext(student), loadOwnDepartmentContext(student), loadOfferingDepartments(student.id),
  ]);
  const byId = new Map(courses.map((c) => {
    const origin = offering.get(c.id);
    const course = { ...c, offering_department_id: origin?.departmentId ?? null, offering_from_catalog: Boolean(origin?.fromCatalog) };
    const result = countCourse(course, { prior, second, own });
    // 학생이 고친 과목은 "자동"으로 되돌렸을 때의 값도 싣는다 — 과목 관리의 "자동: …" 칸이 고친 값이 아니라 자동 값을 보여 준다.
    return [c.id, result.auto ? result : { ...result, autoCounted: countCourse({ ...course, counted_major: null }, { prior, second, own }).counted }];
  }));
  if (!prior && !second && ![...byId.values()].some((r) => r.reason === 'OTHER_DEPARTMENT' || !r.auto)) return null;
  // linked: 제2전공이 연계·복합전공이면 그 전공(과목 목록 포함, services/linkedMajors.js) — 진단이 중복 인정·교양 인정 학점을 센다.
  return { byId, priorApplies: Boolean(prior), secondApplies: Boolean(second), linked: second ? second.linked || null : null };
}

module.exports = { resolveCourseCounting, countCourse, isOtherDepartmentMajorCourse, pairedMedicalDepartment };
