const { test } = require('node:test');
const assert = require('node:assert/strict');
const lp = require('../services/leavePeriods');
const { computeProgress } = require('../services/studentProgress');
const { buildProgressNote } = require('../services/aiClient');

/**
 * server/test/leavePeriods.test.js
 * 휴학 기간(students.leave_periods)의 해석·검증과, 그 값이 수강 진행 상태에 반영되는지 — DB 없이 도는 순수 함수 테스트.
 * 제13조③ "재학 중인 학년"에 반영되는 것은 regulationEngine.resolve.test.js에서 본다.
 * 오늘은 2026-10-13(2026학년도 2학기 중)으로 고정한다.
 */

const TODAY = '2026-10-13';
const general2022 = { admissionYear: 2022, enrollmentType: 'GENERAL', transferGrade: null };

test('parseLeavePeriods: NULL은 미응답(null), []는 휴학 없음, 문자열 JSON도 읽고 깨진 값은 미응답으로 본다', () => {
  assert.equal(lp.parseLeavePeriods(null), null);
  assert.deepEqual(lp.parseLeavePeriods([]), []);
  assert.deepEqual(lp.parseLeavePeriods('[{"startYear":2023,"startSemester":1,"semesters":2}]'), [{ startYear: 2023, startSemester: 1, semesters: 2 }]);
  assert.equal(lp.parseLeavePeriods('not json'), null);
  assert.equal(lp.parseLeavePeriods({ a: 1 }), null);
});

test('validateLeavePeriods: 정상 입력은 시작 학기 순으로 정렬하고, 형식·입학 전·먼 미래·겹침은 거부한다', () => {
  const ok = lp.validateLeavePeriods([{ startYear: 2025, startSemester: 1, semesters: 1 }, { startYear: 2023, startSemester: 1, semesters: 4 }], general2022, { today: TODAY });
  assert.deepEqual(ok.periods.map((p) => p.startYear), [2023, 2025]);
  assert.deepEqual(lp.validateLeavePeriods([], general2022, { today: TODAY }), { periods: [] });

  const err = (input, student = general2022) => lp.validateLeavePeriods(input, student, { today: TODAY }).error;
  assert.equal(err('x'), 'INVALID_LEAVE_PERIODS');
  assert.equal(err([{ startYear: 2023, startSemester: 3, semesters: 1 }]), 'INVALID_LEAVE_PERIODS');
  assert.equal(err([{ startYear: 2023, startSemester: 1, semesters: 0 }]), 'INVALID_LEAVE_PERIODS');
  assert.equal(err([{ startYear: 2021, startSemester: 2, semesters: 1 }]), 'LEAVE_BEFORE_ADMISSION');
  // 다음 학기(2027-1) 휴학까지는 받고, 그 뒤는 받지 않는다
  assert.equal(err([{ startYear: 2027, startSemester: 1, semesters: 2 }]), undefined);
  assert.equal(err([{ startYear: 2027, startSemester: 2, semesters: 1 }]), 'LEAVE_IN_FUTURE');
  assert.equal(err([{ startYear: 2023, startSemester: 1, semesters: 4 }, { startYear: 2024, startSemester: 2, semesters: 1 }]), 'LEAVE_PERIODS_OVERLAP');
  // 편입생은 편입 학기부터만 받는다(2024학번 기준 3학년 편입 = 2026학년도 1학기 편입)
  const transfer = { admissionYear: 2024, enrollmentType: 'TRANSFER_ADMISSION', transferGrade: 3 };
  assert.equal(err([{ startYear: 2025, startSemester: 2, semesters: 1 }], transfer), 'LEAVE_BEFORE_ADMISSION');
  assert.equal(err([{ startYear: 2026, startSemester: 2, semesters: 1 }], transfer), undefined);
});

test('gradeAtYearStart: 휴학 기간을 모르면 입학년도만으로(기존 동작), 알면 그 전에 쉰 학기를 빼고 센다', () => {
  assert.equal(lp.gradeAtYearStart(general2022, 2025, null), 4);
  assert.equal(lp.gradeAtYearStart(general2022, 2025, []), 4);
  // 2022-2부터 4학기(2022-2 ~ 2024-1) 휴학 → 2025-1 직전까지 다닌 학기는 6 − 4 = 2 → 2학년
  assert.equal(lp.gradeAtYearStart(general2022, 2025, [{ startYear: 2022, startSemester: 2, semesters: 4 }]), 2);
  // 그 해 이후의 휴학은 영향이 없다
  assert.equal(lp.gradeAtYearStart(general2022, 2025, [{ startYear: 2025, startSemester: 1, semesters: 2 }]), 4);
});

test('수강 진행 상태: 휴학 질문에 답했으면(PROFILE) 확정값으로 쓰고, 프롬프트에 입력한 기간을 적는다', () => {
  const periods = [{ startYear: 2023, startSemester: 1, semesters: 4 }];
  const p = computeProgress({ admissionYear: 2022, leaveSemesters: 4, leavePeriods: periods, recordedTerms: [], today: TODAY });
  assert.equal(p.source, 'PROFILE');
  assert.equal(p.needsConfirmation, false);
  assert.deepEqual([p.upcomingTerms[0].year, p.upcomingTerms[0].semester, p.upcomingTerms[0].grade], [2027, 1, 4]);
  const note = buildProgressNote({ ...p, completedCourseNames: [] });
  assert.match(note, /입력한 휴학 기간\(2023학년도 1학기부터 4학기\)/);
  assert.doesNotMatch(note, /확정이 아니다/);
  assert.doesNotMatch(note, /몇 학년 몇 학기에 휴학했는지/);

  // 휴학 없음으로 답함
  const none = computeProgress({ admissionYear: 2022, leavePeriods: [], recordedTerms: [], today: TODAY });
  assert.equal(none.source, 'PROFILE');
  assert.match(buildProgressNote({ ...none, completedCourseNames: [] }), /휴학한 적 없음/);

  // 다음 학기 휴학은 지금까지 다닌 학기 수에 넣지 않는다
  const nextLeave = computeProgress({ admissionYear: 2022, leavePeriods: [{ startYear: 2027, startSemester: 1, semesters: 1 }], recordedTerms: [], today: TODAY });
  assert.equal(nextLeave.leaveSemesters, 0);
});
