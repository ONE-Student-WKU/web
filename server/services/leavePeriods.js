const { academicTermOf, termIndex, todayKst } = require('./regulationEngine/context');

/**
 * server/services/leavePeriods.js
 * 학생이 입력한 휴학 기간(students.leave_periods) — 해석·검증·계산(순수 함수).
 *
 * students.leave_periods(JSON)는 세 가지 상태다.
 *  - NULL: 아직 휴학 질문에 답하지 않음(기능 도입 전 계정). 이때만 누적 휴학 학기 수(leave_semesters)로 추정한다.
 *  - []: 휴학한 적 없음(답함).
 *  - [{ startYear, startSemester, semesters }, ...]: startYear학년도 startSemester학기부터 semesters개 정규 학기를 휴학.
 * 휴학 "수"만으로는 시기를 몰라 개편 당시의 학년(학칙시행규칙 제13조③ "재학 중인 학년") 같은 판단이 입학년도 추정에 기댔다.
 * 기간을 받으면 학년 계산이 입력값 기준으로 정해진다. 휴학 사유는 받지 않는다.
 * 학기는 정규 학기(1·2) 번호 체계다(계절학기는 휴학과 무관 — termCode.js).
 */

const MAX_PERIODS = 8;
const MAX_SEMESTERS_PER_PERIOD = 12;

/** DB 값(mysql2는 JSON 컬럼을 객체로 주지만 드라이버 설정에 따라 문자열일 수도 있다) → 배열 | null. 깨진 값은 null(미응답)로 본다. */
function parseLeavePeriods(raw) {
  if (raw == null) return null;
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  return value
    .map((p) => ({ startYear: Number(p.startYear), startSemester: Number(p.startSemester), semesters: Number(p.semesters) }))
    .filter((p) => Number.isInteger(p.startYear) && (p.startSemester === 1 || p.startSemester === 2) && Number.isInteger(p.semesters) && p.semesters > 0);
}

/** 휴학한 정규 학기들의 termIndex. */
function leaveTermIndexes(periods) {
  const indexes = new Set();
  for (const p of periods || []) {
    const start = termIndex({ year: p.startYear, semester: p.startSemester });
    for (let k = 0; k < p.semesters; k++) indexes.add(start + k);
  }
  return indexes;
}

function totalLeaveSemesters(periods) {
  return (periods || []).reduce((sum, p) => sum + p.semesters, 0);
}

/** [fromIndex, toIndex) 구간에 들어가는 휴학 학기 수. */
function countLeaveBetween(periods, fromIndex, toIndex) {
  let count = 0;
  for (const i of leaveTermIndexes(periods)) if (i >= fromIndex && i < toIndex) count++;
  return count;
}

/** 학생이 처음 다닌 정규 학기(편입생은 편입 학기)의 termIndex. 편입 학년이 없으면(옛 방식) 입력한 학년도 1학기로 본다. */
function firstEnrolledTermIndex({ admissionYear, enrollmentType, transferGrade }) {
  const grade = enrollmentType === 'TRANSFER_ADMISSION' && transferGrade != null ? Number(transferGrade) : 1;
  return termIndex({ year: admissionYear + grade - 1, semester: 1 });
}

/**
 * 입력 검증·정규화. 성공하면 { periods }(시작 학기 순 정렬), 실패하면 { error: 코드 }.
 * - 첫 학기(입학·편입) 이전에 시작할 수 없다.
 * - 이번 학기 다음 학기보다 늦게 시작할 수 없다(다음 학기 휴학 신청까지는 받는다).
 * - 기간끼리 겹칠 수 없다.
 */
function validateLeavePeriods(input, student, { today = todayKst() } = {}) {
  if (!Array.isArray(input)) return { error: 'INVALID_LEAVE_PERIODS' };
  if (input.length > MAX_PERIODS) return { error: 'INVALID_LEAVE_PERIODS' };
  if (!student || !student.admissionYear) return { error: 'ONBOARDING_REQUIRED' };

  const periods = [];
  for (const p of input) {
    const startYear = Number(p && p.startYear);
    const startSemester = Number(p && p.startSemester);
    const semesters = Number(p && p.semesters);
    if (!Number.isInteger(startYear) || !(startSemester === 1 || startSemester === 2)) return { error: 'INVALID_LEAVE_PERIODS' };
    if (!Number.isInteger(semesters) || semesters < 1 || semesters > MAX_SEMESTERS_PER_PERIOD) return { error: 'INVALID_LEAVE_PERIODS' };
    periods.push({ startYear, startSemester, semesters });
  }
  periods.sort((a, b) => termIndex({ year: a.startYear, semester: a.startSemester }) - termIndex({ year: b.startYear, semester: b.startSemester }));

  const first = firstEnrolledTermIndex(student);
  const latestStart = termIndex(academicTermOf(today)) + 1;
  let previousEnd = -Infinity;
  for (const p of periods) {
    const start = termIndex({ year: p.startYear, semester: p.startSemester });
    if (start < first) return { error: 'LEAVE_BEFORE_ADMISSION' };
    if (start > latestStart) return { error: 'LEAVE_IN_FUTURE' };
    if (start < previousEnd) return { error: 'LEAVE_PERIODS_OVERLAP' };
    previousEnd = start + p.semesters;
  }
  return { periods };
}

/**
 * yearStart학년도가 시작될 때의 학년(그 해 1학기의 학년). 휴학 기간을 알면 그 전까지 쉰 학기를 빼고 센다.
 * periods가 null(모름)이면 입학년도만으로 계산한다 — 기존 동작(toYear − admissionYear + 1)과 같다.
 */
function gradeAtYearStart({ admissionYear, enrollmentType, transferGrade }, year, periods) {
  const first = firstEnrolledTermIndex({ admissionYear, enrollmentType, transferGrade });
  const startGrade = enrollmentType === 'TRANSFER_ADMISSION' && transferGrade != null ? Number(transferGrade) : 1;
  const yearIndex = termIndex({ year, semester: 1 });
  if (periods == null) return year - admissionYear + 1;
  const enrolled = Math.max(0, yearIndex - first - countLeaveBetween(periods, first, yearIndex));
  return startGrade + Math.floor(enrolled / 2);
}

module.exports = {
  MAX_PERIODS,
  parseLeavePeriods,
  leaveTermIndexes,
  totalLeaveSemesters,
  countLeaveBetween,
  firstEnrolledTermIndex,
  validateLeavePeriods,
  gradeAtYearStart,
};
