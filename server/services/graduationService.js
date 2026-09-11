const pool = require('../db');
const studentService = require('./studentService');
const { FAILING_GRADES, getSupersededCourseIds } = require('./courseService');

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

// 교양 이수기준은 학년(major_change_grade)이 아니라 전과 "시점"으로 갈린다 — 이 시점 이전
// 전과자는 본인 학번(admission_year)과 무관하게 고정 학점을 적용해야 한다(db/schema.sql
// students.major_change_year/semester 컬럼 주석 참고, 웹정보서비스 실사례로 확인됨).
// "이전"의 정확한 경계(해당 학기 당일 전과자 포함 여부)는 학사지원과 공식 확인 전이라,
// 일단 문언 그대로 엄격하게 "그 학기 자체는 미포함"으로 해석해뒀다 — 확인되면 조정 필요.
const MAJOR_CHANGE_LIBERAL_ARTS_CUTOFF = { year: 2022, semester: 2 };
const MAJOR_CHANGE_FIXED_LIBERAL_ARTS_CREDITS = { 교양필수: 5, 교양선택: 24 };

function isBeforeMajorChangeLiberalArtsCutoff(student) {
  if (student.enrollment_type !== 'MAJOR_CHANGE') return false;
  if (student.major_change_year == null || student.major_change_semester == null) return false;

  const { year, semester } = MAJOR_CHANGE_LIBERAL_ARTS_CUTOFF;
  if (student.major_change_year !== year) return student.major_change_year < year;
  return student.major_change_semester < semester;
}

// 컷오프 이전 전과생만 교양필수/교양선택 필요학점을 고정값으로 덮어쓴다. 그 외 학생(일반
// 재학생, 편입생, 컷오프 이후 전과생)은 그대로 통과해 기존 학번 기준 로직이 유지된다.
function applyMajorChangeLiberalArtsOverride(rows, student) {
  if (!isBeforeMajorChangeLiberalArtsCutoff(student)) return rows;
  return rows.map((row) => {
    const fixedCredits = MAJOR_CHANGE_FIXED_LIBERAL_ARTS_CREDITS[row.category];
    return fixedCredits === undefined ? row : { ...row, required_credits: fixedCredits };
  });
}

// 전과(3·4학년)는 전공을 75→48로, 컷오프 이전이면 교양도 고정값(29)으로 완화받는다.
// 이 완화는 "졸업에 필요한 총 학점 자체가 줄어든다"는 뜻이 아니라 "전공·교양 최소 기준만
// 채우면 나머지는 어느 카테고리로 채워도 된다"는 뜻이라, 완화로 비는 만큼을 일반선택이
// 흡수해서 총 요구학점(전공+교양+일반선택 합)이 일반 재학생과 똑같이 유지돼야 한다.
// 이걸 안 해주면(2026-09-07 발견) 총 요구학점이 109~115학점으로(실제 136보다 21~27학점
// 적게) 계산되는 버그가 생긴다 — 일반 재학생 기준 총량(같은 학번의 전공+교양+일반선택
// 원래 값 합)을 구해서, 전공·교양이 줄어든 만큼만 일반선택에 더 얹어준다.
function applyMajorChangeGeneralElectiveOverride(rows, allRows, effectiveEnrollmentType) {
  if (effectiveEnrollmentType !== 'MAJOR_CHANGE') return rows;

  const generalRows = allRows.filter((r) => r.enrollment_type === null);
  const totalDegreeCredits = generalRows.reduce((sum, r) => sum + Number(r.required_credits), 0);

  const majorRequired = rows
    .filter((r) => r.category === '전공필수' || r.category === '전공선택' || r.category === '전공')
    .reduce((sum, r) => sum + Number(r.required_credits), 0);
  const liberalArtsRequired = rows
    .filter((r) => r.category === '교양필수' || r.category === '교양선택')
    .reduce((sum, r) => sum + Number(r.required_credits), 0);

  const adjustedGeneralElective = totalDegreeCredits - majorRequired - liberalArtsRequired;

  return rows.map((row) =>
    row.category === '일반선택' ? { ...row, required_credits: adjustedGeneralElective } : row
  );
}

async function fetchRequiredCourseNames(requirementId) {
  const [rows] = await pool.query(
    'SELECT course_name FROM curriculum_required_courses WHERE requirement_id = ?',
    [requirementId]
  );
  return rows.map((r) => r.course_name);
}

