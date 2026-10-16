const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { getGraduationStatus } = require('../services/graduationService');
const { applyTrackCertificationRule, trackCertificationNotes } = require('../services/trackCertificationRules');

/**
 * server/test/trackCertificationRules.test.js
 * 공학3계열 컴퓨터·소프트웨어공학전공(2026학번~)은 책자 "나" 그룹(1과목)과 달리 학과 규칙으로 기업연계프로젝트1·2 둘 다(과사무실 2026-10-16, D-78).
 * 진단과 챗봇 근거가 같은 규칙을 쓴다.
 */

const GENERIC = { category: '졸업인증제', description: '나 그룹 1과목', min_course_count: 1, requiredCourses: ['캡스톤디자인', '기업연계프로젝트', '종합설계'] };
const THESIS = { category: '졸업논문', description: '졸업논문', min_course_count: 1, requiredCourses: ['졸업(시험·작품)논문'] };

test('규칙: 공학3계열 컴소공전공 2026학번~만 졸업인증제 행을 기업연계프로젝트1·2 둘 다로 바꾸고, 다른 행·세부전공·학번은 그대로', () => {
  const cse = applyTrackCertificationRule([GENERIC, THESIS], { departmentName: '공학3계열', admissionYear: 2026, trackName: '컴퓨터·소프트웨어공학전공' });
  assert.equal(cse[0].min_course_count, 2);
  assert.deepEqual(cse[0].requiredCourses, ['기업연계프로젝트1(종합설계1)', '기업연계프로젝트2(종합설계2)']);
  assert.equal(cse[1], THESIS);
  for (const other of [
    { departmentName: '공학3계열', admissionYear: 2026, trackName: '게임콘텐츠학전공' },
    { departmentName: '공학1계열', admissionYear: 2026, trackName: '컴퓨터·소프트웨어공학전공' },
  ]) {
    assert.deepEqual(applyTrackCertificationRule([GENERIC], other), [GENERIC]);
  }
});

test('규칙: 세부전공을 모르면 공통 기준(1과목)으로 판정하되 설명에 컴소공전공 예외를 함께 적는다', () => {
  const [row] = applyTrackCertificationRule([GENERIC], { departmentName: '공학3계열', admissionYear: 2026, trackName: null });
  assert.equal(row.min_course_count, 1);
  assert.deepEqual(row.requiredCourses, GENERIC.requiredCourses);
  assert.ok(row.description.startsWith('나 그룹 1과목 — 단, 컴퓨터·소프트웨어공학전공이면 기업연계프로젝트1(종합설계1)·기업연계프로젝트2(종합설계2) 모두 필수'));
});

test('챗봇 근거: 공학3계열 2026학번 졸업요건에 세부전공 예외 줄을 붙인다', () => {
  const [line] = trackCertificationNotes('공학3계열', 2026);
  assert.match(line, /컴퓨터·소프트웨어공학전공/);
  assert.match(line, /둘 다/);
  assert.deepEqual(trackCertificationNotes('공학2계열', 2026), []);
  assert.deepEqual(trackCertificationNotes('공학3계열', 2025), []);
});

let studentId;
let trackIds;

before(async () => {
  const [[dept]] = await pool.query("SELECT id FROM departments WHERE name = '공학3계열'");
  const [tracks] = await pool.query('SELECT id, name FROM tracks WHERE department_id = ?', [dept.id]);
  trackIds = Object.fromEntries(tracks.map((t) => [t.name, t.id]));
  const [r] = await pool.query(
    "INSERT INTO students (email, name, department_id, track_id, admission_year, enrollment_type, major_track_type, onboarding_completed_at) VALUES (?, ?, ?, ?, 2026, 'GENERAL', 'UNDECIDED', NOW())",
    [`trackcert-${Date.now()}@example.test`, `trackcert${Date.now()}`, dept.id, trackIds['컴퓨터·소프트웨어공학전공']]
  );
  studentId = r.insertId;
});

after(async () => {
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

const cert = (s) => s.certifications.find((c) => c.category === '졸업인증제');

test('진단: 컴소공전공은 기업연계프로젝트1만 들으면 미충족, 1·2 다 들으면 충족 — 게임콘텐츠학전공은 1과목이면 충족', async () => {
  await pool.query("INSERT INTO student_courses (student_id, name, credits, category, year, semester, letter_grade) VALUES (?, '기업연계프로젝트1(종합설계1)', 3, '전공선택', 2026, 1, 'A+')", [studentId]);
  let s = await getGraduationStatus(studentId);
  assert.equal(cert(s).satisfied, false);
  assert.match(cert(s).description, /둘 다/);

  await pool.query('UPDATE students SET track_id = ? WHERE id = ?', [trackIds['게임콘텐츠학전공'], studentId]);
  s = await getGraduationStatus(studentId);
  assert.equal(cert(s).satisfied, true);

  await pool.query('UPDATE students SET track_id = ? WHERE id = ?', [trackIds['컴퓨터·소프트웨어공학전공'], studentId]);
  await pool.query("INSERT INTO student_courses (student_id, name, credits, category, year, semester, letter_grade) VALUES (?, '기업연계프로젝트2(종합설계2)', 3, '전공선택', 2026, 3, 'A+')", [studentId]);
  s = await getGraduationStatus(studentId);
  assert.equal(cert(s).satisfied, true);
});

test('진단: 학과 규칙 과목은 교직이수자여도 교육봉사활동·교육실습으로 바뀌지 않는다(D-77)', async () => {
  await pool.query('UPDATE students SET teaching_course = 1 WHERE id = ?', [studentId]);
  const s = await getGraduationStatus(studentId);
  assert.deepEqual(cert(s).requiredCourses, ['기업연계프로젝트1(종합설계1)', '기업연계프로젝트2(종합설계2)']);
});
