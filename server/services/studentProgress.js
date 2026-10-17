const pool = require('../db');
const { FAILING_GRADES, getSupersededCourseIds } = require('./courseService');
const { academicTermOf, termIndex, todayKst } = require('./regulationEngine/context');
const { offeringCodeToRegularSemester } = require('./termCode');
const { parseLeavePeriods, countLeaveBetween } = require('./leavePeriods');

/**
 * server/services/studentProgress.js
 * 학생의 "수강 진행 상태" — 다음에 수강신청할 학기가 재학 몇 번째 학기(몇 학년)인지와 이미 이수한 과목을 코드로 계산한다.
 * 챗봇이 "현재 3학년"이라는 문장만 보고 학년·학기를 즉흥으로 추정하면 3학년 과목만 권하는 식으로 틀려서(2026-10 실사용 확인),
 * 모델은 계산된 값을 그대로 쓰게 한다. 학기는 정규 학기(1·2) 번호 체계다(계절학기는 재학 학기 수에 세지 않는다 — termCode.js).
 *
 * 재학 학기 수(enrolledBefore: 다음 학기 직전까지 등록해 다닌 정규 학기 수)를 구하는 방법:
 *  1) PROFILE  — 학생이 휴학 질문에 답했으면(leave_periods가 [] 또는 기간) 입학 이후 경과 학기 − 그 기간의 휴학 학기 수. 이수 기록보다 우선한다
 *                (기록은 학생이 아직 다 넣지 않았을 수 있다 — 최근 학기 과목이 없다고 휴학으로 보면 학년이 낮게 나온다).
 *  2) RECORDS  — 휴학 질문에 아직 답하지 않았고, 과목 관리에 등록한 이수 기록이 입학 학기부터 이어져 있으면 기록이 있는 정규 학기 수를 센다.
 *                기록이 없는 중간 학기는 휴학으로 본다(휴학 시기를 묻기 전 계정을 위한 방식).
 *  3) ESTIMATED — 휴학 질문에 아직 답하지 않은 계정(leave_periods NULL)은 입학 이후 경과 학기 − 프로필의 누적 휴학 학기 수(시기를 모름).
 * 학년 = 시작 학년(편입생 3, 그 외 1) + floor(재학 학기 수 / 2), 최대는 학과의 수업연한(그 이상은 초과학기).
 * 홈 화면·챗봇·진로 상담의 "현재 학년"도 이 계산 하나를 쓴다(이슈 #318, DECISIONS D-64) — 화면은 이수 기록 없이 프로필(휴학 기간)로,
 * 챗봇은 이수 기록까지 넣어 부른다.
 */

// 수업연한(학칙 제25조 제1항): 학사과정 4년이 원칙이고 건축학과 5년, 의·치·한의예(학)과(예과 2 + 본과 4)와 약학과 6년.
// 예과·본과가 학과로 나뉘어 있어도 학년은 입학부터 이어서 센다(예: 본과 1학년 = 3학년).
// 2026학번부터의 2년제 전문학사 학과(졸업 75학점, 2026 책자 15쪽)는 2년이다.
const DEFAULT_PROGRAM_YEARS = 4;
const PROGRAM_YEARS = Object.freeze({
  건축학과: 5,
  의예과: 6, 의학과: 6, 치의예과: 6, 치의학과: 6, 한의예과: 6, 한의학과: 6,
  약학과: 6,
  외식조리과: 2, 미용피부관리과: 2, 호텔관광과: 2, 웰니스케어과: 2, 부사관과: 2,
});
const programYearsOf = (departmentName) => PROGRAM_YEARS[departmentName] || DEFAULT_PROGRAM_YEARS;
const TRANSFER_START_GRADE = 3; // 규정 엔진도 편입생을 3학년으로 가정한다(TRANSFER_GRADE_ASSUMED)
const UPCOMING_TERM_COUNT = 2;

function termFromIndex(index) {
  return { year: Math.floor(index / 2), semester: (index % 2) + 1 };
}

function termLabel({ year, semester }) {
  return `${year}학년도 ${semester}학기`;
}

