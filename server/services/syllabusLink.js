const { academicTermOf, todayKst } = require('./regulationEngine/context');

/**
 * server/services/syllabusLink.js
 * 학교 웹정보서비스 "수업계획서 조회"(로그인 없이 공개)로 바로 가는 링크를 만든다(순수 함수).
 *
 * 왜 검색 결과 링크인가: 계획서 본문 주소(lectRPlanView.jsp)는 교수 번호(employeeNo)가 있어야 열리는데 그 값은 우리 데이터에 없다.
 * 검색 페이지는 주소의 값(year·term·gubun=3(학수번호 검색)·gubunvalue)만으로 그 과목의 분반 목록을 바로 보여 주고(2026-10-13 확인),
 * 학생이 자기 분반을 누르면 계획서가 열린다. 학생이 직접 눌러 학교 화면을 보는 링크라 계획서를 우리가 가져오거나 저장하지 않는다.
 */

const SEARCH_URL = 'https://intra.wku.ac.kr/SWupis/V005/Service/Emplo/LecPlan/searchLecPlanInfo.jsp';

/**
 * 과목이 열리는 정규 학기(1·2)에 대해, 오늘 기준으로 계획서가 있을 가장 최근 학년도.
 * 예: 2026-10(2학기 중) → 2학기 과목은 2026, 1학기 과목도 2026(이미 지난 1학기). 2027-03(1학기 중) → 2학기 과목은 2026.
 */
function latestYearForSemester(semester, today = todayKst()) {
  const now = academicTermOf(today);
  return semester <= now.semester ? now.year : now.year - 1;
}

/** @returns {string|null} 학수번호가 없거나 학기가 1·2가 아니면 null */
function syllabusSearchUrl(courseCode, semester, today = todayKst()) {
  const term = Number(semester);
  if (!courseCode || (term !== 1 && term !== 2)) return null;
  const params = new URLSearchParams({ year: String(latestYearForSemester(term, today)), term: String(term), gubun: '3', gubunvalue: String(courseCode) });
  return `${SEARCH_URL}?${params}`;
}

module.exports = { syllabusSearchUrl, latestYearForSemester };
