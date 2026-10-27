const test = require('node:test');
const assert = require('node:assert/strict');
const { computeProgress, completedCourseNames } = require('../services/studentProgress');
const { buildProgressNote, buildSystemPrompt } = require('../services/aiClient');

// DB 없이 도는 순수 함수 테스트. 오늘은 2026-10-11(2026학년도 2학기 중)로 고정한다.
// 기록의 semester는 DB 코드(1=1학기, 2=여름, 3=2학기, 4=겨울)다.
const TODAY = '2026-10-11';
const T = (year, semester) => ({ year, semester });

test('이수 기록이 없는 22학번(휴학 4학기): 다음 학기 2027-1은 재학 7번째 학기, 4학년 — 추정이라 확인이 필요하다', () => {
  const p = computeProgress({ admissionYear: 2022, leaveSemesters: 4, recordedTerms: [], today: TODAY });
  assert.deepEqual(p.currentTerm, { year: 2026, semester: 2 });
  assert.equal(p.source, 'ESTIMATED');
  assert.equal(p.needsConfirmation, true);
  assert.equal(p.enrolledTermsCompleted, 6);
  assert.deepEqual(p.upcomingTerms.map((t) => [t.year, t.semester, t.grade, t.enrolledTermNumber]), [
    [2027, 1, 4, 7],
    [2027, 2, 4, 8],
  ]);
});

test('입학 학기부터 이어진 이수 기록이 프로필 휴학 수와 맞으면 기록 기준 — 확인 불필요', () => {
  // 2022 1·2학기, (2023·2024 휴학), 2025 1·2학기, 2026 1·2학기
  const recordedTerms = [T(2022, 1), T(2022, 3), T(2025, 1), T(2025, 3), T(2026, 1), T(2026, 3)];
  const p = computeProgress({ admissionYear: 2022, leaveSemesters: 4, recordedTerms, today: TODAY });
  assert.equal(p.source, 'RECORDS');
  assert.equal(p.needsConfirmation, false);
  assert.deepEqual(p.flags, []);
  assert.equal(p.upcomingTerms[0].grade, 4);
});

test('기록의 빈 학기가 프로필 휴학 수와 다르면 기록 기준으로 계산하고 확인을 요청한다', () => {
  const recordedTerms = [T(2022, 1), T(2022, 3), T(2025, 1), T(2025, 3), T(2026, 1), T(2026, 3)];
  const p = computeProgress({ admissionYear: 2022, leaveSemesters: 0, recordedTerms, today: TODAY });
  assert.equal(p.source, 'RECORDS');
  assert.equal(p.enrolledTermsCompleted, 6);
  assert.equal(p.needsConfirmation, true);
  assert.ok(p.flags.includes('RECORDS_LEAVE_MISMATCH'));
});

test('이번 학기를 아직 등록하지 않았어도 휴학 수와 맞으면 진행 중인 이번 학기를 센다', () => {
  const recordedTerms = [T(2022, 1), T(2022, 3), T(2025, 1), T(2025, 3), T(2026, 1)]; // 2026-2 기록 없음
  const p = computeProgress({ admissionYear: 2022, leaveSemesters: 4, recordedTerms, today: TODAY });
  assert.equal(p.source, 'RECORDS');
  assert.equal(p.needsConfirmation, false);
  assert.equal(p.enrolledTermsCompleted, 6);
  assert.equal(p.upcomingTerms[0].grade, 4);
});

test('이수 기록이 입학 학기부터 시작하지 않으면(일부만 등록) 기록 대신 추정을 쓴다', () => {
  const p = computeProgress({ admissionYear: 2022, leaveSemesters: 4, recordedTerms: [T(2026, 3)], today: TODAY });
  assert.equal(p.source, 'ESTIMATED');
  assert.equal(p.enrolledTermsCompleted, 6);
});

test('계절학기 기록(여름 2, 겨울 4)은 재학 학기 수에 세지 않는다', () => {
  const recordedTerms = [T(2022, 1), T(2022, 2), T(2022, 3), T(2022, 4), T(2025, 1), T(2025, 3), T(2026, 1), T(2026, 3)];
  const p = computeProgress({ admissionYear: 2022, leaveSemesters: 4, recordedTerms, today: TODAY });
  assert.equal(p.enrolledTermsCompleted, 6);
  assert.equal(p.source, 'RECORDS');
});

