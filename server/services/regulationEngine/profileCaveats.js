const { makeFlag } = require('./flags');
const { isTeacherCollegeDepartment } = require('../teachingCourse');

/**
 * server/services/regulationEngine/profileCaveats.js
 * 졸업요건 값은 냈지만 학교 답변 전이라 틀릴 수 있는 경우, 또는 규정상 있을 수 없는 입력이라 결과를 믿기 어려운 경우를 찾아 플래그를 붙인다(순수 함수).
 *
 * 왜 따로 두나: 엔진은 플래그가 없으면 "확정"으로 내보낸다. 값을 고르는 규칙(decisions.js·evaluate.js)과 별개로 "이 결과에 아직 확인되지 않은
 * 가정이 섞였나"를 한곳에서 점검해야, 학교 답이 왔을 때 지울 곳도 한곳이다(3차 문의 E·F, 2026-10-24 점검).
 */

// 학칙시행규칙 제109조(전과 시기). 학과(부)별 허용 학년 — 여기 없는 학사과정 학과(일반계열)는 1~4학년.
const NURSING_DEPARTMENTS = ['간호학과'];
const HEALTH_SERIES_DEPARTMENTS = ['작업치료학과', '임상병리학과', '물리치료학과', '방사선학과', '치기공학과', '치위생학과', '안경광학과', '응급구조학과'];
const ASSOCIATE_DEGREE_DEPARTMENTS = ['외식조리과', '미용피부관리과', '호텔관광과', '웰니스케어과', '부사관과'];

// 작업치료학과·응급구조학과로의 전과에 제109조를 적용하는 것은 2026년 3월 1일 입학생부터다(시행규칙 부칙 2026.02.05. 제2조) — 그 전 학번은 학년으로 막지 않는다.
const ART109_FROM_2026_DEPARTMENTS = ['작업치료학과', '응급구조학과'];

function allowedMajorChangeGrades(departmentName, admissionYear = null) {
  if (NURSING_DEPARTMENTS.includes(departmentName)) return [3];
  if (ART109_FROM_2026_DEPARTMENTS.includes(departmentName) && admissionYear != null && admissionYear < 2026) return [1, 2, 3, 4];
  if (HEALTH_SERIES_DEPARTMENTS.includes(departmentName) || isTeacherCollegeDepartment(departmentName)) return [2, 3];
  if (ASSOCIATE_DEGREE_DEPARTMENTS.includes(departmentName)) return [1, 2];
  if (typeof departmentName === 'string' && departmentName.endsWith('계열')) return [2, 3, 4];
  return [1, 2, 3, 4];
}

// 학칙 제36조: 편입학 학년은 3학년, 의학과·치의학과·한의학과는 1학년이 원칙이다. 2년 과정인 예과에는 편입이 없다.
const PREMED_DEPARTMENTS = ['의예과', '치의예과', '한의예과'];
const MEDICAL_SCHOOL_DEPARTMENTS = ['의학과', '치의학과', '한의학과'];

// 책자에 그룹이 없어 학교 답변을 해석해 그룹을 정한 계열(3차 문의 E-2 ⑥). 디자인융합계열은 학교가 세부전공별 그룹을 직접 답해(2차 문의 D-2, D-83) 여기 넣지 않는다.
const INTERPRETED_CERTIFICATION_GROUP = [{ departmentName: '의생명공학계열', fromCohort: 2026 }];

/** 두 학번의 최종 요건(조정 후)이 같은지 비교하려고 학점 행을 "구분:학점" 목록으로 만든다. */
function requirementSignature(rows) {
  return rows.filter((r) => r.minCourseCount == null).map((r) => `${r.category}:${Number(r.requiredCredits)}`).sort().join('|');
}

/** "전과한 학년의 당초 입학자" 학번. 학기초에 전과하므로 Y년 g학년 전과의 당초 입학자는 Y - g + 1학번이다. 입학 학번과 같거나 모르면 null. */
function originalCohortOf(ctx) {
  const mc = ctx.majorChange;
  if (ctx.enrollmentType !== 'MAJOR_CHANGE' || !mc || mc.grade == null || mc.year == null) return null;
  const cohort = mc.year - mc.grade + 1;
  return cohort === ctx.admissionYear ? null : cohort;
}

// 시행규칙 제118조 제1항 제7호: 전문학사 과정은 졸업사정에서 졸업논문·졸업인증제를 뺀다. 엔진과 챗봇 근거가 같은 기준을 쓰게 여기 둔다.
function isAssociateExcludedRequirement(departmentName, category) {
  return ASSOCIATE_DEGREE_DEPARTMENTS.includes(departmentName) && (category === '졸업논문' || category === '졸업인증제');
}

/**
 * @param {object} ctx  context.normalizeInput의 ctx
 * @param {string} departmentName
 * @param {object} opts
 * @param {string[]} opts.adjustments  buildRequirementRows가 적용한 조정
 * @param {boolean} opts.hasMajorAreaMinimums  기초·심화·응용 최소학점을 냈는지
 * @param {boolean} opts.hasCertificationRows
 * @returns {Array} flags
 */
function profileCaveats(ctx, departmentName, { adjustments = [], hasMajorAreaMinimums = false, hasCertificationRows = false } = {}) {
  const flags = [];
  const mc = ctx.majorChange;

  if (ctx.enrollmentType === 'MAJOR_CHANGE' && mc) {
    if (mc.grade != null && !allowedMajorChangeGrades(departmentName, ctx.admissionYear).includes(mc.grade)) flags.push(makeFlag('MAJOR_CHANGE_GRADE_NOT_ALLOWED', { inputGrade: mc.grade }));
  }

  if (ctx.enrollmentType === 'TRANSFER_ADMISSION' && MEDICAL_SCHOOL_DEPARTMENTS.includes(departmentName)) flags.push(makeFlag('TRANSFER_MEDICAL_SCHOOL_BYLAW'));

  // 광역계열인데 기초·심화·응용 최소학점을 내지 않은 경우: 3·4학년 전과·편입(전공 완화) 또는 계열이 생기기 전 학번의 전과생.
  const isSeries = typeof departmentName === 'string' && departmentName.endsWith('계열');
  if (isSeries && !hasMajorAreaMinimums && (ctx.enrollmentType !== 'GENERAL' || adjustments.includes('MAJOR_RELAXATION'))) flags.push(makeFlag('BROAD_SERIES_AREAS_NOT_APPLIED'));

  if (hasCertificationRows && INTERPRETED_CERTIFICATION_GROUP.some((g) => g.departmentName === departmentName && ctx.admissionYear >= g.fromCohort)) {
    flags.push(makeFlag('CERTIFICATION_GROUP_INTERPRETED'));
  }
  return flags;
}

module.exports = { profileCaveats, allowedMajorChangeGrades, requirementSignature, originalCohortOf, isAssociateExcludedRequirement, PREMED_DEPARTMENTS, MEDICAL_SCHOOL_DEPARTMENTS, ASSOCIATE_DEGREE_DEPARTMENTS };
