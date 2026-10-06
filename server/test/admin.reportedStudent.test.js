const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const communityService = require('../services/communityService');
const adminRouter = require('../routes/admin');

/**
 * server/test/admin.reportedStudent.test.js
 * 관리자 신고함의 "신고 대상자 요약"(PR2, 항목 6): 권한 검사, 표시 정보, 민감 정보 비노출, 탈퇴한 대상자.
 * 임시 학생·글·신청·신고·제재를 만들고 끝나면 지운다. 로컬 DB 전용.
 */

const run = Date.now();
let adminId;
let normalId;
let reportedId;
let reporterId;
let server;
let baseUrl;
let sessionUserId = null;
const emails = {};

async function makeStudent(tag, { role = 'student', admissionYear = null, departmentId = null } = {}) {
  const email = `rs-${tag}-${run}@example.test`;
  const [r] = await pool.query(
    'INSERT INTO students (email, name, role, admission_year, department_id, onboarding_completed_at) VALUES (?, ?, ?, ?, ?, NOW())',
    [email, `rs${tag}${run}`, role, admissionYear, departmentId]
  );
  emails[tag] = email;
  return r.insertId;
}

const get = async (path) => {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
};

before(async () => {
  const [[dept]] = await pool.query('SELECT id, name FROM departments ORDER BY id LIMIT 1');
  adminId = await makeStudent('admin', { role: 'admin' });
  normalId = await makeStudent('normal');
  reportedId = await makeStudent('reported', { admissionYear: 2022, departmentId: dept.id });
  reporterId = await makeStudent('reporter');

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (sessionUserId) req.session = { userId: sessionUserId };
    else req.session = {};
    next();
  });
  app.use('/api/admin', adminRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  try {
    // 제재(student_sanctions.created_by)가 관리자를 참조하므로 관리자는 마지막에 지운다.
    for (const id of [normalId, reportedId, reporterId, adminId]) if (id) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  } finally {
    await pool.end();
  }
});

async function seedActivity() {
  const postId = await communityService.createPost(reportedId, { title: '신고글', body: '본문', category: 'study', capacity: null });
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [postId]);
  await communityService.createPost(reportedId, { title: '다른글', body: '본문', category: 'project', capacity: null });
  await communityService.applyToPost(postId, reporterId, '내가 낸 신청'); // reporter가 신청 → reported의 신청 수와 무관
  const [post2] = await pool.query("SELECT id FROM community_posts WHERE author_id = ? AND title = '다른글'", [reportedId]);
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [post2[0].id]);
  // reported가 reporter의 글에 신청 1건
  const reporterPost = await communityService.createPost(reporterId, { title: '신고자글', body: '본문', category: 'study', capacity: null });
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [reporterPost]);
  await communityService.applyToPost(reporterPost, reportedId, '신청');
  // 신고 2건(대기 1, 처리완료 1)
  const r1 = await communityService.createReport(reporterId, 'post', postId, '신고사유1');
  const r2 = await communityService.createReport(reporterId, 'post', post2[0].id, '신고사유2');
  await communityService.resolveReport(r2.id);
  // 제재 이력: 해제된 것 1건 + 유효한 것 1건 + 기간 지난 것 1건
  await pool.query(
    "INSERT INTO student_sanctions (student_id, reason, scope, starts_at, ends_at, lifted_at, created_by) VALUES (?, '해제된 제재', 'post_apply', NOW(), DATE_ADD(NOW(), INTERVAL 5 DAY), NOW(), ?)",
    [reportedId, adminId]
  );
  await pool.query(
    "INSERT INTO student_sanctions (student_id, reason, scope, starts_at, ends_at, created_by) VALUES (?, '기간 지난 제재', 'post_apply', DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY), ?)",
    [reportedId, adminId]
  );
  await pool.query(
    "INSERT INTO student_sanctions (student_id, reason, scope, starts_at, ends_at, created_by, report_id) VALUES (?, '유효한 제재', 'full', NOW(), NULL, ?, ?)",
    [reportedId, adminId, r1.id]
  );
  return { postId };
}

