/**
 * server/services/majorTrackType.js
 * 광역 계열전공 학생의 전공 이수유형(students.major_track_type) 입력 규칙(#378 결정 3-1 A·3-4 A).
 *
 * 학칙시행규칙 제7조 제2항: 광역계열 소속 학생은 다음 유형 중 하나를 선택해 전공을 이수한다.
 *   1. 복수전공형: 전공별 36학점 이상  2. 전공심화형: 제6조 제4항 계열별 학점  3. 전공융합형: 총 72학점(마이크로디그리 2개 포함)
 * 유형은 1학년 2학기 말에 확정되므로 "아직 안 정했어요"(UNDECIDED)도 받는다. NULL은 아직 묻지 않음(기존 계정은 다음 접속 때 한 번 묻는다).
 * 광역단위 계열전공은 2025학번부터라(2025 책자 "광역단위-계열전공"), 이름이 "계열"로 끝나는 학과의 2025학번 이후 학생을 대상으로 본다.
 * 화면(client/src/utils/majorTrackType.js)도 같은 규칙을 쓴다.
 */

const MAJOR_TRACK_TYPES = Object.freeze(['DOUBLE_MAJOR', 'INTENSIVE', 'CONVERGENCE', 'UNDECIDED']);
const BROAD_SERIES_FIRST_COHORT = 2025;

/** 광역 계열전공 학생인가(이수유형을 묻는 대상). */
function isBroadSeriesStudent({ departmentName, admissionYear }) {
  return typeof departmentName === 'string' && departmentName.endsWith('계열') && Number(admissionYear) >= BROAD_SERIES_FIRST_COHORT;
}

/**
 * 요청 값 검증. undefined는 "보내지 않음", null은 "지움"이라 검사하지 않는다. 오류 코드 또는 null.
 * @param {string|null|undefined} majorTrackType
 * @param {{ departmentName, admissionYear }} effective 이번 요청으로 확정되는 학과·학번
 */
function validateMajorTrackType(majorTrackType, effective) {
  if (majorTrackType === undefined || majorTrackType === null) return null;
  if (!MAJOR_TRACK_TYPES.includes(majorTrackType)) return 'INVALID_MAJOR_TRACK_TYPE';
  if (!isBroadSeriesStudent(effective)) return 'MAJOR_TRACK_TYPE_NOT_ALLOWED';
  return null;
}

module.exports = { MAJOR_TRACK_TYPES, BROAD_SERIES_FIRST_COHORT, isBroadSeriesStudent, validateMajorTrackType };