test('휴학 없는 23학번은 2027-1이 재학 9번째 학기라 정규 4학년을 넘긴 초과학기로 표시한다', () => {
  const p = computeProgress({ admissionYear: 2023, leaveSemesters: 0, recordedTerms: [], today: TODAY });
  assert.equal(p.enrolledTermsCompleted, 8);
  assert.deepEqual(p.upcomingTerms[0], { year: 2027, semester: 1, grade: 4, enrolledTermNumber: 9, extended: true });
  assert.ok(p.flags.includes('EXTENDED_TERM'));
});

test('4학년 2학기 학생: 진행 상태에 "지금 학년·학기"가 있고, 초과학기 표시는 다음 학기 이야기라고 못박는다(#378)', () => {
  // 2026-10-15 운영 점검: 23학번(지금 4학년 2학기)에게 챗봇이 "현재 초과학기 재학 중"이라고 답했다. "정규 4학년을 넘긴 초과학기다"라는
  // 주어 없는 참고 문장을 지금 상태로 읽은 것이다.
  const p = computeProgress({ admissionYear: 2023, leaveSemesters: 0, recordedTerms: [], today: TODAY });
  const note = buildProgressNote({ ...p, completedCourseNames: [] });
  assert.match(note, /지금 학년·학기: 4학년 2학기\(재학 8번째 학기\)/);
  assert.match(note, /지금 학기가 초과학기라는 뜻이 아니다/);
  assert.doesNotMatch(note, /정규 4학년을 넘긴 초과학기다/);
});

test('편입생은 3학년에서 시작한다고 가정한다', () => {
  const p = computeProgress({ admissionYear: 2025, enrollmentType: 'TRANSFER_ADMISSION', leaveSemesters: 0, recordedTerms: [], today: TODAY });
  // 2025-1 ~ 2026-2 = 4학기 → 3 + 2 = 5학년이 아니라 최대 4, 초과학기
  assert.equal(p.upcomingTerms[0].grade, 4);
  assert.ok(p.flags.includes('TRANSFER_GRADE_ASSUMED'));
  const early = computeProgress({ admissionYear: 2026, enrollmentType: 'TRANSFER_ADMISSION', leaveSemesters: 0, recordedTerms: [], today: '2026-04-01' });
  assert.equal(early.upcomingTerms[0].grade, 3); // 2026-2 = 재학 2번째 학기 → 3학년 2학기
  assert.equal(early.upcomingTerms[0].enrolledTermNumber, 2);
});

test('편입 학년을 입력한 편입생(2026년 3학년 편입 → 2024학번): 편입 학기부터 세고 3학년에서 시작한다, 가정 플래그 없음', () => {
  // 2026-1에 3학년으로 편입 → 2026-1·2학기를 마치면 다음 학기 2027-1은 재학 3번째 학기이자 4학년 1학기.
  const noRecords = computeProgress({ admissionYear: 2024, enrollmentType: 'TRANSFER_ADMISSION', transferGrade: 3, leaveSemesters: 0, recordedTerms: [], today: TODAY });
  assert.equal(noRecords.enrolledTermsCompleted, 2);
  const first = noRecords.upcomingTerms[0];
  assert.deepEqual([first.year, first.semester, first.grade, first.enrolledTermNumber], [2027, 1, 4, 3]);
  assert.ok(!noRecords.flags.includes('TRANSFER_GRADE_ASSUMED'));
  assert.equal(noRecords.source, 'ESTIMATED');
  // 이수 기록이 편입 학기(2026-1)부터 이어져 있으면 기록으로 센다(편입 전 학기는 본교 기록이 없어도 정상).
  const withRecords = computeProgress({ admissionYear: 2024, enrollmentType: 'TRANSFER_ADMISSION', transferGrade: 3, leaveSemesters: 0, recordedTerms: [T(2026, 1), T(2026, 3)], today: TODAY });
  assert.equal(withRecords.source, 'RECORDS');
  assert.equal(withRecords.needsConfirmation, false);
  assert.equal(withRecords.upcomingTerms[0].grade, 4);
});

test('편입 학년을 모르는 옛 편입생은 기존대로 입력한 해부터 3학년으로 시작한다고 가정한다(변화 없음)', () => {
  const p = computeProgress({ admissionYear: 2026, enrollmentType: 'TRANSFER_ADMISSION', transferGrade: null, leaveSemesters: 0, recordedTerms: [], today: '2026-04-01' });
  assert.equal(p.upcomingTerms[0].grade, 3);
  assert.ok(p.flags.includes('TRANSFER_GRADE_ASSUMED'));
});