test('권한: 로그인 안 함 401, 일반 학생 403 — 요약 정보가 노출되지 않는다', async () => {
  sessionUserId = null;
  assert.equal((await get(`/api/admin/community/students/${reportedId}/summary`)).status, 401);
  sessionUserId = normalId;
  const res = await get(`/api/admin/community/students/${reportedId}/summary`);
  assert.equal(res.status, 403);
  assert.equal(res.body.data, null);
});

test('관리자: 닉네임·학과·입학년도·가입일·글/신청 수·신고 접수 횟수(상태별)·제재 이력을 돌려준다', async () => {
  await seedActivity();
  sessionUserId = adminId;
  const { status, body } = await get(`/api/admin/community/students/${reportedId}/summary`);
  assert.equal(status, 200);
  const d = body.data;
  assert.equal(d.nickname, `rsreported${run}`);
  assert.equal(d.admissionYear, 2022);
  assert.ok(d.department, '학과명');
  assert.ok(d.joinedAt);
  assert.equal(d.postCount, 2);
  assert.equal(d.applicationCount, 1);
  assert.deepEqual(d.reportsReceived, { pending: 1, resolved: 1, total: 2 });
  assert.deepEqual(d.sanctions.map((s) => [s.reason, s.state, s.scope]), [
    ['유효한 제재', 'active', 'full'],
    ['기간 지난 제재', 'expired', 'post_apply'],
    ['해제된 제재', 'lifted', 'post_apply'],
  ], '최신 제재가 먼저(생성 시각 같으면 id 역순)');
});

test('민감 정보 비노출: 실제 이메일·비밀번호·OAuth 식별자·역할·학번 전체가 응답 어디에도 없다', async () => {
  sessionUserId = adminId;
  const res = await fetch(`${baseUrl}/api/admin/community/students/${reportedId}/summary`);
  const raw = await res.text();
  assert.ok(!raw.includes(emails.reported), '실제 이메일이 응답에 있다');
  assert.ok(!raw.includes('@example.test'));
  for (const key of ['email', 'password', 'oauth', 'role', 'student_number', 'studentNumber']) {
    assert.ok(!new RegExp(`"${key}`, 'i').test(raw), `응답에 ${key} 필드가 있다`);
  }
  assert.deepEqual(Object.keys(JSON.parse(raw).data).sort(), ['admissionYear', 'applicationCount', 'department', 'id', 'joinedAt', 'nickname', 'postCount', 'reportsReceived', 'sanctions']);
});

test('없는 학생·잘못된 id는 404(탈퇴한 대상자도 서버가 죽지 않는다)', async () => {
  sessionUserId = adminId;
  assert.equal((await get('/api/admin/community/students/999999999/summary')).status, 404);
  assert.equal((await get('/api/admin/community/students/abc/summary')).status, 404);
  assert.equal((await get('/api/admin/community/students/-1/summary')).status, 404);
  assert.equal((await get('/api/admin/community/students/1.5/summary')).status, 404);
});

test('신고 목록: reportedStudentId를 내려주고, 대상자가 탈퇴해 NULL이 되면 null(목록이 깨지지 않음)', async () => {
  const list = await communityService.listReportsForAdmin('pending');
  const mine = list.filter((r) => r.reason === '신고사유1');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].reportedStudentId, reportedId);
  assert.equal(mine[0].reportedStudent, `rsreported${run}`);

  // 대상자 탈퇴: FK ON DELETE SET NULL → reported_student_id NULL. 글도 CASCADE로 사라질 수 있으나 스냅샷으로 신고는 남는다.
  await pool.query('DELETE FROM students WHERE id = ?', [reportedId]);
  const after = await communityService.listReportsForAdmin('pending');
  const gone = after.filter((r) => r.reason === '신고사유1');
  assert.equal(gone.length, 1);
  assert.equal(gone[0].reportedStudentId, null);
  assert.equal(gone[0].reportedStudent, null);
  assert.equal(gone[0].targetTitle, '신고글', '접수 시점 스냅샷은 남는다');
  sessionUserId = adminId;
  assert.equal((await get(`/api/admin/community/students/${reportedId}/summary`)).status, 404);
});
