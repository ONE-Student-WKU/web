const pool = require('../db');
const { normalizeCourseName } = require('./courseNameMatch');
const { getDepartmentChain } = require('./curriculumHistoryService');
const { isTeacherCollegeDepartment } = require('./teachingCourse');

/**
 * server/services/secondMajorCredits.js
 * 다전공(복수전공·부전공) 판정(#378 G-2, 결정 4-3·4-4).
 *
 * 1) 과목을 어느 전공으로 셀지(assignCourseMajor, 순수 함수) — 결정 4-3: 자동으로 정하고 학생은 예외만 고친다.
 *    - 학생이 직접 고른 값(student_courses.counted_major)이 있으면 그것을 따른다.
 *    - 전공·일반선택 과목만 제2전공 후보다. 교양은 늘 주전공(교양은 주전공 기준만 이수, 복수전공.md 4절).
 *    - 개설과목에서 고른 과목은 개설 학과(학수번호의 학과)로 정한다. 제2전공 학과(옛 이름 포함)면 제2전공, 주전공 학과면 주전공.
 *    - 직접 입력·성적표로 넣은 과목은 과목명으로 정한다. 제2전공 학과 편성표에만 있으면 제2전공이다. 두 학과에 모두 있는 공통 과목은
 *      주전공으로 두고, 학생이 바꿀 수 있다(어느 쪽으로 세는지, 중복 인정이 되는지는 학교 문의 후보).
 *    - 제2전공으로 센 과목은 주전공 쪽에서 일반선택(자유선택)이다(시행규칙 제3조 제4항 — 타 학과 전공 과목은 일반선택, 이슈 #253).
 * 2) 제2전공 요건(secondMajorRequirement) — 복수전공은 제2전공 학과의 최소전공 인정학점(시행규칙 제8조 제1항)과 졸업논문2,
 *    부전공은 21학점(「다전공이수에 관한 내규」 제5조 제3항). 광역 계열전공 복수전공형은 전공별 36학점(제7조 제2항 제1호).
 */

const COUNTED_MAJORS = Object.freeze(['PRIMARY', 'SECOND']);
const SECOND_CANDIDATE_CATEGORIES = new Set(['전공필수', '전공선택', '전공', '일반선택']);
const MINOR_CREDITS = 21;
const BROAD_SERIES_DOUBLE_MAJOR_CREDITS = 36;
// 복수전공 졸업논문2 — 개설현황의 "졸업(시험,작품)논문2"(L00006). 표기 차이는 normalizeCourseName으로 흡수한다.
const SECOND_THESIS_NAMES = ['졸업(시험,작품)논문2', '졸업(시험·작품)논문2', '졸업논문2'].map(normalizeCourseName);
// 다전공 신청 제한(복수전공.md·부전공.md 3절, 내규 제14조): 이 학과 소속 학생은 신청할 수 없고, 다른 학과 학생도 이 학과로 다전공할 수 없다.
const RESTRICTED_DEPARTMENTS = new Set(['의예과', '의학과', '치의예과', '치의학과', '한의예과', '한의학과', '약학과', '한약학과', '건축학과']);
// 다른 학과 학생이 다전공으로 갈 수 없는 학과(사범계열 포함).
const RESTRICTED_TARGETS = new Set([...RESTRICTED_DEPARTMENTS, '동물보건학과', '반려동물산업학과']);

/**
 * @param {{ category, name, counted_major, offering_department_id }} course
 * @param {{ primaryIds: Set, secondIds: Set, primaryNames: Set, secondNames: Set }} ctx  학과 id(옛 이름 포함)·편성표 과목명(정규화)
 * @returns {{ major: 'PRIMARY'|'SECOND', auto: boolean }}
 */
function assignCourseMajor(course, ctx) {
  if (COUNTED_MAJORS.includes(course.counted_major)) return { major: course.counted_major, auto: false };
  if (!SECOND_CANDIDATE_CATEGORIES.has(course.category)) return { major: 'PRIMARY', auto: true };
  const dept = course.offering_department_id;
  if (dept != null && ctx.secondIds.has(Number(dept))) return { major: 'SECOND', auto: true };
  if (dept != null && ctx.primaryIds.has(Number(dept))) return { major: 'PRIMARY', auto: true };
  const key = normalizeCourseName(String(course.name || ''));
  if (ctx.secondNames.has(key) && !ctx.primaryNames.has(key)) return { major: 'SECOND', auto: true };
  return { major: 'PRIMARY', auto: true };
}