/**
 * @param {object} p
 * @param {number} p.admissionYear
 * @param {string} [p.enrollmentType]   GENERAL | TRANSFER_ADMISSION | MAJOR_CHANGE
 * @param {number|null} [p.transferGrade] 편입한 학년(편입생만). 있으면 admissionYear는 "편입 연도 − 편입 학년 + 1"이라 편입 학기(= admissionYear + transferGrade − 1학년도 1학기)부터 센다
 * @param {number} [p.leaveSemesters]   프로필의 누적 휴학 학기 수(휴학 기간을 모를 때만 쓴다)
 * @param {Array|null} [p.leavePeriods] 학생이 입력한 휴학 기간(leavePeriods.js). null이면 아직 답하지 않음
 * @param {Array<{year:number, semester:number}>} [p.recordedTerms] 이수 기록의 (학년도, DB 학기 코드). 계절학기(2·4)는 무시한다
 * @param {string} p.today              'YYYY-MM-DD'(KST)
 * @param {number} [p.programYears]     학과의 수업연한(programYearsOf). 학년 표시의 최대값이고, 넘으면 초과학기
 */
function computeProgress({ admissionYear, enrollmentType = 'GENERAL', transferGrade = null, leaveSemesters = 0, leavePeriods = null, recordedTerms = [], today, programYears = DEFAULT_PROGRAM_YEARS }) {
  if (!admissionYear) return null;

  const currentTerm = academicTermOf(today);
  const firstUpcomingIndex = termIndex(currentTerm) + 1;
  const isTransfer = enrollmentType === 'TRANSFER_ADMISSION';
  const knownTransferGrade = isTransfer && transferGrade != null ? Number(transferGrade) : null;
  // 편입 학년을 입력한 편입생: 이수 기록은 편입 학기부터 있으므로 그 학기를 기준(첫 학기)으로 세고 그 학년에서 시작한다.
  // 옛 방식으로 입력한 편입생(학년 없음)은 입력한 해부터 3학년으로 시작한다고 가정한다(기존 동작).
  const baseYear = knownTransferGrade != null ? admissionYear + knownTransferGrade - 1 : admissionYear;
  const admissionIndex = termIndex({ year: baseYear, semester: 1 });
  const startGrade = isTransfer ? (knownTransferGrade ?? TRANSFER_START_GRADE) : 1;
  const flags = [];
  if (isTransfer && knownTransferGrade == null) flags.push('TRANSFER_GRADE_ASSUMED');

  const recordedIndexes = new Set();
  for (const r of recordedTerms) {
    const semester = offeringCodeToRegularSemester(r.semester);
    if (semester == null) continue;
    const index = termIndex({ year: r.year, semester });
    if (index < firstUpcomingIndex) recordedIndexes.add(index);
  }

  // 휴학 기간을 알면 다음 학기 전까지 쉰 학기만 센다(다음 학기 휴학처럼 앞으로의 휴학은 지금까지의 재학 학기에 넣지 않는다).
  const knownLeave = leavePeriods != null;
  const leave = knownLeave
    ? countLeaveBetween(leavePeriods, admissionIndex, firstUpcomingIndex)
    : Math.max(0, Number(leaveSemesters) || 0);
  const estimated = Math.max(0, firstUpcomingIndex - admissionIndex - leave);
  const recordsCoverAdmission = recordedIndexes.size > 0 && Math.min(...recordedIndexes) <= admissionIndex;

  let enrolledBefore;
  let source;
  let needsConfirmation;
  if (knownLeave) {
    // 휴학 질문에 답한 학생은 휴학 기간을 직접 알려 줬으니 그 값으로 센다(홈 화면과 같은 값). 기록의 빈 학기를 휴학으로 보던 방식은
    // 휴학 시기를 묻지 않던 때의 설계라, 최근 학기 과목을 아직 안 넣은 학생을 낮은 학년으로 계산했다(2026-10-17 로컬 재현: 휴학 없는
    // 2024학번이 2025-1까지만 과목을 넣자 챗봇이 "2학년 1학기"라고 하고 2학년 과목을 권했다). 이수 기록은 이수 과목 목록에만 쓴다.
    enrolledBefore = estimated;
    source = 'PROFILE';
    needsConfirmation = false;
  } else if (recordsCoverAdmission) {
    source = 'RECORDS';
    // 이번 학기를 아직 등록하지 않았다면 추정값은 이번 학기까지 센 값이라 기록보다 하나 많은 게 정상이다 —
    // 이때는 이번 학기도 다니는 중으로 보고 추정값을 쓴다(기록만 세면 진행 중인 학기가 빠져 학년이 한 학기 낮게 나온다).
    const currentRecorded = recordedIndexes.has(termIndex(currentTerm));
    const consistent = recordedIndexes.size === estimated || (!currentRecorded && recordedIndexes.size + 1 === estimated);
    enrolledBefore = consistent ? estimated : recordedIndexes.size;
    if (!consistent) flags.push('RECORDS_LEAVE_MISMATCH');
    needsConfirmation = !consistent;
  } else {
    enrolledBefore = estimated;
    source = 'ESTIMATED';
    needsConfirmation = true;
  }

  const maxGrade = programYears;
  // 수업연한을 넘긴 학기는 "초과 N학기"로 센다(수업연한까지는 학년·학기, 그 뒤는 초과학기).
  const standingOf = (enrolledTermNumber) => {
    const rawGrade = startGrade + Math.floor((enrolledTermNumber - 1) / 2);
    const extended = rawGrade > maxGrade;
    const termsBeforeExtension = (maxGrade - startGrade + 1) * 2;
    return {
      grade: Math.min(maxGrade, rawGrade),
      gradeSemester: extended ? null : ((enrolledTermNumber - 1) % 2) + 1,
      extended,
      extraTerms: extended ? enrolledTermNumber - termsBeforeExtension : 0,
    };
  };

  const upcomingTerms = [];
  for (let i = 0; i < UPCOMING_TERM_COUNT; i++) {
    const enrolled = enrolledBefore + i;
    const s = standingOf(enrolled + 1);
    upcomingTerms.push({
      ...termFromIndex(firstUpcomingIndex + i),
      grade: s.grade,
      enrolledTermNumber: enrolled + 1,
      extended: s.extended,
    });
  }
  if (upcomingTerms.some((t) => t.extended)) flags.push('EXTENDED_TERM');

  // 지금 학기(방학이면 직전 학기 — academicTermOf가 1~2월을 전년도 2학기, 7~8월을 1학기로 본다, DECISIONS D-64).
  // 재학 학기 수(enrolledBefore)는 지금 학기까지 센 값이라 그대로 "지금 몇 번째 학기"다. 지금 학기가 휴학이면 onLeave.
  const currentIndex = termIndex(currentTerm);
  const onLeave = knownLeave && currentIndex >= admissionIndex && countLeaveBetween(leavePeriods, currentIndex, currentIndex + 1) > 0;
  // 입학하자마자 휴학해 아직 다닌 학기가 없으면 학년은 없고 "휴학 중"만 알린다(grade: null). 예전에는 null이라 홈에서 학년 줄과
  // "학년이 다르신가요?" 링크가 같이 사라졌다(2026-10-15 운영 점검, #378).
  const current = enrolledBefore > 0
    ? { ...currentTerm, enrolledTermNumber: enrolledBefore, onLeave, ...standingOf(enrolledBefore) }
    : onLeave
      ? { ...currentTerm, enrolledTermNumber: 0, onLeave: true, grade: null, gradeSemester: null, extended: false, extraTerms: 0 }
      : null;

  return {
    today,
    currentTerm,
    source,
    needsConfirmation,
    flags,
    enrolledTermsCompleted: enrolledBefore,
    leaveSemesters: leave,
    leavePeriods: knownLeave ? leavePeriods : null,
    programYears,
    current,
    upcomingTerms,
  };
}