test('편입생이 아닌 학생의 transferGrade 값은 학년 계산에 쓰지 않는다', () => {
  const p = computeProgress({ admissionYear: 2024, enrollmentType: 'GENERAL', transferGrade: 3, leaveSemesters: 0, recordedTerms: [], today: TODAY });
  assert.equal(p.upcomingTerms[0].grade, 4);
  assert.equal(p.upcomingTerms[0].enrolledTermNumber, 7);
});

test('방학 중(1~2월)이면 직전 학년도 2학기가 현재 학기고 다음은 새 학년도 1학기', () => {
  const p = computeProgress({ admissionYear: 2022, leaveSemesters: 0, recordedTerms: [], today: '2027-01-15' });
  assert.deepEqual(p.currentTerm, { year: 2026, semester: 2 });
  assert.deepEqual([p.upcomingTerms[0].year, p.upcomingTerms[0].semester], [2027, 1]);
});

test('8월 수강신청 시기에는 같은 해 2학기가 다음 학기', () => {
  const p = computeProgress({ admissionYear: 2022, leaveSemesters: 0, recordedTerms: [], today: '2026-08-20' });
  assert.deepEqual([p.upcomingTerms[0].year, p.upcomingTerms[0].semester], [2026, 2]);
});

test('학번이 없으면(온보딩 전) null', () => {
  assert.equal(computeProgress({ admissionYear: null, today: TODAY }), null);
});

test('completedCourseNames: 낙제·재수강 대체 기록·중복은 뺀다', () => {
  const rows = [
    { id: 1, name: '자료구조', letter_grade: 'A+' },
    { id: 2, name: '운영체제', letter_grade: 'F' },
    { id: 3, name: '알고리즘', letter_grade: null }, // 성적 미입력(진행 중)은 포함
    { id: 4, name: '데이터베이스', letter_grade: 'B0' }, // 재수강으로 대체됨
    { id: 5, name: '자료구조', letter_grade: 'B+' }, // 중복
    { id: 6, name: '철학', letter_grade: 'NP' },
  ];
  assert.deepEqual(completedCourseNames(rows, new Set([4])), ['자료구조', '알고리즘']);
});

test('buildProgressNote: 다음 학기·근거·확인 안내·이수 과목이 들어가고, 없으면 null', () => {
  assert.equal(buildProgressNote(null), null);
  const p = computeProgress({ admissionYear: 2022, leaveSemesters: 4, recordedTerms: [], today: TODAY });
  const note = buildProgressNote({ ...p, completedCourseNames: ['자료구조', '알고리즘'] });
  assert.match(note, /2027학년도 1학기\(재학 7번째 학기, 4학년\)/);
  assert.match(note, /그다음 2027학년도 2학기\(재학 8번째 학기, 4학년\)/);
  assert.match(note, /누적 휴학 학기 수\(4학기\)로 한 추정/);
  assert.match(note, /확정이 아니다/);
  assert.match(note, /이미 이수한 과목.*2개: 자료구조, 알고리즘/);

  const confirmed = computeProgress({
    admissionYear: 2022, leaveSemesters: 4, today: TODAY,
    recordedTerms: [T(2022, 1), T(2022, 3), T(2025, 1), T(2025, 3), T(2026, 1), T(2026, 3)],
  });
  assert.doesNotMatch(buildProgressNote({ ...confirmed, completedCourseNames: [] }), /확정이 아니다/);
  assert.match(buildProgressNote({ ...confirmed, completedCourseNames: [] }), /등록된 과목이 없다/);
});

test('buildProgressNote: 휴학 시기를 모를 때(추정 + 휴학 있음)만 시기에 따라 갈리는 질문은 먼저 휴학 시기를 묻게 한다', () => {
  const ask = /몇 학년 몇 학기에 휴학했는지" 물어라/;
  // 과목을 등록하지 않았고 휴학 4학기 — 시기를 모른다
  const unknown = computeProgress({ admissionYear: 2022, leaveSemesters: 4, recordedTerms: [], today: TODAY });
  const note = buildProgressNote({ ...unknown, completedCourseNames: [] });
  assert.match(note, ask);
  assert.match(note, /누적 휴학 4학기가 언제였는지는 모른다/);
  assert.match(note, /제13조 제3항/);

  // 휴학이 없으면 물을 것이 없다
  const noLeave = computeProgress({ admissionYear: 2022, leaveSemesters: 0, recordedTerms: [], today: TODAY });
  assert.doesNotMatch(buildProgressNote({ ...noLeave, completedCourseNames: [] }), ask);

  // 이수 기록이 이어져 있으면 빈 학기로 시기를 알 수 있다
  const fromRecords = computeProgress({
    admissionYear: 2022, leaveSemesters: 4, today: TODAY,
    recordedTerms: [T(2022, 1), T(2022, 3), T(2025, 1), T(2025, 3), T(2026, 1), T(2026, 3)],
  });
  assert.equal(fromRecords.source, 'RECORDS');
  assert.doesNotMatch(buildProgressNote({ ...fromRecords, completedCourseNames: [] }), ask);
});

