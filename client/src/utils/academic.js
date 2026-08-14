/**
 * client/src/utils/academic.js
 * 입학년도 기준 학년 계산 — Home.jsx의 재학생 표시와 Onboarding.jsx의 전과 학년 추정이 공유.
 */
// leaveSemesters(누적 휴학 학기 수)를 2학기당 1년으로 환산해 보정한다 — 입학년도만으로 계산하면
// 군복무 등으로 휴학한 학생의 학년이 실제보다 높게(최대 4학년으로 캡) 나오는 문제가 있어 추가함.
export function getGradeLevel(admissionYear, leaveSemesters = 0) {
  if (!admissionYear) return null;
  const currentYear = new Date().getFullYear();
  const leaveYears = Math.floor((leaveSemesters || 0) / 2);
  return Math.min(4, Math.max(1, currentYear - admissionYear - leaveYears + 1));
}
