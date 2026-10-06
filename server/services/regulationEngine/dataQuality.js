const { CONFIDENCE } = require('./constants');

/**
 * server/services/regulationEngine/dataQuality.js
 * 파트 1 데이터 검수 결과(docs/regulation-engine/DATA_AUDIT.md §4 등급, §2-3 판단 보류)를 엔진 입력으로 옮긴 설정.
 *
 * 왜 DB 컬럼이 아니라 코드 설정인가(DECISIONS D-27): 등급은 "행 하나"가 아니라 "학년도 × 영역" 단위이고, 값이 바뀌는 계기는
 * 사람이 하는 검수(문서 갱신)라서 재시딩과 무관하다. 컬럼에 두면 재시딩 크론이 행을 지우고 다시 넣을 때마다 등급을 같이
 * 다시 넣어야 하고, 등급 근거(DATA_AUDIT 문단)와 값이 떨어져 리뷰가 어렵다. 여기 값을 바꿀 때는 DATA_AUDIT §4도 같이 고친다
 * (regulationEngine.resolve.test.js가 표와 이 파일의 일치를 검사한다).
 *
 * 등급 → 신뢰도: A = 확정, B = 추정, C = 자료 불충분(확인 필요). 표에 없는 학년도(2017 이전·2027 이후)는 자료없음.
 */

const GRADE_TO_CONFIDENCE = Object.freeze({ A: CONFIDENCE.CONFIRMED, B: CONFIDENCE.ESTIMATED, C: CONFIDENCE.INSUFFICIENT });

// 영역: REQUIREMENTS(졸업요건 총괄표 수치) / MAJOR_COURSES(전공과목 편성표) / CSE_MAJOR_COURSES(컴소공 전공과목) / RAG(정리 문서)
const DATA_GRADES = Object.freeze({
  REQUIREMENTS: { 2017: 'A', 2018: 'A', 2019: 'A', 2020: 'A', 2021: 'A', 2022: 'A', 2023: 'A', 2024: 'A', 2025: 'A', 2026: 'A' },
  MAJOR_COURSES: { 2017: 'C', 2018: 'C', 2019: 'A', 2020: 'C', 2021: 'A', 2022: 'A', 2023: 'A', 2024: 'A', 2025: 'A', 2026: 'B' },
  CSE_MAJOR_COURSES: { 2017: 'C', 2018: 'C', 2019: 'B', 2020: 'B', 2021: 'B', 2022: 'B', 2023: 'B', 2024: 'B', 2025: 'B', 2026: 'B' },
  RAG: { 2017: 'B', 2018: 'B', 2019: 'B', 2020: 'B', 2021: 'B', 2022: 'B', 2023: 'B', 2024: 'B', 2025: 'B', 2026: 'B' },
});

// 컴소공 영역을 따로 쓰는 학과(DATA_AUDIT §4 "컴소공 전공과목" 열, N-8).
const CSE_DEPARTMENT_NAMES = Object.freeze(['컴퓨터·소프트웨어공학과', '공학3계열']);

/**
 * 총괄표가 덮지 않아 등급 A를 주면 안 되는 졸업요건 값(DATA_AUDIT §4 마지막 문단, §6-4).
 * 카테고리 단위로만 표현 가능한 것만 둔다 — 교양필수/교양선택 "분할"은 합계만 대조했으므로 두 카테고리 각각은 추정.
 */
const UNVERIFIED_REQUIREMENT_PARTS = Object.freeze({
  categories: ['교양필수', '교양선택'],   // 분할 미검증(합계는 A)
  certificationRows: true,               // 졸업논문·졸업인증제(minCourseCount 행)
  requiredCourses: true,                 // requiredCourses 목록
  enrollmentOverrideRows: true,          // 전과/편입 최소전공 행(학과별 숫자 일부 미검증)
});

/**
 * 판단 보류 항목(DATA_AUDIT §2-3, 이슈 #260). 해당 학과·학년도의 값은 "추정"으로 낮춘다.
 * match: departmentNames(정확히 일치) 또는 departmentSuffix(이름 끝 일치). area: 영향 영역.
 * 학과명이 특정되지 않은 항목(N-3 도구 기준 학수번호 등)은 과목 단위라 졸업요건 신뢰도에 넣지 않고 note로만 남긴다.
 */