test('buildSystemPrompt: 메뉴 경로를 지어내지 않고, 이전 답변을 이번 근거에 없다는 이유만으로 뒤집지 않게 지시한다(#378)', () => {
  const sys = buildSystemPrompt(null, null, null, 'ko');
  assert.match(sys, /웹정보서비스 → 정보서비스 → 교육과정조회 →\s*교육과정조회\(학과별\)/);
  assert.match(sys, /근거에 없는 메뉴 이름을\s*지어내지 마라/);
  // 로컬 재현(2026-10-15): 변경 이력을 맞게 답한 다음 질문에서 "이전 답변은 근거 없는 추정이었다"고 스스로 정정했다.
  assert.match(sys, /이번 근거에 없다는 이유만으로 이전 답변이 틀렸다거나 추정이었다고 정정하지 말고/);
});

test('buildSystemPrompt: progress를 넘기면 포함하고, 안 넘기면 기존 프롬프트와 같다', () => {
  const base = buildSystemPrompt(null, null, null, 'ko');
  assert.equal(buildSystemPrompt(null, null, null, 'ko', null), base);
  const p = computeProgress({ admissionYear: 2022, leaveSemesters: 4, recordedTerms: [], today: TODAY });
  assert.match(buildSystemPrompt(null, null, null, 'ko', { ...p, completedCourseNames: [] }), /수강 진행 상태/);
});

// ---------------------------------------------------------------- 지금 학년·학기 하나로 모으기(#318, DECISIONS D-64)
const { currentStandingOf, programYearsOf } = require('../services/studentProgress');
const standing = (o) => {
  const c = computeProgress(o).current;
  return c && [c.grade, c.gradeSemester, c.extended, c.extraTerms, c.onLeave, c.enrolledTermNumber];
};

test('#318 예시: 휴학 1학기면 한 학년 높게 나오지 않고, 1월(방학)에는 직전 학기를 보여 준다', () => {
  // 2024학번, 2025-2 휴학 1학기, 2026-04-10 → 재학 4번째 학기 = 2학년 2학기(옛 공식은 3학년)
  assert.deepEqual(standing({ admissionYear: 2024, leavePeriods: [{ startYear: 2025, startSemester: 2, semesters: 1 }], today: '2026-04-10' }), [2, 2, false, 0, false, 4]);
  // 2024학번, 휴학 없음, 2026-01-15(겨울방학) → 직전 학기 2학년 2학기(옛 공식은 1월 1일에 3학년)
  assert.deepEqual(standing({ admissionYear: 2024, leavePeriods: [], today: '2026-01-15' }), [2, 2, false, 0, false, 4]);
});

test('#318 예시: 수업연한을 넘기면 "초과 N학기", 건축학과(5년)·약학과(6년)는 수업연한까지 학년으로 센다(학칙 제25조)', () => {
  assert.deepEqual(standing({ admissionYear: 2022, leavePeriods: [], today: TODAY }), [4, null, true, 2, false, 10]);
  assert.deepEqual(standing({ admissionYear: 2022, leavePeriods: [], today: TODAY, programYears: 5 }), [5, 2, false, 0, false, 10]);
  assert.deepEqual(standing({ admissionYear: 2021, leavePeriods: [], today: TODAY, programYears: 6 }), [6, 2, false, 0, false, 12]);
  assert.equal(programYearsOf('건축학과'), 5);
  assert.equal(programYearsOf('의학과'), 6);
  assert.equal(programYearsOf('약학과'), 6);
  assert.equal(programYearsOf('경영학과'), 4);
});

test('지금 학기가 휴학이면 마지막으로 다닌 학기와 함께 휴학 중으로 표시하고, 입학 전이면 없다', () => {
  assert.deepEqual(standing({ admissionYear: 2025, leavePeriods: [{ startYear: 2026, startSemester: 2, semesters: 1 }], today: TODAY }), [2, 1, false, 0, true, 3]);
  assert.equal(computeProgress({ admissionYear: 2027, leavePeriods: [], today: TODAY }).current, null);
});

