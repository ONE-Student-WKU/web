const pool = require('../db');
const studentService = require('./studentService');
const { FAILING_GRADES, getSupersededCourseIds } = require('./courseService');
const { resolveRequirementsForStudent, inputFromStudentRow } = require('./regulationEngine');

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
    ...certifications.map((c) => ({ category: c.category, required_credits: 0, description: c.description, min_course_count: c.minCourseCount, requiredCourses: c.requiredCourses || [] })),
  ];
}

// 교양 인정 상한. 엔진은 2021학번 이하에 대해 근거가 갈려(책자: 상한 없음 / 시행규칙 제10조①: 52) "상한 없음(추정)"과
// 대안 52를 함께 낸다. 졸업진단은 그중 더 엄격한(작은) 값을 쓴다 — 학점을 덜 인정하는 쪽은 틀려도 "졸업 가능"을 잘못
// 알려주는 사고로 이어지지 않기 때문이다(보수적 선택, D-32). null이면 상한 없음.
function liberalArtsCapForDiagnosis(capRule) {
  if (!capRule || !capRule.value) return null;
  const caps = [capRule.value.cap, ...(capRule.alternatives || []).map((a) => a.cap)].filter((c) => c != null);
  return caps.length ? Math.min(...caps) : null;
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

  const earnedByCategory = await fetchEarnedCreditsByCategory(studentId);

  let totalRequiredCredits = 0;
  let totalEarnedCredits = 0;
  let generalElectiveOverflow = earnedByCategory['일반선택'] || 0;
  const categories = [];

  // 교양필수+교양선택은 합산해서 인정 상한(liberalArtsCap, 보통 52학점)을 적용한 뒤 총계에 한 번만 반영한다.
  // 카테고리별 표시(categories 배열)에는 상한 적용 전 원본 학점을 그대로 내려줘서
  // 화면에서 "실제로 몇 학점 들었는지"는 정확히 보이게 하고, 총계만 학칙대로 계산한다.
  const liberalArtsRows = creditRows.filter((r) => r.category === '교양필수' || r.category === '교양선택');
  const liberalArtsRaw = liberalArtsRows.reduce((sum, r) => sum + (earnedByCategory[r.category] || 0), 0);
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

  const certifications = [];
  for (const row of certificationRows) {
    const { requiredCourses } = row;
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

  // regulation: 이 진단의 근거 신뢰도와 사유(엔진 플래그). 화면·챗봇이 "확정/추정/자료없음"을 표시하는 데 쓴다.
  // 기존 필드(totalRequiredCredits/totalEarnedCredits/categories/certifications)는 모양이 그대로라 기존 화면은 영향이 없다.
  return {
    totalRequiredCredits,
    totalEarnedCredits,
    categories,
    certifications,
    regulation: {
      confidence: regulation.confidence,
      confidenceLabel: regulation.confidenceLabel,
      flags: (regulation.flags || []).map((f) => ({ code: f.code, level: f.level, message: f.message })),
      liberalArtsCap: { applied: liberalArtsCap, engineValue: capRule && capRule.value ? capRule.value.cap : null },
      totalDefinitive: !(regulation.flags || []).some((f) => f.code === 'TRANSFER_TOTAL_UNRESOLVED'),
    },
  };
}

module.exports = { getGraduationStatus };
