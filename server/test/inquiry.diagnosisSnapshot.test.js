const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const inquiriesRouter = require('../routes/inquiries');
const adminRouter = require('../routes/admin');
const { courseOrigin, snapshotCourse, summarizeStatus } = require('../services/inquiryDiagnosisSnapshot');

/**
 * server/test/inquiry.diagnosisSnapshot.test.js
 * 문의에 "진단 결과 같이 보내기"(2026-11): 학생이 고르면 보낸 순간의 진단 요약과 과목 목록이 문의에 붙고, 관리자 목록에만 보인다.
 * 성적은 담지 않는다. 고르지 않으면 아무것도 붙지 않는다. 임시 학생·문의를 만들고 끝나면 지운다. 로컬 DB 전용.
 */

test('과목을 넣은 방법: 개설과목 검색·성적표(학수번호·개설 학과)·그 밖', () => {
  assert.equal(courseOrigin({ course_id: 3 }), 'CATALOG');
  assert.equal(courseOrigin({ course_id: null, course_code: '362263' }), 'TRANSCRIPT');
  assert.equal(courseOrigin({ course_id: null, course_code: null, offering_department_id: 76 }), 'TRANSCRIPT');
  assert.equal(courseOrigin({ course_id: null, course_code: null, offering_department_id: null }), 'UNKNOWN');
});

test('스냅샷 과목에는 성적 칸이 없다', () => {
  const row = { id: 1, course_id: null, name: '캡스톤디자인', credits: '3.0', category: '전공선택', category_original: '일반선택', year: 2026, semester: 1, letter_grade: 'A+', gpa: 4.5, midterm: 90 };
  const c = snapshotCourse(row, new Set([1]));
  assert.deepEqual(c, { name: '캡스톤디자인', credits: 3, category: '전공선택', originalCategory: '일반선택', year: 2026, semester: 1, origin: 'UNKNOWN', supersededByRetake: true });
  assert.ok(!JSON.stringify(c).match(/A\+|4\.5|90/));
});

test('진단 요약은 참고(INFO) 플래그를 빼고 추정 사유만 담는다', () => {
  const s = summarizeStatus({
    totalEarnedCredits: 123, totalRequiredCredits: 136,
    categories: [{ category: '전공', earnedCredits: 70, requiredCredits: 75, requiredCourses: ['x'] }],
    certifications: [{ category: '졸업인증제', satisfied: true, completedCourses: ['캡스톤디자인'] }],
    editedCategoryCourses: [],
    regulation: { confidence: 'ESTIMATED', flags: [{ code: 'A', level: 'ESTIMATED', message: '추정 사유' }, { code: 'B', level: 'INFO', message: '참고' }] },
  });
  assert.deepEqual(s.reasons, [{ code: 'A', message: '추정 사유' }]);
  assert.deepEqual(s.categories, [{ category: '전공', earnedCredits: 70, requiredCredits: 75 }]);
  assert.deepEqual(s.certifications, [{ category: '졸업인증제', satisfied: true }]);
  assert.equal(summarizeStatus(null), null);
});

// ---- DB(로컬 시드) ----
const run = Date.now();
let adminId;
let askerId;
let server;
let baseUrl;
let sessionUserId;