test('입학하자마자 휴학해 다닌 학기가 없으면 학년 없이 휴학 중만 알리고, 챗봇 프로필 줄도 깨지지 않는다(#378 운영 점검)', () => {
  const leaveSinceAdmission = [{ startYear: 2026, startSemester: 1, semesters: 2 }];
  assert.deepEqual(standing({ admissionYear: 2026, leavePeriods: leaveSinceAdmission, today: TODAY }), [null, null, false, 0, true, 0]);
  const s = currentStandingOf({ admission_year: 2026, enrollment_type: 'GENERAL', leave_periods: JSON.stringify(leaveSinceAdmission), leave_semesters: 2, department_name: '건축학과' }, { today: TODAY });
  assert.deepEqual([s.grade, s.onLeave, s.enrolledTermNumber], [null, true, 0]);
  const student = { admission_year: 2026, enrollment_type: 'GENERAL', leave_periods: JSON.stringify(leaveSinceAdmission), leave_semesters: 2, department_name: '건축학과' };
  const progress = computeProgress({ admissionYear: 2026, leavePeriods: leaveSinceAdmission, today: TODAY });
  const prompt = buildSystemPrompt(student, null, null, 'ko', { ...progress, completedCourseNames: [] });
  assert.match(prompt, /현재: 입학 후 아직 다닌 학기 없음\(지금은 휴학 중\)/);
  assert.match(prompt, /지금 학년·학기: 입학 후 아직 다닌 학기 없음/);
  assert.doesNotMatch(prompt, /null학년/);
  // 휴학이 아닌데 다닌 학기가 없는 경우(입학 전)는 예전처럼 없다
  assert.equal(computeProgress({ admissionYear: 2027, leavePeriods: [], today: TODAY }).current, null);
});

test('currentStandingOf: DB 행(학생)만으로 계산하고 학과 수업연한을 쓴다 — 홈 화면·로그인 응답용', () => {
  const s = currentStandingOf({ admission_year: 2022, enrollment_type: 'GENERAL', leave_periods: '[]', leave_semesters: 0, department_name: '건축학과' }, { today: TODAY });
  assert.deepEqual([s.grade, s.gradeSemester, s.extended, s.source], [5, 2, false, 'PROFILE']);
  assert.equal(currentStandingOf({ admission_year: null }, { today: TODAY }), null);
});

test('챗봇 프로필 줄은 계산된 지금 학기를 쓴다(옛 "N학년(누적 휴학 반영)" 공식이 아니다)', () => {
  const student = { admission_year: 2024, enrollment_type: 'GENERAL', leave_periods: '[{"startYear":2025,"startSemester":2,"semesters":1}]', leave_semesters: 1, department_name: '경영학과' };
  const progress = computeProgress({ admissionYear: 2024, leavePeriods: [{ startYear: 2025, startSemester: 2, semesters: 1 }], today: '2026-04-10' });
  const prompt = buildSystemPrompt(student, null, null, 'ko', { ...progress, completedCourseNames: [] });
  assert.match(prompt, /현재: 2학년 2학기\(재학 4번째 학기\)/);
  assert.doesNotMatch(prompt, /누적 휴학 \d+학기 반영/);
});

const { registrationTermsOf } = require('../services/studentProgress');

test('등록 학기(졸업사정 등록기간, 시행규칙 제118조 제1호 — #378 H-2): 지금 학기까지 센 재학 학기, 4년제는 8학기·조기졸업 6학기', () => {
  const r = registrationTermsOf({ admission_year: 2023, enrollment_type: 'GENERAL', leave_periods: '[]', department_name: '경영학과' }, { today: TODAY });
  assert.deepEqual(r, { registered: 8, completed: 7, required: 8, earlyGraduation: 6, estimated: false });
});

test('수업이 끝난 학기(completed): 학기 중이면 지금 학기를 빼고, 방학이면 넣는다 — 4학년 1학기를 마친 여름방학에 7이 된다', () => {
  const s = { admission_year: 2023, enrollment_type: 'GENERAL', leave_periods: '[]', department_name: '경영학과' };
  const at = (today) => registrationTermsOf(s, { today });
  assert.deepEqual([at('2026-05-10').registered, at('2026-05-10').completed], [7, 6]); // 4학년 1학기 수업 중
  assert.deepEqual([at('2026-07-15').registered, at('2026-07-15').completed], [7, 7]); // 4학년 1학기를 마친 여름방학
  assert.deepEqual([at('2027-01-20').registered, at('2027-01-20').completed], [8, 8]); // 4학년 2학기를 마친 겨울방학
});

