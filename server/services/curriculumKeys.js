/**
 * server/services/curriculumKeys.js
 * 교육과정 데이터를 학년도 사이에 이어 붙이기 위한 안정적인 식별자(rule_key / course_key) 생성 규칙.
 *
 * 요건·과목 행은 학년도(입학학번 범위)마다 따로 존재하고 재시딩할 때 DB id가 새로 매겨지므로
 * id로는 "같은 규정/같은 과목"을 가리킬 수 없다. 대신 시드 코드가 이 파일의 함수로 같은 입력에
 * 항상 같은 키를 계산해서 저장한다. db/migrate.js의 SQL 백필(CONCAT/CASE)은 이 규칙을 그대로
 * 옮긴 것이라, 규칙을 바꾸면 거기도 같이 고쳐야 한다.
 */

// 요건 카테고리 → 코드. curriculum_requirements.category(VARCHAR)의 실제 값 전부를 다룬다.
const CATEGORY_CODE = {
  전공필수: 'MAJOR_REQUIRED',
  전공선택: 'MAJOR_ELECTIVE',
  전공: 'MAJOR',
  교양필수: 'LIBERAL_REQUIRED',
  교양선택: 'LIBERAL_ELECTIVE',
  일반선택: 'GENERAL_ELECTIVE',
  졸업논문: 'THESIS',
  졸업인증제: 'CERTIFICATION',
  교직기본이수: 'TEACHING_BASIC',
};

// 학과·카테고리 구조가 학년도마다 달라도 비교할 수 있도록 챗봇/변경이력에서 쓰는 "합산" 키.
// (예: 어떤 해는 전공필수+전공선택 두 행, 어떤 해는 전공 한 행 — 둘 다 MAJOR_TOTAL로 묶인다.)
const DERIVED_RULE_CODES = {
  MAJOR_TOTAL: ['전공필수', '전공선택', '전공'],
  LIBERAL_TOTAL: ['교양필수', '교양선택'],
  GRAD_TOTAL: ['전공필수', '전공선택', '전공', '교양필수', '교양선택', '일반선택'],
};

function categoryCode(category) {
  return CATEGORY_CODE[category] || `OTHER:${category}`;
}

/**
 * 같은 (학과, 카테고리, 입학유형) 조합은 학번 범위가 겹치지 않는 한 개의 "논리적 규정"이다
 * (db/seed/curriculum_requirements.json 전체로 확인: 겹치는 범위 0건). 그래서 그 조합이 곧 규정 식별자다.
 * 입학유형이 없는 행(일반 요건)은 GENERAL로 표기한다.
 */
function buildRuleKey(departmentName, category, enrollmentType) {
  return `${departmentName}|${categoryCode(category)}|${enrollmentType || 'GENERAL'}`;
}

// 파생 규정(합산) 키 — 실제 행으로는 저장되지 않고 변경이력/조회에서만 쓴다.
function buildDerivedRuleKey(departmentName, derivedCode, enrollmentType) {
  return `${departmentName}|${derivedCode}|${enrollmentType || 'GENERAL'}`;
}

// 과목명 비교용 정규화: 표기 차이(공백, 가운뎃점 변형, 마침표/쉼표)만 흡수한다.
// graduationService.normalizeCourseName과 같은 취지지만 한자/전각 표기까지 한 번 더 모은다.
function normalizeCourseName(name) {
  return String(name || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·․‧ㆍ.,]/g, '');
}

/**
 * 과목 식별자. 학수번호가 있으면 그것이 가장 안정적인 연결 기준이고(학교가 부여한 번호),
 * 없으면(2025 광역계열 표 등 PDF에 번호가 없는 과목) 정규화한 과목명으로 대신한다.
 */
function buildCourseKey(courseCode, courseName) {
  const code = String(courseCode || '').trim();
  if (code) return `C:${code.toUpperCase()}`;
  return `N:${normalizeCourseName(courseName)}`;
}

module.exports = {
  CATEGORY_CODE,
  DERIVED_RULE_CODES,
  categoryCode,
  buildRuleKey,
  buildDerivedRuleKey,
  normalizeCourseName,
  buildCourseKey,
};
