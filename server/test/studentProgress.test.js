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

test('buildSystemPrompt: progress를 넘기면 포함하고, 안 넘기면 기존 프롬프트와 같다', () => {
  const base = buildSystemPrompt(null, null, null, 'ko');
  assert.equal(buildSystemPrompt(null, null, null, 'ko', null), base);
  const p = computeProgress({ admissionYear: 2022, leaveSemesters: 4, recordedTerms: [], today: TODAY });
  assert.match(buildSystemPrompt(null, null, null, 'ko', { ...p, completedCourseNames: [] }), /수강 진행 상태/);
});