async function curriculumNames(departmentIds) {
  if (departmentIds.length === 0) return new Set();
  const [rows] = await pool.query('SELECT DISTINCT course_name FROM curriculum_courses WHERE department_id IN (?)', [departmentIds]);
  return new Set(rows.map((r) => normalizeCourseName(r.course_name)));
}

/** 판정에 쓸 학과·편성표 문맥. 제2전공이 없으면 null. */
async function loadAssignmentContext(student) {
  if (!student || student.second_department_id == null) return null;
  const [primary, second] = await Promise.all([getDepartmentChain(student.department_id), getDepartmentChain(student.second_department_id)]);
  const [primaryNames, secondNames] = await Promise.all([curriculumNames(primary.departmentIds), curriculumNames(second.departmentIds)]);
  return {
    primaryIds: new Set(primary.departmentIds.map(Number)),
    secondIds: new Set(second.departmentIds.map(Number)),
    primaryNames,
    secondNames,
  };
}

/** 과목 행 id → 개설 학과 id(개설과목에서 고른 과목만). */
async function loadOfferingDepartments(studentId) {
  const [rows] = await pool.query(
    `SELECT sc.id, co.department_id FROM student_courses sc JOIN course_offerings co ON co.id = sc.course_id WHERE sc.student_id = ?`,
    [studentId]
  );
  return new Map(rows.map((r) => [r.id, r.department_id]));
}

/**
 * 학생 과목마다 어느 전공으로 세는지. 제2전공이 없으면 null.
 * @returns {Promise<Map<number, { major, auto }>> | null}
 */
async function loadCourseMajors(student, courses) {
  const ctx = await loadAssignmentContext(student);
  if (!ctx) return null;
  const offering = await loadOfferingDepartments(student.id);
  return new Map(courses.map((c) => [c.id, assignCourseMajor({ ...c, offering_department_id: offering.get(c.id) ?? null }, ctx)]));
}

/**
 * 제2전공 요건 학점과 근거. 순수 함수 — 복수전공 최소전공은 호출자가 엔진으로 구해 넘긴다.
 * @param {{ type, broadSeriesDoubleMajorTrack: boolean, minimumMajorCredits: number|null }} p
 * @returns {{ required: number|null, basis: 'MINOR_21'|'BROAD_SERIES_36'|'DOUBLE_MINIMUM'|'DOUBLE_MINIMUM_UNKNOWN' }}
 */
function secondMajorRequirement({ type, broadSeriesDoubleMajorTrack, minimumMajorCredits }) {
  if (type === 'MINOR') return { required: MINOR_CREDITS, basis: 'MINOR_21' };
  if (broadSeriesDoubleMajorTrack) return { required: BROAD_SERIES_DOUBLE_MAJOR_CREDITS, basis: 'BROAD_SERIES_36' };
  return minimumMajorCredits != null ? { required: minimumMajorCredits, basis: 'DOUBLE_MINIMUM' } : { required: null, basis: 'DOUBLE_MINIMUM_UNKNOWN' };
}

/** 졸업논문2를 합격했나. 성적이 없으면(진행 중) 아직 아니다 — 졸업논문과 같은 기준. */
function hasSecondThesis(allCourseRows, failingGrades) {
  return (allCourseRows || []).some((r) => SECOND_THESIS_NAMES.includes(normalizeCourseName(String(r.name || ''))) && r.letter_grade != null && !failingGrades.includes(r.letter_grade));
}

/** 신청 제한에 걸리는 조합인가(판정은 그대로 하고 안내만 한다 — 학교 승인을 받은 값이라 막지 않는다, D-75). */
function isRestrictedCombination(primaryName, secondName) {
  return RESTRICTED_DEPARTMENTS.has(primaryName) || RESTRICTED_TARGETS.has(secondName) || isTeacherCollegeDepartment(secondName);
}

module.exports = {
  COUNTED_MAJORS, MINOR_CREDITS, BROAD_SERIES_DOUBLE_MAJOR_CREDITS,
  assignCourseMajor, loadAssignmentContext, loadCourseMajors, secondMajorRequirement, hasSecondThesis, isRestrictedCombination,
};
