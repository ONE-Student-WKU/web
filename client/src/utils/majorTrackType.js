// 광역 계열전공 이수유형(학칙시행규칙 제7조 제2항). 서버 services/majorTrackType.js와 같은 규칙이다(#378 결정 3-1 A).
// 계열 학과("…계열")의 2025학번 이후 학생에게만 묻고, 1학년 2학기 말에 정해지므로 "아직 안 정했어요"(UNDECIDED)도 받는다.
export const MAJOR_TRACK_TYPES = ['DOUBLE_MAJOR', 'INTENSIVE', 'CONVERGENCE', 'UNDECIDED'];
export const BROAD_SERIES_FIRST_COHORT = 2025;

export function isBroadSeriesStudent(departmentName, admissionYear) {
  return typeof departmentName === 'string' && departmentName.endsWith('계열') && Number(admissionYear) >= BROAD_SERIES_FIRST_COHORT;
}
