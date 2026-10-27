const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { observe, acknowledge, summarize, diffSummaries, inputHash } = require('../services/changeNoticeService');
const { updatesSince } = require('../services/dataUpdates');

/**
 * server/test/changeNotice.test.js
 * 바뀐 자료 알림: 입력(학생 정보·과목)은 그대로인데 진단 요약이 바뀐 학생에게만 알린다.
 *  - 요약에는 필요 학점·남은 학점·졸업인증만 넣고, 날짜에 따라 바뀌는 값과 일반선택은 뺀다
 *  - 여러 번 바뀌어도 "마지막으로 확인한 요약 → 지금 요약" 한 장이고, 돌아온 항목은 빠진다
 *  - 학생이 입력을 바꾸면 알리지 않고 기준만 새로 잡는다. [확인]하면 지금 요약이 기준이 된다
 * 앞쪽은 순수 함수, 뒤쪽은 로컬 DB(테스트용 학생을 만들고 지운다)로 본다.
 */

function status({ total = 130, earned = 72, major = 66, liberal = 35, general = 21, certMin = 1, certDone = 0, inProgress = 0 } = {}) {
  return {
    totalRequiredCredits: total,
    totalEarnedCredits: earned,
    inProgressCredits: inProgress,
    categories: [
      { category: '전공', requiredCredits: major, earnedCredits: 40 },
      { category: '교양선택', requiredCredits: liberal, earnedCredits: 30 },
      { category: '일반선택', requiredCredits: general, earnedCredits: 2 },
    ],
    certifications: [{ category: '졸업인증제', minCourseCount: certMin, completedCourses: Array(certDone).fill('기업연계프로젝트1') }],
  };
}
const keys = (items) => items.map((i) => `${i.key}:${i.before}->${i.after}`);

describe('요약과 비교', () => {
  test('날짜에 따라 바뀌는 값(수강 중 학점)과 일반선택은 비교하지 않는다', () => {
    assert.deepEqual(diffSummaries(summarize(status()), summarize(status({ inProgress: 9, general: 30 }))), []);
  });

  test('필요 학점·남은 학점·졸업인증이 바뀐 항목만, 필요 → 남은 순서로', () => {
    const items = diffSummaries(summarize(status()), summarize(status({ total: 136, earned: 72, certMin: 2 })));
    assert.deepEqual(keys(items), ['total:130->136', 'certRequired:졸업인증제:1->2', 'remaining:58->64', 'certRemaining:졸업인증제:1->2']);
  });

  test('새로 생긴 필요 항목은 없음(null)에서, 남은 항목은 0에서 시작한다', () => {
    const before = summarize({ ...status(), certifications: [] });
    const items = diffSummaries(before, summarize(status({ certMin: 2 })));
    assert.deepEqual(keys(items), ['certRequired:졸업인증제:null->2', 'certRemaining:졸업인증제:0->2']);
  });

  test('요건 자료가 없던(졸업 학점 0) 쪽이 있으면 알리지 않는다', () => {
    assert.deepEqual(diffSummaries(summarize(status({ total: 0, earned: 0 })), summarize(status())), []);
  });

  test('입력 지문은 진단에 쓰는 칸만 본다 — 언어·동의 시각이 바뀌어도 같고, 과목이 바뀌면 다르다', () => {
    const student = { department_id: 1, admission_year: 2024, language: 'ko', consented_at: 'a' };
    const courses = [{ id: 2, name: 'B', credits: 3 }, { id: 1, name: 'A', credits: 3 }];
    const base = inputHash(student, courses);
    assert.equal(inputHash({ ...student, language: 'en', consented_at: 'b' }, [...courses].reverse()), base);
    assert.notEqual(inputHash(student, [...courses, { id: 3, name: 'C', credits: 3 }]), base);
    assert.notEqual(inputHash({ ...student, admission_year: 2025 }, courses), base);
  });

  test('반영된 갱신은 기준 날짜(같은 날 포함) 이후만 날짜순으로', () => {
    const updates = [{ date: '2026-11-02', note: 'c' }, { date: '2026-08-01', note: 'a' }, { date: '2026-09-10', note: 'b' }];
    assert.deepEqual(updatesSince('2026-08-01', updates).map((u) => u.note), ['a', 'b', 'c']);
    assert.deepEqual(updatesSince('2026-09-11', updates).map((u) => u.note), ['c']);
  });
});

// ---- DB(로컬) ----
let studentId;

before(async () => {
  const [d] = await pool.query('SELECT id FROM departments ORDER BY id LIMIT 1');
  const [s] = await pool.query(
    "INSERT INTO students (email, name, department_id, admission_year, enrollment_type, onboarding_completed_at) VALUES (?, ?, ?, 2024, 'GENERAL', NOW())",
    [`changenotice-${Date.now()}@example.test`, `changenotice${Date.now()}`, d[0].id]
  );
  studentId = s.insertId;
});

after(async () => {
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

const pending = async () => (await pool.query('SELECT pending_summary FROM graduation_snapshots WHERE student_id = ?', [studentId]))[0][0].pending_summary;

describe('알림 흐름(DB)', () => {
  test('처음에는 기준만 잡고, 그대로면 알리지 않는다', async () => {
    assert.equal(await observe(studentId, status()), null);
    assert.equal(await observe(studentId, status()), null);
  });

  test('입력이 그대로인데 결과가 바뀌면 알리고, 여러 번 바뀌어도 기준 → 지금 한 장이다', async () => {
    let notice = await observe(studentId, status({ certMin: 2 }));
    assert.deepEqual(keys(notice.items), ['certRequired:졸업인증제:1->2', 'certRemaining:졸업인증제:1->2']);
    assert.match(notice.since, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Array.isArray(notice.updates));

    // 다시 바뀜: 졸업학점이 줄고, 졸업인증은 원래대로 돌아옴 → 돌아온 항목은 빠진다
    notice = await observe(studentId, status({ total: 124, earned: 72 }));
    assert.deepEqual(keys(notice.items), ['total:130->124', 'remaining:58->52']);
  });

  test('바뀌었다가 전부 원래대로 돌아오면 알림도 지운다', async () => {
    assert.equal(await observe(studentId, status()), null);
    assert.equal(await pending(), null);
  });

  test('[확인]하면 지금 결과가 기준이 되어 다시 알리지 않는다', async () => {
    assert.ok(await observe(studentId, status({ major: 72 })));
    assert.equal(await acknowledge(studentId), true);
    assert.equal(await observe(studentId, status({ major: 72 })), null);
    assert.equal(await acknowledge(studentId), false, '알림이 없으면 확인할 것도 없다');
  });

  test('학생이 과목을 바꾸면 결과가 달라져도 알리지 않고 기준만 새로 잡는다', async () => {
    await pool.query("INSERT INTO student_courses (student_id, name, credits, category, year, semester) VALUES (?, '테스트과목', 3, '전공선택', 2024, 1)", [studentId]);
    assert.equal(await observe(studentId, status({ major: 72, earned: 75 })), null);
    assert.equal(await observe(studentId, status({ major: 72, earned: 75 })), null);
  });
});
