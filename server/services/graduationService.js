const pool = require('../db');
const studentService = require('./studentService');

/**
 * server/services/graduationService.js
 * 졸업요건 진단 — curriculum_requirements(학과·학번·전형별 요건)와 student_courses(실제 이수)를
 * 조합해 카테고리별 이수 현황 및 졸업논문/졸업인증제 같은 P/F 요건 충족 여부를 계산한다.
 */

// 교양필수+교양선택 합산 인정 상한. 초과분은 총 이수학점 계산에서 완전히 제외한다
// (일반선택으로도 안 흘러감 — 교양을 아무리 많이 들어도 이 이상은 졸업요건에 안 잡힘).
const LIBERAL_ARTS_CREDIT_CAP = 52;

async function fetchApplicableRequirements(departmentId, admissionYear) {
  const [rows] = await pool.query(
    `SELECT id, category, required_credits, description, enrollment_type, min_course_count
     FROM curriculum_requirements
     WHERE department_id = ?
       AND (min_admission_year IS NULL OR ? >= min_admission_year)
       AND (max_admission_year IS NULL OR ? <= max_admission_year)`,
    [departmentId, admissionYear, admissionYear]
  );
  return rows;
}

// 1·2학년 전과는 일반 재학생과 동일한(완화 없는) 요건을 적용받는다 — 3·4학년 전과만
// 학칙시행규칙 제6조의 완화된 최소전공 48학점 대상 (db/seed/curriculum_requirements.json 설명 참고).
function resolveEffectiveEnrollmentType(student) {
  if (student.enrollment_type === 'MAJOR_CHANGE' && (student.major_change_grade == null || student.major_change_grade < 3)) {
    return null;
  }
  return student.enrollment_type;
}

// 전과(3·4학년)/편입생은 전공필수+전공선택 대신 완화된 통합 "전공"(48학점) 행 하나로 대체된다.
function selectRequirementRows(rows, effectiveEnrollmentType) {
  const generalRows = rows.filter((r) => r.enrollment_type === null);
  if (!effectiveEnrollmentType) return generalRows;

  const overrideRows = rows.filter((r) => r.enrollment_type === effectiveEnrollmentType);
  if (overrideRows.length === 0) return generalRows;

  return [...generalRows.filter((r) => r.category !== '전공필수' && r.category !== '전공선택'), ...overrideRows];
}

async function fetchRequiredCourseNames(requirementId) {
  const [rows] = await pool.query(
    'SELECT course_name FROM curriculum_required_courses WHERE requirement_id = ?',
    [requirementId]
  );
  return rows.map((r) => r.course_name);
}

async function fetchEarnedCreditsByCategory(studentId) {
  // getSummary(courseService.js)와 동일한 "F만 아니면 이수학점" 규칙 — 성적 미입력(진행 중)
  // 과목도 포함한다. letter_grade <> 'F'는 NULL에 대해 NULL(=false)로 평가되므로
  // IS NULL을 명시적으로 같이 걸어야 성적 미입력 행이 안 빠진다.
  const [rows] = await pool.query(
    `SELECT category, SUM(credits) AS credits
     FROM student_courses
     WHERE student_id = ? AND (letter_grade IS NULL OR letter_grade <> 'F')
     GROUP BY category`,
    [studentId]
  );
  const map = {};
  for (const row of rows) map[row.category] = Number(row.credits);
  return map;
}

async function fetchMatchedCourseNames(studentId, courseNames) {
  if (courseNames.length === 0) return [];
  const [rows] = await pool.query('SELECT DISTINCT name FROM student_courses WHERE student_id = ? AND name IN (?)', [
    studentId,
    courseNames,
  ]);
  return rows.map((r) => r.name);
}