const PENDING_HOLDS = Object.freeze([
  { id: '#260-math-edu', years: [2018, 2019], departmentNames: ['수학교육과'], area: 'REQUIREMENTS', note: '수학교육과 일반선택 책자 42 vs 시드 44(책자 산술 불일치)' },
  { id: '#260-fashion', years: [2020, 2021], departmentNames: ['패션디자인산업학과'], area: 'REQUIREMENTS', note: '패션디자인산업학과 자유선택 책자 35 vs 시드 32(책자 산술 불일치)' },
  { id: '#260-sw-2021', years: [2021], departmentNames: ['SW융합학과'], area: 'REQUIREMENTS', note: 'SW융합학과 교양·전공·자유 학점 구조(SW연계 학점 포함) 보류' },
  { id: '#260-edu-2024', years: [2024], departmentSuffix: '교육과', area: 'REQUIREMENTS', note: '사범대 10개 학과 자유선택 책자 32 vs 시드 34, 변경 이력 가짜 변경(N-6)' },
  { id: '#260-special-edu', years: [2025, 2026], departmentNames: ['중등특수교육과'], area: 'REQUIREMENTS', note: '중등특수교육과 전공·자유선택 보류' },
  {
    id: '#260-2026-free', years: [2026], area: 'REQUIREMENTS',
    departmentNames: ['의생명공학계열', '그린바이오계열', '스마트농업계열', '푸드테크계열', '디자인융합계열', '창의문화융합계열', '국방기술학과', '한의학과'],
    note: '2026 자유선택·교양 책자 vs 도구 값 불일치(#260 [2026] 1)',
  },
  { id: '#260-cse-liberal', years: [2017, 2018, 2019, 2020, 2021], departmentNames: ['컴퓨터·소프트웨어공학과'], area: 'REQUIREMENTS', note: '컴소공 교양·일반선택 분할 책자 vs 시드 불일치(R-13)' },
  { id: 'N-1', years: [2022], departmentNames: ['탄소융합공학과'], area: 'MAJOR_COURSES', note: '탄소융합공학과 2022 과목 누락·이름 차이(도구 기준 확인 필요)' },
  { id: 'N-5', years: [2020, 2021, 2022, 2023], departmentNames: ['SW융합학과', '인공지능융합학과', '중등특수교육과'], area: 'ENROLLMENT_OVERRIDE', note: '전과·편입 최소전공 행 없음' },
  { id: 'N-4', years: [2026], departmentNames: ['약학과'], area: 'MAJOR_COURSES', note: '약학과 2026 과목 도구 기준 확인 필요' },
  { id: '#260-econ', years: [2023, 2024], departmentNames: ['경제금융학과'], area: 'MAJOR_COURSES', note: '경제금융학과 학수번호 교차(도구 기준)' },
]);

function gradeOf(area, year) {
  const table = DATA_GRADES[area];
  return (table && table[year]) || null;
}

/** (영역, 학년도, 학과명) → 등급. 컴소공은 MAJOR_COURSES 대신 CSE_MAJOR_COURSES를 쓴다. */
function dataGrade(area, year, departmentName) {
  const effectiveArea = area === 'MAJOR_COURSES' && CSE_DEPARTMENT_NAMES.includes(departmentName) ? 'CSE_MAJOR_COURSES' : area;
  return { area: effectiveArea, grade: gradeOf(effectiveArea, year) };
}

function gradeConfidence(grade) {
  return grade ? GRADE_TO_CONFIDENCE[grade] : CONFIDENCE.NO_DATA;
}

function holdMatches(hold, year, departmentName) {
  if (!hold.years.includes(year)) return false;
  if (hold.departmentNames && hold.departmentNames.includes(departmentName)) return true;
  return Boolean(hold.departmentSuffix && departmentName && departmentName.endsWith(hold.departmentSuffix));
}

/** 이 학과·학년도에 걸린 판단 보류 항목. area를 주면 그 영역만. */
function pendingHoldsFor(year, departmentName, area = null) {
  return PENDING_HOLDS.filter((h) => (area == null || h.area === area) && holdMatches(h, year, departmentName));
}

module.exports = {
  GRADE_TO_CONFIDENCE,
  DATA_GRADES,
  CSE_DEPARTMENT_NAMES,
  UNVERIFIED_REQUIREMENT_PARTS,
  PENDING_HOLDS,
  dataGrade,
  gradeConfidence,
  pendingHoldsFor,
};
