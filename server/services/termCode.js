/**
 * server/services/termCode.js
 * 학기 번호 체계 변환(순수 함수). 같은 "학기" 숫자가 테이블마다 다른 뜻이라 혼용하면 조용히 틀린 조회가 된다.
 *
 *  - 사람이 말하는 학기 / 교육과정 편성표(curriculum_courses.semester) / 규정 엔진(academicTermOf): 1=1학기, 2=2학기
 *  - 실제 개설 이력·수강 내역(course_offerings, student_courses .semester): 학사력 시간순 4칸 —
 *    1=1학기, 2=여름 계절학기, 3=2학기, 4=겨울 계절학기 (2026-09 계절학기 지원 도입, db/migrate.js의
 *    ensureSeasonSemesterRenumbering 참고)
 * 챗봇이 질문 속 "2학기"를 course_offerings에 그대로 넣으면 여름 계절학기(2)를 조회해 빈 결과가 나오고,
 * 반대로 DB의 3을 그대로 "3학기"로 보여주면 모델이 2학기로 알아보지 못한다.
 */

const OFFERING_SEMESTER = Object.freeze({ FIRST: 1, SUMMER: 2, SECOND: 3, WINTER: 4 });

/** 정규 학기 번호(1|2) → DB 학기 코드. 1·2 이외(예: "3학기")는 개설 학기로 볼 수 없어 null. */
function regularSemesterToOfferingCode(semester) {
  if (semester === 1) return OFFERING_SEMESTER.FIRST;
  if (semester === 2) return OFFERING_SEMESTER.SECOND;
  return null;
}

/** DB 학기 코드 → 정규 학기 번호(1|2). 계절학기(2·4)나 알 수 없는 값은 null. */
function offeringCodeToRegularSemester(code) {
  if (code === OFFERING_SEMESTER.FIRST) return 1;
  if (code === OFFERING_SEMESTER.SECOND) return 2;
  return null;
}

/** DB 학기 코드 → 사람이 읽는 이름. 근거 문서·화면에 이 이름만 쓴다. */
function offeringCodeLabel(code) {
  switch (code) {
    case OFFERING_SEMESTER.FIRST: return '1학기';
    case OFFERING_SEMESTER.SUMMER: return '여름 계절학기';
    case OFFERING_SEMESTER.SECOND: return '2학기';
    case OFFERING_SEMESTER.WINTER: return '겨울 계절학기';
    default: return `${code}학기`;
  }
}

module.exports = { OFFERING_SEMESTER, regularSemesterToOfferingCode, offeringCodeToRegularSemester, offeringCodeLabel };
