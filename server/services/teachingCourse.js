/**
 * server/services/teachingCourse.js
 * 교직과정 이수 여부(students.teaching_course)와 편입 인정학점(students.transfer_recognized_credits)의 입력 규칙.
 * 근거: 2026 교육과정 책자 Ⅳ장 교직과정 이수 안내(db/regulations/교직/2026_교직과정_이수안내.md), 학칙 제56조, DECISIONS D-67.
 *
 * - 사범대학 학생은 선발 없이 교직과정을 이수한다(교원자격 기준 1호 "사범대학 졸업자"). 다만 교직포기각서를 내면 포기할 수 있어
 *   ("사범대학 2·3·4학년 재학생(교직포기자 제외)") 화면은 "이수 중"을 미리 골라 두고 학생이 풀 수 있게 한다.
 * - 편입생과 3학년 전과생은 교직과정을 이수할 수 없다(책자 2절). 4학년 전과도 같은 이유로 막는다.
 */

// 책자 교직 표의 사범대학 학과(국어·영어·일어·한문·역사교육, 교육학과, 유아교육, 가정·수학·체육교육, 중등특수교육과).
const TEACHER_COLLEGE_DEPARTMENTS = new Set([
  '국어교육과', '영어교육과', '일어교육과', '한문교육과', '역사교육과', '교육학과', '유아교육과',
  '가정교육과', '수학교육과', '체육교육과', '중등특수교육과',
]);

// 편입 인정학점 입력 범위. 학교 표의 인정학점은 60~70학점대이고, 졸업학점(최대 160)을 넘을 수 없다.
const MAX_TRANSFER_RECOGNIZED_CREDITS = 160;

function isTeacherCollegeDepartment(departmentName) {
  return TEACHER_COLLEGE_DEPARTMENTS.has(departmentName);
}

/** 이 입학 유형으로 교직과정을 이수할 수 있는가. 편입생·3학년 이상 전과생은 안 된다. */
function canTakeTeachingCourse({ enrollmentType, majorChangeGrade }) {
  if (enrollmentType === 'TRANSFER_ADMISSION') return false;
  if (enrollmentType === 'MAJOR_CHANGE' && Number(majorChangeGrade) >= 3) return false;
  return true;
}

/**
 * 요청 값 검증. undefined는 "보내지 않음"이라 검사하지 않는다. 오류 코드 또는 null.
 * @param {{ teachingCourse?: boolean|null, transferRecognizedCredits?: number|null }} values
 * @param {{ enrollmentType, majorChangeGrade }} effective 이번 요청으로 확정되는 입학 유형·전과 학년
 */
function validateTeachingAndTransferCredits({ teachingCourse, transferRecognizedCredits }, effective) {
  if (teachingCourse !== undefined && teachingCourse !== null) {
    if (typeof teachingCourse !== 'boolean') return 'INVALID_TEACHING_COURSE';
    if (!canTakeTeachingCourse(effective)) return 'TEACHING_COURSE_NOT_ALLOWED';
  }
  if (transferRecognizedCredits !== undefined && transferRecognizedCredits !== null) {
    if (effective.enrollmentType !== 'TRANSFER_ADMISSION') return 'INVALID_TRANSFER_RECOGNIZED_CREDITS';
    if (!Number.isInteger(transferRecognizedCredits) || transferRecognizedCredits < 0 || transferRecognizedCredits > MAX_TRANSFER_RECOGNIZED_CREDITS) {
      return 'INVALID_TRANSFER_RECOGNIZED_CREDITS';
    }
  }
  return null;
}

/** DB 값(TINYINT 1/0/NULL) → true/false/null. */
function parseTeachingCourse(value) {
  if (value === null || value === undefined) return null;
  return Number(value) === 1;
}

module.exports = {
  TEACHER_COLLEGE_DEPARTMENTS,
  MAX_TRANSFER_RECOGNIZED_CREDITS,
  isTeacherCollegeDepartment,
  canTakeTeachingCourse,
  validateTeachingAndTransferCredits,
  parseTeachingCourse,
};
