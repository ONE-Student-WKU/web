const { ENROLLMENT_TYPES, MIN_SUPPORTED_ADMISSION_YEAR } = require('./constants');

/**
 * server/services/regulationEngine/context.js
 * 엔진 입력(학생 상황)의 검증·정규화와 날짜/학기 계산. 전부 순수 함수다(DB·현재시각에 의존하지 않음).
 *
 * 왜 날짜를 'YYYY-MM-DD' 문자열로 다루는가: Date 객체는 타임존에 따라 하루가 밀리기 쉬운데(UTC vs KST),
 * 기준일 비교는 "그 날이 어느 판본의 시행일 이후인가"라 하루 차이가 결과를 바꾼다. ISO 문자열은 사전순 비교가
 * 곧 날짜순 비교라서 타임존 문제 없이 `a < b`로 비교할 수 있다.
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidIsoDate(s) {
  const m = typeof s === 'string' && ISO_DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 한국 시각 기준 오늘 'YYYY-MM-DD'. 서버 타임존이 UTC여도 한국 날짜가 나온다. */
function todayKst(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);
}

/**
 * 날짜 → (학년도, 학기). 학칙 제22조: 학년은 3월 1일~다음해 2월 말일, 1학기 3/1~8/31, 2학기 9/1~다음해 2월 말.
 * 1~2월은 "전년도 2학기"에 속한다(예: 2026-02-10 → 2025학년도 2학기).
 */
function academicTermOf(isoDate) {
  const [y, m] = isoDate.split('-').map(Number);
  if (m >= 3 && m <= 8) return { year: y, semester: 1 };
  if (m >= 9) return { year: y, semester: 2 };
  return { year: y - 1, semester: 2 };
}

/** (학년도, 학기)를 한 줄로 세울 수 있는 정수로. 학기 단위 대소 비교·차이 계산용. */
function termIndex({ year, semester }) {
  return year * 2 + (semester - 1);
}

const isInt = (v) => Number.isInteger(v);

/**
 * students 테이블 행(snake_case) → 엔진 입력. Part 2(API/챗봇 연동)에서 학생 DB 행을 그대로 넘기는 용도.
 * 편입 학년은 students에 컬럼이 없어 비워둔다(엔진이 가정 플래그를 남긴다).
 */
function inputFromStudentRow(student, extra = {}) {
  return {
    admissionYear: student.admission_year,
    enrollmentType: student.enrollment_type || 'GENERAL',
    departmentId: student.department_id,
    trackId: student.track_id ?? null,
    majorChange:
      student.enrollment_type === 'MAJOR_CHANGE'
        ? { grade: student.major_change_grade ?? null, year: student.major_change_year ?? null, semester: student.major_change_semester ?? null }
        : null,
    ...extra,
  };
}

/**
 * 원시 입력 → 정규화된 ctx. 잘못된 값은 ctx 대신 errors로 모은다(예외를 던지지 않음 — 호출자는 항상 결과 객체를 받는다).
 *
 * 입력:
 *  - admissionYear(필수), enrollmentType(필수: GENERAL | TRANSFER_ADMISSION | MAJOR_CHANGE)
 *  - departmentId 또는 departmentName 중 하나(필수), trackId(선택)
 *  - asOfDate(선택, 'YYYY-MM-DD', 기본 = 오늘(KST))
 *  - majorChange: { grade 1~4, year, semester 1|2 } (전과생만; 값이 없어도 되지만 없으면 플래그)
 *  - transfer: { grade 2~4 } (편입생만)
 *  - restructuring: { year, semester } ("학사구조조정 시점" 해석을 쓸 때만 필요)
 *  - policy.liberalArtsCutoffTrigger: 'MAJOR_CHANGE_DATE'(기본) | 'RESTRUCTURING_DATE' — 아래 decisions.js 참고
 */
function normalizeInput(raw, { today } = {}) {
  const errors = [];
  const r = raw || {};

  if (!isInt(r.admissionYear) || r.admissionYear < 1900 || r.admissionYear > 2200) errors.push('admissionYear는 4자리 정수여야 해요');
  if (!ENROLLMENT_TYPES.includes(r.enrollmentType)) errors.push(`enrollmentType은 ${ENROLLMENT_TYPES.join(' | ')} 중 하나여야 해요`);
  if (r.departmentId == null && !r.departmentName) errors.push('departmentId 또는 departmentName이 필요해요');

  const asOfDate = r.asOfDate ?? today ?? todayKst();
  if (!isValidIsoDate(asOfDate)) errors.push('asOfDate는 YYYY-MM-DD 형식의 실제 날짜여야 해요');

  const mc = r.majorChange || null;
  if (mc) {
    if (mc.grade != null && !(isInt(mc.grade) && mc.grade >= 1 && mc.grade <= 4)) errors.push('majorChange.grade는 1~4여야 해요');
    if (mc.semester != null && !(mc.semester === 1 || mc.semester === 2)) errors.push('majorChange.semester는 1 또는 2여야 해요');
    if (mc.year != null && !isInt(mc.year)) errors.push('majorChange.year는 정수여야 해요');
  }
  const tr = r.transfer || null;
  if (tr && tr.grade != null && !(isInt(tr.grade) && tr.grade >= 2 && tr.grade <= 4)) errors.push('transfer.grade는 2~4여야 해요');
  const rs = r.restructuring || null;
  if (rs) {
    if (rs.year != null && !isInt(rs.year)) errors.push('restructuring.year는 정수여야 해요');
    if (rs.semester != null && !(rs.semester === 1 || rs.semester === 2)) errors.push('restructuring.semester는 1 또는 2여야 해요');
  }
  const trigger = (r.policy && r.policy.liberalArtsCutoffTrigger) || 'MAJOR_CHANGE_DATE';
  if (!['MAJOR_CHANGE_DATE', 'RESTRUCTURING_DATE'].includes(trigger)) errors.push('policy.liberalArtsCutoffTrigger 값이 올바르지 않아요');

  if (errors.length > 0) return { ctx: null, errors };

  const majorChange = r.enrollmentType === 'MAJOR_CHANGE' ? {
    grade: mc && mc.grade != null ? mc.grade : null,
    year: mc && mc.year != null ? mc.year : null,
    semester: mc && mc.semester != null ? mc.semester : null,
  } : null;

  return {
    errors,
    ctx: {
      admissionYear: r.admissionYear,
      enrollmentType: r.enrollmentType,
      departmentId: r.departmentId ?? null,
      departmentName: r.departmentName ?? null,
      trackId: r.trackId ?? null,
      asOfDate,
      asOfTerm: academicTermOf(asOfDate),
      majorChange,
      transfer: r.enrollmentType === 'TRANSFER_ADMISSION' ? { grade: tr && tr.grade != null ? tr.grade : null } : null,
      restructuring: rs && rs.year != null && rs.semester != null ? { year: rs.year, semester: rs.semester } : null,
      policy: { liberalArtsCutoffTrigger: trigger },
      supported: r.admissionYear >= MIN_SUPPORTED_ADMISSION_YEAR,
    },
  };
}

module.exports = { isValidIsoDate, todayKst, academicTermOf, termIndex, inputFromStudentRow, normalizeInput };
