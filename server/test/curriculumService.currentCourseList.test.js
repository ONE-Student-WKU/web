const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const curriculumService = require('../services/curriculumService');
const careerService = require('../services/careerService');
const { resolveYearContext } = require('../services/yearContext');

/**
 * server/test/curriculumService.currentCourseList.test.js
 * "지금 적용되는 과목 편성"(curriculumService.resolveCourseListYear) 회귀 테스트.
 * 원광대는 개편된 교육과정을 그 전 학번에도 적용한다(2026 책자 경과조치 가, 교육혁신과 면담 2026-10-12).
 *  - 2026 책자에 있는 학과: 2025학번 이하도 2026 편성
 *  - 통폐합·개편으로 2026 편성이 없는 학과: 그 학과의 마지막 편성(구 교육과정 운영 단서)
 *  - 특정 학년도·비교·이력 질문: 그 해 편성 그대로
 * 학번별 편성이 모두 시딩돼 있어야 한다(scripts/ci/prepare-test-db.sh의 seed:curriculum-YYYY).
 */

const BOOKS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const deptIds = {};
let studentId;

async function deptId(name) {
  const [[row]] = await pool.query('SELECT id FROM departments WHERE name = ?', [name]);
  assert.ok(row, `테스트 전제 조건 미충족: 학과 '${name}'가 시딩돼 있지 않음`);
  return row.id;
}

before(async () => {
  for (const name of ['간호학과', '전기공학과', '컴퓨터·소프트웨어공학과', '도시공학부']) deptIds[name] = await deptId(name);
});

after(async () => {
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

test('2026 책자에 있는 학과는 2025학번 이하도 2026 편성을 쓰고, 2026학번 이후는 그대로다', async () => {
  const resolve = (admissionYear) => curriculumService.resolveCourseListYear({ departmentId: deptIds.간호학과, admissionYear });
  assert.equal(await resolve(2019), 2026);
  assert.equal(await resolve(2025), 2026);
  assert.equal(await resolve(2026), 2026);
  assert.equal(await resolve(2027), 2027, '최신 책자 뒤 학번은 건드리지 않는다');
});

test('통폐합·개편으로 2026 편성이 없는 학과는 그 학과의 마지막 편성을 쓴다', async () => {
  assert.equal(await curriculumService.resolveCourseListYear({ departmentId: deptIds.전기공학과, admissionYear: 2019 }), 2025);
  // 컴소공 편성: ~2019 / 2020 / 2021~2025 — 2017학번도 마지막(2021~2025) 편성
  assert.equal(await curriculumService.resolveCourseListYear({ departmentId: deptIds['컴퓨터·소프트웨어공학과'], admissionYear: 2017 }), 2025);
  assert.equal(await curriculumService.resolveCourseListYear({ departmentId: deptIds['컴퓨터·소프트웨어공학과'], admissionYear: 2025 }), 2025);
});

test('세부전공이 있으면 세부전공 단위로 마지막 편성을 본다', async () => {
  const [[track]] = await pool.query(
    "SELECT t.id FROM tracks t JOIN curriculum_courses cc ON cc.track_id = t.id WHERE cc.department_id = ? AND t.name = '도시계획설계전공' LIMIT 1",
    [deptIds.도시공학부]
  );
  assert.ok(track, '도시공학부 도시계획설계전공 편성이 필요합니다');
  assert.equal(await curriculumService.resolveCourseListYear({ departmentId: deptIds.도시공학부, trackId: track.id, admissionYear: 2018 }), 2023);
});

test('학과·학번을 모르면 입력 그대로 돌려준다', async () => {
  assert.equal(await curriculumService.resolveCourseListYear({ departmentId: null, admissionYear: 2019 }), 2019);
  assert.equal(await curriculumService.resolveCourseListYear({ departmentId: deptIds.간호학과, admissionYear: null }), null);
});

test('챗봇: "내 학번 기준" 과목 질문은 2026 편성을 근거로 주고, 적용 관계를 제목에 적는다', async () => {
  const student = { department_id: deptIds.간호학과, track_id: null, admission_year: 2019 };
  const message = '3학년 1학기 과목 뭐 있어?';
  const yearContext = resolveYearContext({ message, profileCohort: 2019, availableBookYears: BOOKS });
  assert.equal(yearContext.mode, 'COHORT');
  const chunks = await curriculumService.lookupFromMessage(message, student, yearContext);
  assert.ok(chunks.length > 0);
  for (const c of chunks) {
    assert.match(c.documentTitle, /\[2026~2026학번\]/, c.documentTitle);
    assert.match(c.documentTitle, /2019학번에게도 지금 적용되는 이 학과의 가장 최근 편성/, c.documentTitle);
  }
});

test('챗봇: 특정 학년도 질문은 그 해 편성을 그대로 준다(적용 안내 없음)', async () => {
  const student = { department_id: deptIds.간호학과, track_id: null, admission_year: 2019 };
  const message = '2019학년도 3학년 1학기 과목 뭐 있었어?';
  const yearContext = resolveYearContext({ message, profileCohort: 2019, availableBookYears: BOOKS });
  assert.equal(yearContext.mode, 'SPECIFIC_YEAR');
  const chunks = await curriculumService.lookupFromMessage(message, student, yearContext);
  assert.ok(chunks.length > 0);
  for (const c of chunks) {
    assert.match(c.documentTitle, /\[2019~2019학번\]/, c.documentTitle);
    assert.doesNotMatch(c.documentTitle, /지금 적용되는/, c.documentTitle);
  }
});

test('진로 로드맵: 2019학번의 "아직 안 들은 과목"은 2026 편성에서 고르고, 표기만 다른 이수 과목은 빠진다', async () => {
  const [result] = await pool.query(
    `INSERT INTO students (email, name, department_id, admission_year, enrollment_type, onboarding_completed_at)
     VALUES (?, ?, ?, 2019, 'GENERAL', NOW())`,
    [`courselist-test-${Date.now()}@example.test`, `courselist${Date.now()}`, deptIds.간호학과]
  );
  studentId = result.insertId;
  const latest = await curriculumService.findCourses({ departmentId: deptIds.간호학과, admissionYear: 2026 });
  const latestNames = new Set(latest.map((c) => c.courseName));
  // 2026 편성의 한 과목을 띄어쓰기를 넣어 등록 — 정규화 비교로 이수한 것으로 봐야 한다
  const taken = latest.find((c) => c.courseName.length >= 4);
  const spaced = `${taken.courseName.slice(0, 2)} ${taken.courseName.slice(2)}`;
  await pool.query(
    "INSERT INTO student_courses (student_id, name, credits, category, year, semester) VALUES (?, ?, 3, '전공선택', 2020, 1)",
    [studentId, spaced]
  );

  const remaining = await careerService.getRemainingCourses(studentId, { department_id: deptIds.간호학과, track_id: null, admission_year: 2019 });
  assert.ok(remaining.length > 0);
  const outside = remaining.filter((c) => !latestNames.has(c.courseName)).map((c) => c.courseName);
  assert.deepEqual(outside, [], '2026 편성 밖(폐설 등) 과목이 추천 후보에 있으면 안 된다');
  assert.ok(!remaining.some((c) => c.courseName === taken.courseName), `이수한 "${spaced}"(= ${taken.courseName})가 다시 후보에 있음`);
});
