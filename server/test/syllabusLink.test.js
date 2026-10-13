const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { syllabusSearchUrl, latestYearForSemester } = require('../services/syllabusLink');
const careerService = require('../services/careerService');

/**
 * server/test/syllabusLink.test.js
 * 진로 로드맵의 수업계획서 링크 — 학교 "수업계획서 조회" 검색 주소(학수번호 검색)를 만드는 규칙과, 저장된 로드맵을 읽을 때 붙는지.
 */

after(async () => {
  await pool.end();
});

test('링크 연도: 오늘 기준으로 그 정규 학기의 계획서가 있을 가장 최근 학년도', () => {
  assert.equal(latestYearForSemester(2, '2026-10-13'), 2026, '2학기 중 → 2학기 과목은 올해');
  assert.equal(latestYearForSemester(1, '2026-10-13'), 2026, '2학기 중 → 1학기 과목도 올해(지난 1학기)');
  assert.equal(latestYearForSemester(2, '2027-03-02'), 2026, '1학기 중 → 2학기 과목은 작년');
  assert.equal(latestYearForSemester(1, '2027-03-02'), 2027);
  assert.equal(latestYearForSemester(2, '2027-01-15'), 2026, '겨울방학은 지난 2학기로 본다');
});

test('검색 주소: 학년도·학기(1·2)·학수번호 검색(gubun=3)을 넣고, 학수번호가 없거나 학기가 1·2가 아니면 만들지 않는다', () => {
  const url = new URL(syllabusSearchUrl('169020', 2, '2026-10-13'));
  assert.equal(url.origin + url.pathname, 'https://intra.wku.ac.kr/SWupis/V005/Service/Emplo/LecPlan/searchLecPlanInfo.jsp');
  assert.deepEqual(Object.fromEntries(url.searchParams), { year: '2026', term: '2', gubun: '3', gubunvalue: '169020' });
  assert.equal(syllabusSearchUrl(null, 2), null);
  assert.equal(syllabusSearchUrl('', 1), null);
  assert.equal(syllabusSearchUrl('169020', 3), null, 'DB 학기 코드(3=2학기)가 아니라 정규 학기 번호를 받는다');
});

test('DB: 저장된 로드맵을 읽으면 학생 학과 편성에서 과목명으로 학수번호를 찾아 수업계획서 링크를 붙인다(없으면 null)', async () => {
  const [[course]] = await pool.query(
    `SELECT cc.department_id, cc.course_name, cc.course_code FROM curriculum_courses cc
     JOIN departments d ON d.id = cc.department_id
     WHERE d.name = '간호학과' AND cc.course_code IS NOT NULL AND cc.course_code <> ''
     ORDER BY COALESCE(cc.max_admission_year, 9999) DESC, COALESCE(cc.min_admission_year, 0) DESC LIMIT 1`
  );
  assert.ok(course, '간호학과 편성(학수번호 있음)이 필요합니다');
  const tag = Date.now();
  const [s] = await pool.query(
    "INSERT INTO students (email, name, department_id, admission_year, enrollment_type, onboarding_completed_at) VALUES (?, ?, ?, 2024, 'GENERAL', NOW())",
    [`syllabus-${tag}@example.test`, `syllabus${tag}`, course.department_id]
  );
  try {
    const [sess] = await pool.query("INSERT INTO career_sessions (student_id, status, confirmed_career) VALUES (?, 'CONFIRMED', '간호사')", [s.insertId]);
    await pool.query(
      'INSERT INTO career_roadmap_items (session_id, grade, semester, course_name, reason, sort_order) VALUES (?, 3, 2, ?, ?, 0), (?, 4, 1, ?, ?, 1)',
      [sess.insertId, course.course_name, '이유', sess.insertId, '편성에없는과목이름', '이유']
    );
    const { roadmap } = await careerService.getLatestConfirmedRoadmap(s.insertId);
    const linked = roadmap.find((r) => r.courseName === course.course_name);
    assert.equal(new URL(linked.syllabusUrl).searchParams.get('gubunvalue'), course.course_code);
    assert.equal(new URL(linked.syllabusUrl).searchParams.get('term'), '2');
    assert.equal(roadmap.find((r) => r.courseName === '편성에없는과목이름').syllabusUrl, null);
  } finally {
    await pool.query('DELETE FROM students WHERE id = ?', [s.insertId]);
  }
});
