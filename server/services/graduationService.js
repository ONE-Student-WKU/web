const pool = require('../db');
const studentService = require('./studentService');
const { FAILING_GRADES, getSupersededCourseIds } = require('./courseService');
const { resolveRequirementsForStudent, inputFromStudentRow } = require('./regulationEngine');
const { classifyByRegistration, applyAdjustments } = require('./regulationEngine/registrationCategory');
const { makeFlag, confidenceFromFlags, worstConfidence } = require('./regulationEngine/flags');
const { CONFIDENCE_LABEL_KO } = require('./regulationEngine/constants');
const { loadCategoryChanges } = require('./regulationEngine/dbProvider');
const { getDepartmentChain } = require('./curriculumHistoryService');
const { normalizeCourseName, courseNameVariants } = require('./courseNameMatch');
const { counselingRequirement } = require('./counseling');
const { evaluateLiberalRequiredAreas } = require('./liberalRequiredAreas');
const { majorAreaOf } = require('./categoryMap');
const { loadDesignatedMajorCourses, DESIGNATED_MAJOR_COURSE_DEPARTMENTS } = require('./designatedMajorCourses');
const { isTeacherCollegeDepartment, parseTeachingCourse, canTakeTeachingCourse } = require('./teachingCourse');

/**
 * server/services/graduationService.js
 * 졸업요건 진단 — curriculum_requirements(학과·학번·전형별 요건)와 student_courses(실제 이수)를
 * 조합해 카테고리별 이수 현황 및 졸업논문/졸업인증제 같은 P/F 요건 충족 여부를 계산한다.
 */

// 졸업요건 행(학과·학번·입학유형별 카테고리 학점, 전과·편입 완화, 전과 교양 29학점 컷오프, 일반선택 재배분)과 교양 인정 상한은
// 규정 판단 엔진(server/services/regulationEngine)이 정한다 — 예전에는 이 파일에 하드코딩 분기(2022-2학기 컷오프 상수,
// 3·4학년 전과 판정, 52학점 상한)로 있었는데, 같은 규칙이 엔진에도 있어 두 곳이 어긋날 위험이 있었다(파트 3, DECISIONS D-32).
// 이 파일은 이제 "요건 행 + 학생 이수 내역 → 이수 현황" 계산만 맡는다.

// 엔진 결과(REQUIREMENTS 규칙 값) → 아래 계산이 쓰는 행 모양. 자료가 없으면(NO_DATA) 빈 배열 — 다른 학번 값으로 채우지 않는다.
function requirementRowsFromJudgment(requirementsRule) {
  if (!requirementsRule || !requirementsRule.value) return [];
  const { categories, certifications } = requirementsRule.value;
  return [
    ...categories.map((c) => ({ category: c.category, required_credits: c.requiredCredits, description: c.description, min_course_count: null, requiredCourses: c.requiredCourses || [] })),
    ...certifications.map((c) => ({ category: c.category, required_credits: 0, description: c.description, min_course_count: c.minCourseCount, requiredCourses: c.requiredCourses || [], conditionalExemption: c.conditionalExemption || null })),
  ];
}

// 교양 인정 상한. 엔진 판단(2021학번 이하 상한 없음, 2022학번부터 52 — 학교 홈페이지·책자 근거, D-51)을 그대로 쓴다.
// 예전에는 근거가 책자 한 곳이라 시행규칙 문언의 52를 대안으로 함께 받아 더 엄격한 값을 썼지만(D-32), 지금은 대안이 없다.
// 엔진이 나중에 다시 근거가 갈리는 대안(alternatives)을 내면 더 엄격한(작은) 값을 쓰도록 남겨 둔다 — 학점을 덜 인정하는
// 쪽은 틀려도 "졸업 가능"을 잘못 알려주는 사고로 이어지지 않기 때문이다. null이면 상한 없음.
function liberalArtsCapForDiagnosis(capRule) {
  if (!capRule || !capRule.value) return null;
  const caps = [capRule.value.cap, ...(capRule.alternatives || []).map((a) => a.cap)].filter((c) => c != null);
  return caps.length ? Math.min(...caps) : null;
}