const call = async (prefix, method, path, body) => {
  const res = await fetch(`${baseUrl}${prefix}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};
const inquiries = (m, p, b) => call('/api/inquiries', m, p, b);
const admin = (m, p, b) => call('/api/admin', m, p, b);
const adminInquiry = async (id) => {
  sessionUserId = adminId;
  return (await admin('GET', '/inquiries?status=open')).json.data.find((i) => i.id === id);
};

before(async () => {
  const [[dept]] = await pool.query("SELECT id FROM departments WHERE name = '컴퓨터·소프트웨어공학과' LIMIT 1");
  const [a] = await pool.query("INSERT INTO students (email, name, role, onboarding_completed_at) VALUES (?, ?, 'admin', NOW())", [`snap-admin-${run}@example.test`, `snapadmin${run}`]);
  adminId = a.insertId;
  const [s] = await pool.query(
    "INSERT INTO students (email, name, department_id, admission_year, enrollment_type, onboarding_completed_at) VALUES (?, ?, ?, 2022, 'GENERAL', NOW())",
    [`snap-asker-${run}@example.test`, `snapasker${run}`, dept.id]
  );
  askerId = s.insertId;
  await pool.query(
    "INSERT INTO student_courses (student_id, name, credits, category, category_original, year, semester, letter_grade, gpa) VALUES (?, '테스트스냅샷과목', 3, '전공선택', '일반선택', 2024, 1, 'A+', 4.5)",
    [askerId]
  );
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: sessionUserId };
    next();
  });
  app.use('/api/inquiries', inquiriesRouter);
  app.use('/api/admin', adminRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const id of [adminId, askerId]) if (id) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  } finally {
    await pool.end();
  }
});

test('같이 보내기를 고르면 진단 요약과 과목 목록(성적 제외)이 붙고, "결과가 이상해요"에서 연 문의임이 남는다', async () => {
  sessionUserId = askerId;
  const res = await inquiries('POST', '/', { title: '결과가 이상해요', content: '내용', attachDiagnosis: true, source: 'GRADUATION_REPORT' });
  assert.equal(res.status, 201);
  const item = await adminInquiry(res.json.data.id);
  assert.equal(item.source, 'GRADUATION_REPORT');
  const snap = item.diagnosisSnapshot;
  assert.equal(snap.version, 1);
  assert.deepEqual(snap.student, { department: '컴퓨터·소프트웨어공학과', track: null, admissionYear: 2022, enrollmentType: 'GENERAL' });
  assert.ok(snap.summary.totalRequiredCredits > 0);
  assert.deepEqual(snap.summary.editedCategoryCourses.map((c) => [c.from, c.to]), [['일반선택', '전공선택']]);
  assert.deepEqual(snap.courses, [{ name: '테스트스냅샷과목', credits: 3, category: '전공선택', originalCategory: '일반선택', year: 2024, semester: 1, origin: 'UNKNOWN', supersededByRetake: false }]);
  assert.ok(!JSON.stringify(snap).match(/A\+|letter|gpa/i), '성적은 담지 않는다');

  // 학생 본인 목록에는 "같이 보냈음"만 보이고 내용은 다시 보여 주지 않는다.
  sessionUserId = askerId;
  const mine = (await inquiries('GET', '/mine')).json.data.find((i) => i.id === res.json.data.id);
  assert.equal(mine.diagnosisAttached, true);
  assert.equal(mine.diagnosisSnapshot, undefined);
});

test('같이 보내기를 고르지 않으면 아무것도 붙지 않는다', async () => {
  sessionUserId = askerId;
  const res = await inquiries('POST', '/', { title: '그냥 문의', content: '내용' });
  const item = await adminInquiry(res.json.data.id);
  assert.equal(item.diagnosisSnapshot, null);
  assert.equal(item.source, null);
  sessionUserId = askerId;
  assert.equal((await inquiries('GET', '/mine')).json.data.find((i) => i.id === res.json.data.id).diagnosisAttached, false);
});

test('같이 보내기·문의 화면 값이 틀리면 400', async () => {
  sessionUserId = askerId;
  const bad = await inquiries('POST', '/', { title: 't', content: 'c', attachDiagnosis: 'yes' });
  assert.deepEqual([bad.status, bad.json.code], [400, 'INVALID_ATTACH_DIAGNOSIS']);
  const badSource = await inquiries('POST', '/', { title: 't', content: 'c', source: 'HOME' });
  assert.deepEqual([badSource.status, badSource.json.code], [400, 'INVALID_SOURCE']);
});

test('학과를 고르기 전이면 진단 요약 없이 과목 목록만 보낸다', async () => {
  await pool.query('UPDATE students SET department_id = NULL WHERE id = ?', [askerId]);
  sessionUserId = askerId;
  const res = await inquiries('POST', '/', { title: '온보딩 전', content: '내용', attachDiagnosis: true });
  assert.equal(res.status, 201);
  const snap = (await adminInquiry(res.json.data.id)).diagnosisSnapshot;
  assert.equal(snap.summary, null);
  assert.equal(snap.courses.length, 1);
});