async function fetchEarnedCreditsByCategory(studentId) {
  // 성적 미입력(진행 중) 과목도 포함한다. letter_grade NOT IN (...)은 NULL에 대해
  // NULL(=false)로 평가되므로 IS NULL을 명시적으로 같이 걸어야 성적 미입력 행이 안 빠진다.
  //
  // 재수강으로 대체된 이전 학기 기록(courseService.getSupersededCourseIds — 같은 과목명 중
  // 최신 학기 것만 남김)도 여기서 같이 제외해야 카테고리별 이수학점이 중복 집계되지 않는다.
  const supersededIds = await getSupersededCourseIds(studentId);
  let sql = `SELECT category, SUM(credits) AS credits
     FROM student_courses
     WHERE student_id = ? AND (letter_grade IS NULL OR letter_grade NOT IN (?))`;
  const params = [studentId, FAILING_GRADES];
  if (supersededIds.size > 0) {
    sql += ' AND id NOT IN (?)';
    params.push([...supersededIds]);
  }
  sql += ' GROUP BY category';

  const [rows] = await pool.query(sql, params);
  const map = {};
  for (const row of rows) map[row.category] = Number(row.credits);
  return map;
}

// curriculum_required_courses(학과 문서 기준 요구과목명)와 course_offerings(실제 개설과목
// 카탈로그) 표기가 구두점만 다른 경우가 있다 — 예: "졸업(시험·작품)논문"(가운뎃점, 학과
// 문서) vs "졸업(시험.작품)논문"(마침표, 카탈로그. 학생이 카탈로그에서 선택하면 이 표기가
// 그대로 student_courses.name에 저장됨). SQL 완전일치로는 두 표기가 영원히 안 맞는다 —
// 구두점·공백을 지우고 비교해 표기 차이를 흡수한다.
function normalizeCourseName(name) {
  return name.replace(/[·.,\s]/g, '');
}

// "기업연계프로젝트2(종합설계2)"처럼 뒤에 괄호로 옛 과목명/별칭을 병기하는 요구과목이 있다
// (학칙 원문 자체가 두 이름을 병기 — db/seed/curriculum_requirements.json 165행 note 참고).
// 학생이 직접입력으로 등록할 때 괄호 안쪽 별칭을 안 쓰고 "기업연계프로젝트2"까지만 적어도
// (실사용 확인 — 카탈로그에 해당 학기 항목이 안 잡혀 직접입력으로 우회한 경우) 똑같은
// 과목으로 인정해야 한다. 괄호를 통째로 지우는 게 아니라 "끝에 붙은 괄호"만 벗겨서 별도
// 변형으로 추가하는 이유: normalizeCourseName처럼 무조건 괄호를 지워버리면 "건학이념"/
// "대학생활"같이 부분 문자열로 흔한 다른 과목명(예: "대학생활과자기혁신")과 뒤섞일 위험이
// 있는 임의 부분일치보다, 요구과목명 쪽에서 "알려진 표기 변형"만 명시적으로 허용하는 편이
// 안전하다.
// 임의 약칭까지 다 받아주진 않는다(위 주석 참고 — 부분일치는 다른 과목과 오매칭 위험).
// 대신 "이 학과 학생들이 실제로 흔히 쓰고, 다른 과목과 헷갈릴 여지가 없는" 약칭만 화이트
// 리스트로 명시 등록한다. 새 약칭이 필요하면 여기 추가할 것 — 요구과목명(정식 표기) 키를
// 정확히 맞춰야 한다(courseNameVariants가 이 목록을 정식 표기 원문 기준으로 조회함).
const KNOWN_COURSE_ALIASES = {
  '기업연계프로젝트1(종합설계1)': ['기연프1'],
  '기업연계프로젝트2(종합설계2)': ['기연프2'],
};

function courseNameVariants(name) {
  const full = normalizeCourseName(name);
  const variants = new Set([full]);

  const withoutTrailingParen = normalizeCourseName(name.replace(/\([^)]*\)\s*$/, ''));
  if (withoutTrailingParen && withoutTrailingParen !== full) variants.add(withoutTrailingParen);

  for (const alias of KNOWN_COURSE_ALIASES[name] || []) variants.add(normalizeCourseName(alias));

  return [...variants];
}

