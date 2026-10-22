const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const communityService = require('../services/communityService');
const adminRouter = require('../routes/admin');

/**
 * server/test/admin.queues.test.js
 * 관리자 처리 화면 개편(2026-10-23): 같은 글에 들어온 신고는 한 번에 처리되고 처리할 일 건수도 한 건으로 센다,
 * 문의에는 학생의 학과·학번이 붙는다, 지난 제재를 따로 볼 수 있다, 승인 대기 글에 모집 학과·마감일이 붙는다.
 * 임시 학생·글·신고·문의·제재를 만들고 끝나면 지운다. 로컬 DB 전용.
 */

const run = Date.now();
let adminId;
let authorId;
let reporterA;
let reporterB;
let server;
let baseUrl;

async function makeStudent(tag, role = 'student', extra = {}) {
  const [r] = await pool.query('INSERT INTO students (email, name, role, department_id, admission_year, onboarding_completed_at) VALUES (?, ?, ?, ?, ?, NOW())', [
    `aq-${tag}-${run}@example.test`,
    `aq${tag}${run}`,
    role,
    extra.departmentId ?? null,
    extra.admissionYear ?? null,
  ]);
  return r.insertId;
}

const admin = async (method, path, body) => {
  const res = await fetch(`${baseUrl}/api/admin${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};

async function approvedPost(tag) {
  const id = await communityService.createPost(authorId, { title: `글${tag}`, body: '본문', category: 'study', capacity: null });
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [id]);
  return id;
}

before(async () => {
  adminId = await makeStudent('admin', 'admin');
  authorId = await makeStudent('author', 'student', { departmentId: 1, admissionYear: 2023 });
  reporterA = await makeStudent('ra');
  reporterB = await makeStudent('rb');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: adminId };
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
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (adminId) await pool.query('DELETE FROM student_sanctions WHERE created_by = ?', [adminId]);
    for (const id of [adminId, authorId, reporterA, reporterB]) if (id) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  } finally {
    await pool.end();
  }
});

const myReports = async (postId) => (await admin('GET', '/community/reports?status=pending')).json.data.filter((r) => r.targetId === postId);

// 처리할 일 건수가 같은 글의 신고를 한 건으로 세는지는 admin.dashboardStats.test.js(COUNT DISTINCT)가 본다 — 여기서 앞뒤 건수를 비교하면
// 다른 테스트 파일이 동시에 만드는 신고와 섞인다.
test('같은 글의 신고 2건: 목록에 targetId가 같이 오고, 처리할 일 건수는 세 가지의 합이다', async () => {
  const postId = await approvedPost('A');
  await communityService.createReport(reporterA, 'post', postId, '광고예요');
  await communityService.createReport(reporterB, 'post', postId, '전화번호가 있어요');
  const reports = await myReports(postId);
  assert.equal(reports.length, 2);
  assert.ok(reports.every((r) => r.targetType === 'post' && r.targetBody === '본문'));
  const pending = (await admin('GET', '/pending')).json.data;
  assert.ok(pending.reports >= 1);
  assert.equal(pending.total, pending.reports + pending.inquiries + pending.posts);
});

test('조치 없이 처리하면 같은 글의 다른 대기 신고도 같은 안내로 처리완료된다', async () => {
  const postId = await approvedPost('B');
  await communityService.createReport(reporterA, 'post', postId, '사유1');
  await communityService.createReport(reporterB, 'post', postId, '사유2');
  const [first] = await myReports(postId);
  const res = await admin('POST', `/community/reports/${first.id}/resolve`, { note: '확인했어요' });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.resolvedCount, 2);
  assert.deepEqual(await myReports(postId), []);
  const [rows] = await pool.query("SELECT status, resolution_note FROM community_reports WHERE target_type = 'post' AND target_id = ?", [postId]);
  assert.deepEqual(rows.map((r) => [r.status, r.resolution_note]), [['resolved', '확인했어요'], ['resolved', '확인했어요']]);
  assert.equal((await admin('POST', '/community/reports/99999999/resolve', {})).status, 404);
});

test('제재하면 글이 지워지고 같은 글의 신고가 모두 처리완료되며, 지금 제재 목록에 신고 id가 붙는다', async () => {
  const postId = await approvedPost('C');
  await communityService.createReport(reporterA, 'post', postId, '사유1');
  await communityService.createReport(reporterB, 'post', postId, '사유2');
  const [first] = await myReports(postId);
  const res = await admin('POST', `/community/reports/${first.id}/sanction`, { scope: 'post_apply', duration: '7d', reason: '운영 정책 위반' });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.resolvedCount, 2);
  assert.deepEqual(await myReports(postId), []);
  const active = (await admin('GET', '/sanctions')).json.data.find((s) => s.reportId === first.id);
  assert.ok(active);
  assert.equal(active.liftedAt, null);
});

test('지난 제재: 해제하면 지금 목록에서 빠지고 지난 목록에 해제 시각과 함께 보인다', async () => {
  const active = (await admin('GET', '/sanctions?status=active')).json.data.find((s) => s.student === `aqauthor${run}`);
  assert.ok(active);
  assert.equal((await admin('POST', `/sanctions/${active.id}/lift`)).status, 200);
  assert.ok(!(await admin('GET', '/sanctions')).json.data.some((s) => s.id === active.id));
  const past = (await admin('GET', '/sanctions?status=past')).json.data.find((s) => s.id === active.id);
  assert.ok(past.liftedAt);
  assert.equal((await admin('GET', '/sanctions?status=old')).status, 400);
});

test('문의 목록에 학생의 학과·학번이 붙고, 이메일은 없다', async () => {
  const [r] = await pool.query("INSERT INTO inquiries (student_id, title, content) VALUES (?, '졸업요건 문의', '교양 학점이 이상해요')", [authorId]);
  const inquiry = (await admin('GET', '/inquiries?status=open')).json.data.find((i) => i.id === r.insertId);
  assert.equal(inquiry.admissionYear, 2023);
  assert.equal(typeof inquiry.department, 'string');
  assert.ok(!JSON.stringify(inquiry).includes('@example.test'));
});

test('승인 대기 글에 모집 학과와 마감일(YYYY-MM-DD)이 붙는다', async () => {
  const id = await communityService.createPost(authorId, { title: '대기 글', body: '본문', category: 'study', capacity: 3, recruitEndDate: '2099-12-31', departmentIds: [1] });
  const post = (await admin('GET', '/community/posts?status=pending')).json.data.find((p) => p.id === id);
  assert.equal(post.recruitEndDate, '2099-12-31');
  assert.deepEqual(post.targetDepartments.map((d) => d.id), [1]);
});