async function getGraduationStatus(studentId) {
  const student = await studentService.findById(studentId);
  if (!student || !student.department_id) {
    const err = new Error('ONBOARDING_REQUIRED');
    err.code = 'ONBOARDING_REQUIRED';
    throw err;
  }

  const allRows = await fetchApplicableRequirements(student.department_id, student.admission_year);
  const effectiveEnrollmentType = resolveEffectiveEnrollmentType(student);
  const requirementRows = selectRequirementRows(allRows, effectiveEnrollmentType);

  // min_course_count가 있는 행은 졸업논문/졸업인증제처럼 "학점"이 아닌 "과목 이름 매칭"으로
  // 충족 여부를 판정하는 P/F 요건이라 학점 합산 로직에서 분리한다.
  const creditRows = requirementRows.filter((r) => r.min_course_count === null);
  const certificationRows = requirementRows.filter((r) => r.min_course_count !== null);

  const earnedByCategory = await fetchEarnedCreditsByCategory(studentId);

  let totalRequiredCredits = 0;
  let totalEarnedCredits = 0;
  let generalElectiveOverflow = earnedByCategory['일반선택'] || 0;
  const categories = [];

  // 교양필수+교양선택은 합산해서 52학점 상한을 적용한 뒤 총계에 한 번만 반영한다.
  // 카테고리별 표시(categories 배열)에는 상한 적용 전 원본 학점을 그대로 내려줘서
  // 화면에서 "실제로 몇 학점 들었는지"는 정확히 보이게 하고, 총계만 학칙대로 계산한다.
  const liberalArtsRows = creditRows.filter((r) => r.category === '교양필수' || r.category === '교양선택');
  const liberalArtsRaw = liberalArtsRows.reduce((sum, r) => sum + (earnedByCategory[r.category] || 0), 0);
  const liberalArtsRequired = liberalArtsRows.reduce((sum, r) => sum + Number(r.required_credits), 0);
  const liberalArtsCredited = Math.min(liberalArtsRaw, LIBERAL_ARTS_CREDIT_CAP);

  totalRequiredCredits += liberalArtsRequired;
  totalEarnedCredits += Math.min(liberalArtsCredited, liberalArtsRequired);
  generalElectiveOverflow += Math.max(0, liberalArtsCredited - liberalArtsRequired);
  for (const row of liberalArtsRows) {
    categories.push({
      category: row.category,
      requiredCredits: Number(row.required_credits),
      earnedCredits: earnedByCategory[row.category] || 0,
      requiredCourses: await fetchRequiredCourseNames(row.id),
    });
  }

  // 전공필수/전공선택(또는 전과·편입 완화 통합 "전공") — 상한 없이, 초과분은 그대로 일반선택으로 흘러감.
  for (const row of creditRows) {
    if (row.category === '교양필수' || row.category === '교양선택' || row.category === '일반선택') continue;

    const required = Number(row.required_credits);
    const earnedRaw =
      earnedByCategory[row.category] ??
      (row.category === '전공' ? (earnedByCategory['전공필수'] || 0) + (earnedByCategory['전공선택'] || 0) : 0);

    totalRequiredCredits += required;
    totalEarnedCredits += Math.min(earnedRaw, required);
    generalElectiveOverflow += Math.max(0, earnedRaw - required);
    categories.push({
      category: row.category,
      requiredCredits: required,
      earnedCredits: earnedRaw,
      requiredCourses: await fetchRequiredCourseNames(row.id),
    });
  }

  const generalElectiveRow = creditRows.find((r) => r.category === '일반선택');
  if (generalElectiveRow) {
    const required = Number(generalElectiveRow.required_credits);
    const credited = Math.min(required, generalElectiveOverflow);
    totalRequiredCredits += required;
    totalEarnedCredits += credited;
    categories.push({
      category: '일반선택',
      requiredCredits: required,
      earnedCredits: credited,
      requiredCourses: await fetchRequiredCourseNames(generalElectiveRow.id),
    });
  }

  const certifications = [];
  for (const row of certificationRows) {
    const requiredCourses = await fetchRequiredCourseNames(row.id);
    const matched = await fetchMatchedCourseNames(studentId, requiredCourses);
    certifications.push({
      category: row.category,
      description: row.description,
      requiredCourses,
      satisfied: matched.length >= row.min_course_count,
    });
  }

  return { totalRequiredCredits, totalEarnedCredits, categories, certifications };
}

module.exports = { getGraduationStatus };