async function fetchMatchedCourseNames(studentId, courseNames, { requirePass = false } = {}) {
  if (courseNames.length === 0) return [];
  const normalizedRequired = new Set(courseNames.flatMap(courseNameVariants));

  const [rows] = await pool.query('SELECT name, letter_grade FROM student_courses WHERE student_id = ?', [
    studentId,
  ]);

  const matched = new Set();
  for (const row of rows) {
    if (matched.has(row.name) || !normalizedRequired.has(normalizeCourseName(row.name))) continue;
    // 졸업논문은 학칙시행규칙 제51조⑤에 따라 P/F로만 평가되므로 반드시 P여야 충족.
    // 그 외(졸업인증제 등 일반 등급제 과목)는 기존처럼 F/NP만 아니면 충족 —
    // 수강만 하고 불합격한 과목이 요건을 충족시키면 안 됨.
    const passed = requirePass
      ? row.letter_grade === 'P'
      : row.letter_grade === null || !FAILING_GRADES.includes(row.letter_grade);
    if (passed) matched.add(row.name);
  }
  return [...matched];
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
  const requirementRows = applyMajorChangeGeneralElectiveOverride(
    applyMajorChangeLiberalArtsOverride(selectRequirementRows(allRows, effectiveEnrollmentType), student),
    allRows,
    effectiveEnrollmentType
  );

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

  // 전공필수(기본전공)+전공선택은 학칙상 별개 요건이 아니라 "기본전공 19학점 이상 + 선택전공
  // 이수, 계 75학점"이라는 하나의 풀이다 (db/regulations/졸업/이수학점_총괄표.md 2절 원문 —
  // 기본전공은 "이상"이라는 하한선일 뿐, 전공선택 쪽에 별도로 56학점 하한이 있는 게 아님).
  // 그래서 기본전공을 초과 이수하면 그 초과분이 전공선택 쪽 부족분을 그대로 상쇄해야 하고,
  // 풀 전체(75)를 넘긴 진짜 초과분만 일반선택으로 흘러간다 — 예전엔 두 카테고리를 각자
  // 독립적으로 상한 적용해서, 기본전공 초과분이 전공선택 부족분을 하나도 못 줄이고 엉뚱하게
  // 일반선택으로만 새서 "총 이수학점"과 "카테고리별 부족 학점 합"이 서로 안 맞는 문제가 있었다
  // (실사용 확인: 총계는 27학점 남았다는데 전공 부족은 20학점으로 따로 표시됨).
  // 전과(3·4학년)/편입 완화 시엔 이미 통합 "전공"(48학점) 행 하나뿐이라 자연히 풀 하나로 처리됨.
  const majorRows = creditRows.filter(
    (r) => r.category === '전공필수' || r.category === '전공선택' || r.category === '전공'
  );
  if (majorRows.length > 0) {
    const getMajorRowEarnedRaw = (row) =>
      earnedByCategory[row.category] ??
      (row.category === '전공' ? (earnedByCategory['전공필수'] || 0) + (earnedByCategory['전공선택'] || 0) : 0);

    const majorRequired = majorRows.reduce((sum, r) => sum + Number(r.required_credits), 0);
    const majorEarnedRaw = majorRows.reduce((sum, r) => sum + getMajorRowEarnedRaw(r), 0);

    totalRequiredCredits += majorRequired;
    totalEarnedCredits += Math.min(majorEarnedRaw, majorRequired);
    generalElectiveOverflow += Math.max(0, majorEarnedRaw - majorRequired);

    for (const row of majorRows) {
      categories.push({
        category: row.category,
        requiredCredits: Number(row.required_credits),
        earnedCredits: getMajorRowEarnedRaw(row),
        requiredCourses: await fetchRequiredCourseNames(row.id),
      });
    }
  }

  // 전공/교양/일반선택 외 다른 학점 카테고리가 생기면(현재는 없음) 기존처럼 카테고리별 독립 상한.
  for (const row of creditRows) {
    if (['교양필수', '교양선택', '일반선택', '전공필수', '전공선택', '전공'].includes(row.category)) continue;

    const required = Number(row.required_credits);
    const earnedRaw = earnedByCategory[row.category] || 0;

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
    const matched = await fetchMatchedCourseNames(studentId, requiredCourses, {
      requirePass: row.category === '졸업논문',
    });
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