test('등록 학기: 휴학한 학기는 빼고, 휴학 시기를 모르면 추정으로 표시한다', () => {
  const leave = JSON.stringify([{ startYear: 2024, startSemester: 1, semesters: 2 }]);
  assert.equal(registrationTermsOf({ admission_year: 2023, enrollment_type: 'GENERAL', leave_periods: leave, department_name: '경영학과' }, { today: TODAY }).registered, 6);
  const unknown = registrationTermsOf({ admission_year: 2023, enrollment_type: 'GENERAL', leave_periods: null, leave_semesters: 2, department_name: '경영학과' }, { today: TODAY });
  assert.equal(unknown.registered, 6);
  assert.equal(unknown.estimated, true);
});

test('등록 학기: 편입생은 편입 학년 앞의 학기를 등록한 것으로 센다(3학년 편입 = 4학기 + 편입 뒤 재학 학기)', () => {
  // 2025년 3학년 편입 → admission_year는 "편입 연도 − 편입 학년 + 1" = 2023. 2025-1 ~ 2026-2 재학 4학기 + 앞의 4학기.
  const r = registrationTermsOf({ admission_year: 2023, enrollment_type: 'TRANSFER_ADMISSION', transfer_grade: 3, leave_periods: '[]', department_name: '경영학과' }, { today: TODAY });
  assert.equal(r.registered, 8);
});

test('등록 학기: 수업연한이 다른 학과 — 건축학과 10학기, 약학과 12학기(조기졸업 안내 없음), 2년제 4학기', () => {
  const of = (department_name) => registrationTermsOf({ admission_year: 2026, enrollment_type: 'GENERAL', leave_periods: '[]', department_name }, { today: TODAY });
  assert.deepEqual([of('건축학과').required, of('건축학과').earlyGraduation], [10, null]);
  assert.equal(of('약학과').required, 12);
  assert.deepEqual([of('외식조리과').required, of('외식조리과').registered], [4, 2]);
});

test('등록 학기: 예과(의예·치의예·한의예과)는 본과 진급 단계라 따지지 않는다(null) — 본과는 6년 기준 그대로', () => {
  const of = (department_name) => registrationTermsOf({ admission_year: 2025, enrollment_type: 'GENERAL', leave_periods: '[]', department_name }, { today: TODAY });
  for (const dept of ['의예과', '치의예과', '한의예과']) assert.equal(of(dept), null, dept);
  for (const dept of ['의학과', '치의학과', '한의학과']) assert.equal(of(dept).required, 12, dept);
});

test('등록 학기: 입학 학기 전이거나 학번이 없으면 null', () => {
  assert.equal(registrationTermsOf({ admission_year: null }, { today: TODAY }), null);
});

test('조기졸업 안내는 신청할 수 있는 학생에게만 — 전과생·편입생·의약·간호·보건계열·건축학과는 제한(시행규칙 제126조 제2항)', () => {
  const of = (over) => registrationTermsOf({ admission_year: 2024, enrollment_type: 'GENERAL', leave_periods: '[]', department_name: '경영학과', ...over }, { today: TODAY }).earlyGraduation;
  assert.equal(of({}), 6);
  assert.equal(of({ enrollment_type: 'MAJOR_CHANGE', major_change_grade: 2 }), null);
  assert.equal(of({ enrollment_type: 'TRANSFER_ADMISSION', transfer_grade: 3, admission_year: 2023 }), null);
  for (const d of ['간호학과', '물리치료학과', '한약학과', '건축학과']) assert.equal(of({ department_name: d }), null, d);
});

test('휴학 질문에 답한 학생은 이수 기록이 최근 학기까지 없어도 프로필(휴학 기간)로 학년을 센다(2026-10-17)', () => {
  // 휴학 없는 2024학번이 2025-1까지만 과목을 넣었다. 예전에는 빈 학기를 휴학으로 봐 "2학년 1학기"로 계산했다.
  const recordedTerms = [T(2024, 1), T(2024, 3), T(2025, 1)];
  const p = computeProgress({ admissionYear: 2024, leavePeriods: [], recordedTerms, today: TODAY });
  assert.equal(p.source, 'PROFILE');
  assert.equal(p.needsConfirmation, false);
  assert.deepEqual([p.current.grade, p.current.gradeSemester], [3, 2]);
  assert.ok(!p.flags.includes('RECORDS_LEAVE_MISMATCH'));
});
