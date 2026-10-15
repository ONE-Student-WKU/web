const { rowAppliesToYear, hasCoreRowsForYear } = require('./evaluate');
const cohortTables = require('./cohortTables');

/**
 * server/services/regulationEngine/newDepartmentCohort.js
 * 학과가 생기기 전 학번의 학생이 그 학과로 전과한 경우(예: 2021학번 → 2023년 신설 경영학과)의 졸업요건 행을 만든다(#378, 2026-10-15 결정 A안).
 *
 * 왜 필요한가: 전과생은 옮긴 학과의 "당초 입학 학번" 요건을 따른다(학칙시행규칙 제5조 — 22학번이 25년에 전과하면 그 학과의 22학번 요건).
 * 그런데 시드에는 학과가 생긴 학번부터만 행이 있어, 이런 학생은 엔진이 "자료 없음"(NO_CURRICULUM_ROWS)으로 끝났다(로컬 기준 26개 학과 74개 조합).
 *
 * 만드는 방법:
 *  - 학번에 따라 달라지는 교양·졸업학점은 2026 책자 학번별 표에서 **학생 학번** 값을 쓴다(학과의 첫 학번 소속 대학 기준).
 *    표에서 못 찾으면(대학 이름이 표에 없는 신설 대학 등) 학과 첫 학번 값을 그대로 쓰고 따로 알린다.
 *  - 전공 학점은 책자에 그 학번의 그 학과 줄이 없어 **학과의 첫 학번 값**으로 추정한다(학교 확인 필요 — #378 다음 문의 후보).
 *    3·4학년 전과의 최소전공(전과 완화 행)도 첫 학번 값이다.
 *  - 졸업논문·졸업인증제는 학과 기준이라 첫 학번 행을 쓰되, 학생 학번에 이미 맞는 행(예: 2020학번부터 적용되는 졸업인증제)이 있으면 그 행을 쓴다.
 * 여기서 만든 값은 엔진이 "추정"(MAJOR_CHANGE_COHORT_BEFORE_DEPARTMENT)으로 표시한다.
 *
 * @param {Array} rows            학과의 모든 요건 행(dbProvider.loadRequirementRows 모양)
 * @param {string} departmentName
 * @param {number} admissionYear  학생의 당초 입학 학번
 * @param {object} [deps]         테스트용 주입 { tables, collegeByYear }
 * @returns {{ rows: Array, fallback: object } | null}  만들 수 없으면(학과에 그 뒤 학번 행도 없음) null
 */
function buildNewDepartmentCohortRows(rows, departmentName, admissionYear, deps = {}) {
  const laterYears = [...new Set(rows.flatMap((r) => [r.minAdmissionYear, r.maxAdmissionYear]).filter((y) => y != null && y > admissionYear))].sort((a, b) => a - b);
  const firstCohort = laterYears.find((y) => hasCoreRowsForYear(rows, y));
  if (firstCohort == null) return null;

  // 학과 첫 학번의 행을 바탕으로, 같은 (구분·입학유형)에 학생 학번에 이미 맞는 비학점 행(졸업인증제 등)이 있으면 그걸 쓴다.
  const key = (r) => `${r.category}|${r.enrollmentType || ''}`;
  const ownYear = new Map(rows.filter((r) => r.minCourseCount != null && rowAppliesToYear(r, admissionYear)).map((r) => [key(r), r]));
  const base = rows.filter((r) => rowAppliesToYear(r, firstCohort));
  let out = base.map((r) => ({ ...(ownYear.get(key(r)) || r), minAdmissionYear: admissionYear, maxAdmissionYear: admissionYear }));
  for (const [k, r] of ownYear) if (!out.some((o) => key(o) === k)) out.push({ ...r, minAdmissionYear: admissionYear, maxAdmissionYear: admissionYear });

  const tables = deps.tables !== undefined ? deps.tables : cohortTables.loadCohortTables();
  const collegeByYear = deps.collegeByYear || (tables ? cohortTables.loadCollegeByYear() : {});
  const college = cohortTables.collegeOf(collegeByYear, departmentName, firstCohort) || cohortTables.collegeOf(collegeByYear, departmentName, firstCohort + 1) || null;
  const lib = tables ? cohortTables.expectedLiberal(tables, departmentName, college, admissionYear) : null;
  const grad = tables ? cohortTables.expectedGraduation(tables, departmentName, college, admissionYear) : null;
  const liberalFromTable = Boolean(lib && !lib.missing && !lib.special);

  if (liberalFromTable) {
    const note = `(2026 책자 학번별 표 ${lib.page}, ${admissionYear}학번 — 학과가 생기기 전 학번이라 소속 대학 ${college} 기준)`;
    out = out.map((r) => {
      if (r.enrollmentType != null) return r;
      if (r.category === '교양필수') return { ...r, requiredCredits: lib.required, requiredCourses: lib.requiredCourses, description: `${lib.requiredCourses.join('+')} ${lib.required}학점 ${note}` };
      if (r.category === '교양선택') return { ...r, requiredCredits: lib.elective, description: `영역 구분 없이 ${lib.elective}학점 ${note}` };
      return r;
    });
  }

  // 졸업학점을 표에서 찾았으면 일반선택 = 졸업학점 − 전공 − 교양. 첫 학번 전공 학점(추정)을 그대로 빼므로 일반선택도 추정이다.
  const graduationFromTable = liberalFromTable && grad != null;
  if (graduationFromTable) {
    const general = out.filter((r) => r.enrollmentType == null && r.minCourseCount == null);
    const used = general.filter((r) => r.category !== '일반선택').reduce((s, r) => s + Number(r.requiredCredits), 0);
    const elective = Math.max(0, grad - used);
    const description = `자유선택 ${elective}학점 (${admissionYear}학번 졸업학점 ${grad} − 전공·교양 ${used}, 전공은 학과 첫 학번 ${firstCohort} 기준 추정)`;
    const existing = out.find((r) => r.enrollmentType == null && r.category === '일반선택');
    out = existing
      ? out.map((r) => (r === existing ? { ...r, requiredCredits: elective, description } : r))
      : [...out, { id: null, category: '일반선택', requiredCredits: elective, description, enrollmentType: null, minCourseCount: null, minAdmissionYear: admissionYear, maxAdmissionYear: admissionYear, requiredCourses: [] }];
  }

  return { rows: out, fallback: { firstCohort, college, liberalFromTable, graduationFromTable } };
}

module.exports = { buildNewDepartmentCohortRows };