/**
 * 이수 기록 없이 프로필(학번·입학 유형·편입 학년·휴학 기간)만으로 지금 학년·학기를 계산한다. 로그인·/api/me 응답(studentService.serializeStudent)처럼
 * DB를 더 읽지 않아야 하는 곳에서 쓴다. 챗봇은 이수 기록까지 넣은 getStudentProgress를 쓴다.
 */
function currentStandingOf(student, { today = todayKst() } = {}) {
  if (!student || !student.admission_year) return null;
  const progress = computeProgress({
    admissionYear: student.admission_year,
    enrollmentType: student.enrollment_type,
    transferGrade: student.transfer_grade,
    leaveSemesters: student.leave_semesters,
    leavePeriods: parseLeavePeriods(student.leave_periods),
    today,
    programYears: programYearsOf(student.department_name),
  });
  return progress && progress.current ? { ...progress.current, source: progress.source } : null;
}

// 조기졸업자는 6학기 이상 등록하면 된다(시행규칙 제118조 제1호 단서, 학칙 제25조 제5항). 4년제 과정에만 안내한다.
const EARLY_GRADUATION_TERMS = 6;
// 조기졸업을 신청할 수 없는 학과(시행규칙 제126조 제2항 제6호): 의과대학, 치과대학, 한의과대학, 약학대학, 간호대학, 건축학과, 보건계열 9개 학과.
// 전과생·편입생(제4호)도 신청할 수 없다. 재입학생(제4호)과 학사구조조정 소속변경자(제5호)는 입력받지 않아 가려내지 못한다.
const EARLY_GRADUATION_RESTRICTED_DEPARTMENTS = new Set([
  '의예과', '의학과', '치의예과', '치의학과', '한의예과', '한의학과', '약학과', '한약학과', '간호학과', '건축학과',
  '작업치료학과', '임상병리학과', '물리치료학과', '방사선학과', '치기공학과', '치위생학과', '응급구조학과', '안경광학과',
]);
function canGraduateEarly(student, programYears) {
  if (programYears !== DEFAULT_PROGRAM_YEARS) return false; // 전문학사(제7호)·5·6년제
  if (student.enrollment_type === 'MAJOR_CHANGE' || student.enrollment_type === 'TRANSFER_ADMISSION') return false;
  return !EARLY_GRADUATION_RESTRICTED_DEPARTMENTS.has(student.department_name);
}

