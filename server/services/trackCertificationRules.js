/**
 * server/services/trackCertificationRules.js
 * 세부전공이 대학 공통 졸업인증제보다 강하게 정한 규칙(DECISIONS D-78).
 *
 * 졸업요건 시드(curriculum_requirements)는 학과 단위라 계열 안의 세부전공을 나눌 수 없다. 그래서 세부전공 예외는 여기 한곳에 두고,
 * 진단(graduationService)과 챗봇의 졸업요건 근거(curriculumContextService)가 같은 함수를 쓴다 — 한쪽만 바꾸면 화면과 챗봇이 어긋난다.
 *
 * 공학3계열 컴퓨터·소프트웨어공학전공(2026학번~): 책자 졸업인증제 "나" 그룹은 캡스톤디자인·기업연계프로젝트·종합설계 중 1과목이지만,
 * 과사무실이 옛 컴퓨터·소프트웨어공학과와 같이 기업연계프로젝트1·2 둘 다 이수해야 한다고 안내했다(2026-10-16,
 * docs/school-inquiry/컴퓨터소프트웨어공학전공_답변_2026-10-16.md). 학과 공지(computer.wku.ac.kr/?p=3366)도 전과생 포함 1·2 필수다.
 *
 * 디자인융합계열 패션디자인산업전공: 계열은 "가" 그룹(전공현장실습·캡스톤디자인·사회봉사 중 1과목)이지만, 세부전공은 이전 학과 그룹을 따라
 * 패션디자인산업전공만 "나" 그룹(캡스톤디자인·기업연계프로젝트·종합설계 중 1과목)이다(2차 문의 D-2, 교육혁신과 답변 2026-10-26, D-83).
 *
 * minCourseCount를 적지 않으면 requiredCourses를 모두 이수해야 한다.
 */

const TRACK_CERTIFICATION_RULES = [
  {
    departmentName: '공학3계열',
    trackName: '컴퓨터·소프트웨어공학전공',
    minAdmissionYear: 2026,
    requiredCourses: ['기업연계프로젝트1(종합설계1)', '기업연계프로젝트2(종합설계2)'],
    description: '기업연계프로젝트1(종합설계1)·2(종합설계2) 둘 다 필수 이수 (컴퓨터·소프트웨어공학전공 학과 규칙 — 책자 "나" 그룹 기준은 1과목이지만 학과가 둘 다 요구, 과사무실 안내 2026-10-16)',
  },
  {
    departmentName: '디자인융합계열',
    trackName: '패션디자인산업전공',
    minAdmissionYear: 2020,
    requiredCourses: ['캡스톤디자인', '기업연계프로젝트', '종합설계'],
    minCourseCount: 1,
    description: '캡스톤디자인(기업연계프로젝트)·종합설계 중 1과목 필수 이수 (졸업인증제 "나" 그룹 — 패션디자인산업전공은 이전 학과(패션디자인산업학과) 그룹을 따름, 학교 확인 2026-10-26)',
  },
];

const courseCountOf = (rule) => rule.minCourseCount ?? rule.requiredCourses.length;

const rulesFor = (departmentName, admissionYear) =>
  TRACK_CERTIFICATION_RULES.filter((r) => r.departmentName === departmentName && admissionYear != null && admissionYear >= r.minAdmissionYear);

/**
 * 학생의 세부전공 규칙이 있으면 졸업인증제 행을 그 규칙으로 바꾼다. 행 모양은 evaluateCertifications 입력과 같다.
 * 세부전공을 모르면(화면은 세부전공을 꼭 고르게 하지만 옛 계정 등은 비어 있을 수 있다) 공통 기준으로 판정하고 세부전공 예외를 설명에 함께 적는다.
 */
function applyTrackCertificationRule(certificationRows, { departmentName, admissionYear, trackName }) {
  const rules = rulesFor(departmentName, admissionYear);
  if (rules.length === 0) return certificationRows;
  const rule = rules.find((r) => r.trackName === trackName);
  if (rule) {
    return certificationRows.map((row) => (row.category === '졸업인증제'
      ? { ...row, description: rule.description, requiredCourses: rule.requiredCourses, min_course_count: courseCountOf(rule) }
      : row));
  }
  if (trackName != null) return certificationRows;
  const note = rules.map((r) => `${r.trackName}이면 ${r.requiredCourses.join('·')} ${courseCountOf(r) >= r.requiredCourses.length ? '모두 필수(학과 규칙)' : `중 ${courseCountOf(r)}과목`}`).join(', ');
  return certificationRows.map((row) => (row.category === '졸업인증제'
    ? { ...row, description: `${row.description} — 단, ${note}. 세부전공을 고르면 그 기준으로 판정해요` }
    : row));
}

/** 학과 단위 졸업요건 근거(챗봇)에 붙일 세부전공 예외 줄. 세부전공을 모르는 질문에도 예외가 있다는 걸 알린다. */
function trackCertificationNotes(departmentName, admissionYear) {
  return rulesFor(departmentName, admissionYear)
    .map((r) => `졸업인증제 세부전공 예외 — ${r.trackName}: ${r.description}. 그 외 세부전공은 위 기준이다.`);
}

module.exports = { TRACK_CERTIFICATION_RULES, applyTrackCertificationRule, trackCertificationNotes };