async function fetchCountedCourses(studentId) {
  // 성적 미입력(진행 중) 과목도 포함한다. letter_grade NOT IN (...)은 NULL에 대해
  // NULL(=false)로 평가되므로 IS NULL을 명시적으로 같이 걸어야 성적 미입력 행이 안 빠진다.
  //
  // 재수강으로 대체된 이전 학기 기록(courseService.getSupersededCourseIds — 같은 과목명 중
  // 최신 학기 것만 남김)도 여기서 같이 제외해야 카테고리별 이수학점이 중복 집계되지 않는다.
  const supersededIds = await getSupersededCourseIds(studentId);
  let sql = `SELECT id, name, category, credits, year, semester, major_area
     FROM student_courses
     WHERE student_id = ? AND (letter_grade IS NULL OR letter_grade NOT IN (?))`;
  const params = [studentId, FAILING_GRADES];
  if (supersededIds.size > 0) {
    sql += ' AND id NOT IN (?)';
    params.push([...supersededIds]);
  }
  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * 광역 계열전공의 이수구분별 학점(시행규칙 제7조 제3항 — 기초·심화·응용, #378 E-3). 순수 함수.
 * 과목의 구분은 저장된 원래 구분(student_courses.major_area — 성적표·개설과목)을 먼저 쓰고, 없으면(직접입력·옛 기록) 학과 편성표에서
 * 과목명으로 찾는다(결정 3-3 A). 둘 다 없으면 "구분을 모르는 학점"으로 따로 센다 — 어느 구분에도 넣지 않는다.
 * @param {{ 기초, 심화, 응용 }} minimums  엔진이 낸 최소 학점
 * @param {Array<{ name, category, credits, major_area }>} courses  졸업 학점으로 세는 과목(재수강 이전 기록·F 제외)
 * @param {Map<string, string>} areaByName  편성표 과목명(정규화) → 구분
 */
function computeMajorAreaCredits(minimums, courses, areaByName) {
  const earned = { 기초: 0, 심화: 0, 응용: 0 };
  let unknownCredits = 0;
  for (const c of courses) {
    if (c.category !== '전공필수' && c.category !== '전공선택') continue;
    const area = c.major_area || areaByName.get(normalizeCourseName(c.name)) || null;
    if (area && area in earned) earned[area] += Number(c.credits);
    else unknownCredits += Number(c.credits);
  }
  const areas = Object.keys(earned).map((area) => ({ area, required: minimums[area], earned: earned[area], satisfied: earned[area] >= minimums[area] }));
  return { areas, unknownCredits, satisfied: areas.every((a) => a.satisfied) };
}

/** 학과 편성표의 과목명 → 구분(기초·심화·응용). 같은 이름이 여러 학번에 있으면 처음 찾은 구분. */
async function loadMajorAreaByName(departmentId) {
  const [rows] = await pool.query('SELECT course_name, category FROM curriculum_courses WHERE department_id = ?', [departmentId]);
  const map = new Map();
  for (const r of rows) {
    const area = majorAreaOf(r.category);
    const key = normalizeCourseName(r.course_name);
    if (area && !map.has(key)) map.set(key, area);
  }
  return map;
}

function sumByCategory(rows) {
  const map = {};
  for (const row of rows) map[row.category] = (map[row.category] || 0) + Number(row.credits);
  return map;
}

// 졸업인증제 행의 요구 과목은 학교 안내의 "분류 이름"(캡스톤디자인, 종합설계, 전공현장실습, 사회봉사…)이다. 실제 과목명은
// 캡스톤디자인1, 회계실무(캡스톤디자인), 전기공학종합설계1처럼 그 이름을 포함하는 형태라 완전일치로는 64개 학과에서 영원히
// 미충족이 됐다(GRADUATION_AUDIT_2026-10-12 4절) — 이 갈래만 "이름을 포함하면 인정"으로 본다. 졸업논문·교직기본이수는
// 요구 과목이 정확한 과목명 목록이라(예: 국어사 vs 국어사회언어학) 포함 비교를 쓰면 다른 과목과 섞이므로 그대로 완전일치.
const CONTAINS_MATCH_CATEGORIES = new Set(['졸업인증제']);
// 교직기본이수는 교원자격(교직과정 이수자) 요건이지 모든 학생의 졸업요건이 아니다(시행규칙 제11조 → 교원양성과정 운영 내규).
// 학생이 교직과정 이수 여부(students.teaching_course)에 답하지 않았으면 결과에 싣되 optional로 표시해 화면·챗봇이 졸업 부족 요건에
// 넣지 않게 한다. "이수 중"이면 실제 요건으로, "이수 안 함"이면 결과에서 뺀다(D-67).
const OPTIONAL_CERTIFICATION_CATEGORIES = new Set(['교직기본이수']);

// 이수로 인정되는 성적인가. 졸업논문은 P/F 과목으로 편성되지만 시행규칙 제62조 제5항·제124조 제2항은 A·B·C(불합격 F)로
// 판정하도록 적고 있어, 어느 쪽으로 찍혀도 합격으로 본다 — 성적이 아직 없으면(진행 중) 합격 판정 전이다.
// 그 외(졸업인증제 등)는 기존처럼 F/NP만 아니면 충족(성적 미입력 = 수강 중도 인정).
function isPassingRow(row, { requireGrade }) {
  if (row.letter_grade == null) return !requireGrade;
  return !FAILING_GRADES.includes(row.letter_grade);
}

/**
 * P/F·과목 매칭 요건(졸업논문·졸업인증제·교직기본이수) 판정. 순수 함수.
 * 충족 기준은 "요구 과목 중 서로 다른 몇 개를 이수했나"다 — 예전에는 매칭된 학생 과목 수를 세서, 2과목 필수
 * [전공현장실습, 캡스톤디자인]을 캡스톤디자인1·2 두 과목만으로 채운 것처럼 보일 수 있었다.
 * @param {Array<{ category, description, min_course_count, requiredCourses }>} certificationRows
 * @param {Array<{ name, letter_grade }>} courseRows 학생의 모든 수강 기록(재수강 이전 기록 포함 — 한 번이라도 합격했으면 충족)
 * @param {{ teachingCourse?: boolean|null }} [options] 교직과정 이수 여부(true/false/null = 답하지 않음)
 */
function evaluateCertifications(certificationRows, courseRows, { teachingCourse = null } = {}) {
  const rows = teachingCourse === false
    ? certificationRows.filter((row) => !OPTIONAL_CERTIFICATION_CATEGORIES.has(row.category))
    : certificationRows;
  return rows.map((row) => {
    const { requiredCourses } = row;
    const contains = CONTAINS_MATCH_CATEGORIES.has(row.category);
    const passedNames = courseRows
      .filter((c) => isPassingRow(c, { requireGrade: row.category === '졸업논문' }))
      .map((c) => normalizeCourseName(c.name));
    const satisfiedItems = requiredCourses.filter((required) =>
      courseNameVariants(required).some((variant) =>
        passedNames.some((name) => (contains ? name.includes(variant) : name === variant))
      )
    );
    return {
      category: row.category,
      description: row.description,
      requiredCourses,
      satisfied: satisfiedItems.length >= row.min_course_count,
      ...(OPTIONAL_CERTIFICATION_CATEGORIES.has(row.category) && teachingCourse !== true ? { optional: true } : {}),
      // 학사편입학자 등은 면제인 대학 공통 졸업인증제(편입 종류를 입력받지 않아 부족 요건에는 남기고 안내만 붙인다).
      ...(row.conditionalExemption ? { conditionalExemption: row.conditionalExemption } : {}),
    };
  });
}

/**
 * 요건 행 + 구분별 이수학점 → 이수 현황(총계·카테고리별). 순수 함수 — DB 없이 학과·학번 조합을 전수 검증할 수 있게 분리했다.
 * @param {Array} creditRows  min_course_count가 없는 요건 행({ category, required_credits, requiredCourses })
 * @param {Object<string, number>} earnedByCategory  구분별 이수학점(제13조④ 조정 반영 후)
 * @param {number|null} liberalArtsCap  교양 인정 상한(null = 없음)
 */
function computeCreditStatus(creditRows, earnedByCategory, liberalArtsCap) {
  let totalRequiredCredits = 0;
  let totalEarnedCredits = 0;
  let generalElectiveOverflow = earnedByCategory['일반선택'] || 0;
  const categories = [];

  // 교양필수+교양선택은 합산해서 인정 상한(liberalArtsCap, 보통 52학점)을 적용한 뒤 총계에 한 번만 반영한다.
  // 카테고리별 표시(categories 배열)에는 상한 적용 전 원본 학점을 그대로 내려줘서
  // 화면에서 "실제로 몇 학점 들었는지"는 정확히 보이게 하고, 총계만 학칙대로 계산한다.
  const liberalArtsRows = creditRows.filter((r) => r.category === '교양필수' || r.category === '교양선택');
  // 교양 이수학점은 요건 행이 없어도 센다 — 3·4학년 편입생처럼 교양 영역 기준을 충족한 것으로 보는 경우(교양 행 없음) 본교에서 들은
  // 교양은 자유선택(일반선택)으로 흘러가야 한다. 행이 있는 학과에서는 예전 계산과 같다(교양필수·교양선택 행은 늘 함께 있다).
  const liberalArtsRaw = (earnedByCategory['교양필수'] || 0) + (earnedByCategory['교양선택'] || 0);
  const liberalArtsRequired = liberalArtsRows.reduce((sum, r) => sum + Number(r.required_credits), 0);
  const liberalArtsCredited = liberalArtsCap == null ? liberalArtsRaw : Math.min(liberalArtsRaw, liberalArtsCap);

  totalRequiredCredits += liberalArtsRequired;
  totalEarnedCredits += Math.min(liberalArtsCredited, liberalArtsRequired);
  generalElectiveOverflow += Math.max(0, liberalArtsCredited - liberalArtsRequired);
  for (const row of liberalArtsRows) {
    categories.push({
      category: row.category,
      requiredCredits: Number(row.required_credits),
      earnedCredits: earnedByCategory[row.category] || 0,
      requiredCourses: row.requiredCourses,
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
        requiredCourses: row.requiredCourses,
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
      requiredCourses: row.requiredCourses,
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
      requiredCourses: generalElectiveRow.requiredCourses,
    });
  }

  return { totalRequiredCredits, totalEarnedCredits, categories };
}

async function getGraduationStatus(studentId) {
  const student = await studentService.findById(studentId);
  if (!student || !student.department_id) {
    const err = new Error('ONBOARDING_REQUIRED');
    err.code = 'ONBOARDING_REQUIRED';
    throw err;
  }

  // 기준일 = 오늘(KST). 학생 행(학과·학번·입학유형·전과 학년/시점)을 그대로 엔진 입력으로 쓴다.
  const regulation = await resolveRequirementsForStudent(inputFromStudentRow(student));
  const requirementsRule = (regulation.rules || []).find((r) => r.id === 'REQUIREMENTS');
  const capRule = (regulation.rules || []).find((r) => r.id === 'LIBERAL_ARTS_CAP');
  const requirementRows = requirementRowsFromJudgment(requirementsRule);
  const liberalArtsCap = liberalArtsCapForDiagnosis(capRule);

  // min_course_count가 있는 행은 졸업논문/졸업인증제처럼 "학점"이 아닌 "과목 이름 매칭"으로
  // 충족 여부를 판정하는 P/F 요건이라 학점 합산 로직에서 분리한다.
  const creditRows = requirementRows.filter((r) => r.min_course_count === null);
  const certificationRows = requirementRows.filter((r) => r.min_course_count !== null);

  // 제13조④(수강 학년도 기준 이수구분)로 다시 본 과목은 학점을 옮겨 합산한다(registrationCategory.js, D-46). 옮긴 과목은 결과에 그대로 싣는다.
  const countedCourses = await fetchCountedCourses(studentId);
  const { changes: categoryChanges, overrides: categoryOverrides } = await loadCategoryChanges((await getDepartmentChain(student.department_id)).departmentIds);
  const registration = classifyByRegistration(countedCourses, categoryChanges, categoryOverrides);
  const earnedByCategory = applyAdjustments(sumByCategory(countedCourses), registration.adjusted);
  const registrationFlags = [
    ...(registration.adjusted.length ? [makeFlag('REGISTRATION_CATEGORY_APPLIED')] : []),
    ...(registration.unresolved.length ? [makeFlag('REGISTRATION_CATEGORY_NOT_COMPARABLE')] : []),
  ];

  const { totalRequiredCredits, totalEarnedCredits, categories: creditCategories } = computeCreditStatus(creditRows, earnedByCategory, liberalArtsCap);

  // 졸업논문·졸업인증제·교양필수 영역 판정은 재수강 이전 기록까지 모든 수강 기록으로 본다(한 번이라도 합격했으면 충족).
  const needsAllCourses = certificationRows.length > 0 || creditCategories.some((c) => c.category === '교양필수')
    || DESIGNATED_MAJOR_COURSE_DEPARTMENTS.includes(student.department_name);
  const [allCourseRows] = needsAllCourses
    ? await pool.query('SELECT name, letter_grade FROM student_courses WHERE student_id = ?', [studentId])
    : [[]];
  // 교양필수는 학점 합계만으로는 모자라다 — 영역(건학이념·대학생활·전공탐색과진로) 과목을 실제로 들었는지 함께 싣는다(liberalRequiredAreas.js).
  const passedNames = allCourseRows.filter((c) => isPassingRow(c, { requireGrade: false })).map((c) => c.name);
  const categories = creditCategories.map((c) => {
    if (c.category !== '교양필수') return c;
    const areas = evaluateLiberalRequiredAreas(c.requiredCourses, passedNames);
    return areas ? { ...c, areas } : c;
  });
  // 광역 계열전공이면 기초·심화·응용 학점을 센다(엔진이 최소 학점을 냈을 때만 — 완화 받은 전과·편입은 null).
  const areaMinimums = requirementsRule && requirementsRule.value ? requirementsRule.value.majorAreaMinimums : null;
  const majorAreaCredits = areaMinimums
    ? computeMajorAreaCredits(areaMinimums, countedCourses, await loadMajorAreaByName(student.department_id))
    : null;
  // 시행규칙 제9조 제1호 학과(의·치·한의·약·간호·응급구조·보건의료 7개 학과)의 지정 전공 과목 — 판정하지 않고 편성표 목록만 안내한다.
  const designatedMajorCourses = await loadDesignatedMajorCourses(student, passedNames);
  // 편입생·3학년 이상 전과생은 교직과정을 이수할 수 없어 "이수 안 함"과 같다(교직기본이수를 참고 항목으로도 보이지 않는다).
  const teachingAllowed = canTakeTeachingCourse({ enrollmentType: student.enrollment_type, majorChangeGrade: student.major_change_grade });
  const teachingCourse = teachingAllowed ? parseTeachingCourse(student.teaching_course) : false;
  const certifications = evaluateCertifications(certificationRows, allCourseRows, { teachingCourse });
  // 사범대학은 졸업인증제 기본영역을 교직으로 대체한 것으로 시드에 행이 없다. 교직을 포기했다고 답하면 그 가정이 깨진다(D-67).
  const teachingFlags = teachingAllowed && teachingCourse === false && isTeacherCollegeDepartment(student.department_name)
    ? [makeFlag('TEACHER_COLLEGE_TEACHING_DROPPED')]
    : [];
  const extraFlags = [...registrationFlags, ...teachingFlags];
  const confidence = worstConfidence([regulation.confidence, confidenceFromFlags(extraFlags)]);

  // regulation: 이 진단의 근거 신뢰도와 사유(엔진 플래그). 화면·챗봇이 "확정/추정/자료없음"을 표시하는 데 쓴다.
  // 기존 필드(totalRequiredCredits/totalEarnedCredits/categories/certifications)는 모양이 그대로라 기존 화면은 영향이 없다.
  return {
    totalRequiredCredits,
    totalEarnedCredits,
    categories,
    certifications,
    // 자기계발심층상담(졸업인증제) 기준 — 판정하지 않고 기준·확인 경로만 안내한다(counseling.js, D-65). 화면과 챗봇이 같이 쓴다.
    counseling: counselingRequirement(student),
    // 지정 전공 과목 안내(시행규칙 제9조 제1호 학과만, 그 외 null) — designatedMajorCourses.js
    designatedMajorCourses,
    // 광역 계열전공의 이수구분별 학점(시행규칙 제7조 제3항) { areas: [{ area, required, earned, satisfied }], unknownCredits, satisfied } | null
    majorAreaCredits,
    // 광역 계열전공 이수유형(students.major_track_type) — 화면이 어떤 유형 기준인지 적는 데 쓴다.
    majorTrackType: student.major_track_type || null,
    regulation: {
      confidence,
      confidenceLabel: confidence === regulation.confidence ? regulation.confidenceLabel : CONFIDENCE_LABEL_KO[confidence],
      flags: [...(regulation.flags || []), ...extraFlags].map((f) => ({ code: f.code, level: f.level, message: f.message })),
      // 제13조④: 입력한 이수구분과 수강 학년도 기준 이수구분이 달라 학점을 옮긴 과목(adjusted)과, 필수/선택 해석이 없어 옮기지 않은 과목(unresolved).
      registrationCategory: { adjusted: registration.adjusted, unresolved: registration.unresolved },
      liberalArtsCap: { applied: liberalArtsCap, engineValue: capRule && capRule.value ? capRule.value.cap : null },
      // 편입생 총량은 인정학점을 가정해 계산했어도(TRANSFER_RECOGNIZED_CREDITS_ASSUMED) 전적대학 취득학점에 따라 달라지므로 확정이 아니다.
      totalDefinitive: !(regulation.flags || []).some((f) => f.code === 'TRANSFER_TOTAL_UNRESOLVED' || f.code === 'TRANSFER_RECOGNIZED_CREDITS_ASSUMED'),
      // 학칙 [별표 4] 졸업학점과 책자 졸업학점이 다를 때 두 값(어느 쪽이 맞는지는 학교 확인 전이라 판단하지 않음). 같거나 대조 불가면 null.
      schedule4: requirementsRule && requirementsRule.value ? requirementsRule.value.schedule4 : null,
      // 2025학번 이하의 요건은 최신 책자(2026)의 학번별 이수기준표 값이다(엔진 LATEST_BOOKLET_COHORT_TABLE). 화면이 "어느 책자 기준인지"를 적는 데 쓴다. 해당 없으면 null.
      basisBookletYear: ((regulation.flags || []).find((f) => f.code === 'LATEST_BOOKLET_COHORT_TABLE') || {}).latestBookletYear ?? null,
    },
  };
}

module.exports = { getGraduationStatus, computeCreditStatus, computeMajorAreaCredits, evaluateCertifications, requirementRowsFromJudgment, liberalArtsCapForDiagnosis };