/**
 * 졸업사정의 등록기간(시행규칙 제118조 제1호: 수업연한 이상 등록한 자)을 셀 등록 학기 수(#378 H-2, 결정 A). 프로필만으로 센다(홈과 같은 값).
 * - 휴학한 학기는 등록 학기가 아니다(재학 학기 수 = 경과 학기 − 휴학).
 * - 편입생은 편입 학년 앞의 학기를 등록한 것으로 본다(3학년 편입이면 4학기 + 편입 뒤 재학 학기).
 * - 지금 다니는 학기도 등록한 학기로 센다.
 * @returns {{ registered, required, earlyGraduation: number|null, estimated: boolean } | null}
 */
function registrationTermsOf(student, { today = todayKst() } = {}) {
  const standing = currentStandingOf(student, { today });
  if (!standing) return null;
  const isTransfer = student.enrollment_type === 'TRANSFER_ADMISSION';
  const startGrade = isTransfer ? (student.transfer_grade != null ? Number(student.transfer_grade) : TRANSFER_START_GRADE) : 1;
  const programYears = programYearsOf(student.department_name);
  return {
    registered: standing.enrolledTermNumber + (startGrade - 1) * 2,
    required: programYears * 2,
    // 조기졸업 6학기는 신청할 수 있는 학생에게만 안내한다(제126조 제2항 — 2026-10-16 규정 대조에서 찾음).
    earlyGraduation: canGraduateEarly(student, programYears) ? EARLY_GRADUATION_TERMS : null,
    // 휴학 기간을 아직 답하지 않은 계정은 누적 휴학 학기 수로만 센 값이다(시기를 모름).
    estimated: standing.source === 'ESTIMATED',
  };
}

/** 이수 과목명 목록(중복 제거). 낙제(F·NP)와 재수강으로 대체된 이전 기록은 뺀다 — 졸업요건 계산(graduationService)과 같은 기준. */
function completedCourseNames(rows, supersededIds = new Set()) {
  const names = [];
  const seen = new Set();
  for (const row of rows) {
    if (supersededIds.has(row.id)) continue;
    if (row.letter_grade && FAILING_GRADES.includes(row.letter_grade)) continue;
    if (seen.has(row.name)) continue;
    seen.add(row.name);
    names.push(row.name);
  }
  return names;
}

async function getStudentProgress(studentId, student, { today = todayKst() } = {}) {
  if (!student || !student.admission_year) return null;

  const [rows] = await pool.query(
    'SELECT id, name, year, semester, letter_grade FROM student_courses WHERE student_id = ? ORDER BY year, semester, id',
    [studentId]
  );
  const progress = computeProgress({
    admissionYear: student.admission_year,
    enrollmentType: student.enrollment_type,
    transferGrade: student.transfer_grade,
    leaveSemesters: student.leave_semesters,
    leavePeriods: parseLeavePeriods(student.leave_periods),
    recordedTerms: rows.map((r) => ({ year: r.year, semester: r.semester })),
    today,
    programYears: programYearsOf(student.department_name),
  });
  if (!progress) return null;

  const supersededIds = await getSupersededCourseIds(studentId);
  return { ...progress, completedCourseNames: completedCourseNames(rows, supersededIds) };
}

module.exports = { computeProgress, completedCourseNames, getStudentProgress, termLabel, currentStandingOf, registrationTermsOf, programYearsOf, PROGRAM_YEARS };
