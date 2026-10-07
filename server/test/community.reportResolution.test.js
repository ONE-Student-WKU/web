const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const communityService = require('../services/communityService');
const communityRouter = require('../routes/community');
const adminRouter = require('../routes/admin');

/**
 * server/test/community.reportResolution.test.js
 * 신고 처리 안내: 관리자가 남긴 메시지가 신고자 본인 화면("내 신고 내역")에만 보이고, 읽지 않음 표시가 맞게 동작하는지.
 * 임시 학생·글·신고를 만들고 끝나면 지운다. 로컬 DB 전용.
 */

const run = Date.now();
let adminId;
let authorId;
let reporterId;
let otherId;
let postId;
let server;
let baseUrl;
let sessionUserId;

async function makeStudent(tag, role = 'student') {
  const [r] = await pool.query('INSERT INTO students (email, name, role, onboarding_completed_at) VALUES (?, ?, ?, NOW())', [`rr-${tag}-${run}@example.test`, `rr${tag}${run}`, role]);
  return r.insertId;
}

const call = async (prefix, method, path, body) => {
  const res = await fetch(`${baseUrl}${prefix}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};
const community = (m, p, b) => call('/api/community', m, p, b);
const admin = (m, p, b) => call('/api/admin', m, p, b);

async function newReport(reporter, tag) {
  const post = await communityService.createPost(authorId, { title: `글${tag}`, body: '본문', category: 'study', capacity: null });
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [post]);
  const r = await communityService.createReport(reporter, 'post', post, `사유${tag}`);
  assert.equal(r.ok, true);
  return { reportId: r.id, postId: post };
}

before(async () => {
  adminId = await makeStudent('admin', 'admin');
  authorId = await makeStudent('author');
  reporterId = await makeStudent('reporter');
  otherId = await makeStudent('other');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: sessionUserId };
    next();
  });
  app.use('/api/community', communityRouter);
  app.use('/api/admin', adminRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  postId = null;
});

after(async () => {
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    // 제재 행이 관리자(created_by)를 FK로 잡고 있어 학생보다 먼저 지운다.
    if (adminId) await pool.query('DELETE FROM student_sanctions WHERE created_by = ?', [adminId]);
    for (const id of [adminId, authorId, reporterId, otherId]) if (id) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  } finally {
    await pool.end();
  }
});

test('처리 전: 내 신고 내역에 "검토 중"으로 보이고 처리 안내·읽지 않음은 없다', async () => {
  const { reportId } = await newReport(reporterId, 'A');
  sessionUserId = reporterId;
  const list = (await community('GET', '/reports/mine')).json.data;
  const mine = list.find((r) => r.id === reportId);
  assert.equal(mine.status, 'pending');
  assert.equal(mine.resolutionNote, null);
  assert.equal(mine.isUnseen, false);
  assert.equal((await community('GET', '/reports/unseen-count')).json.data.count, 0);
});

test('관리자가 처리 안내를 적어 반려하면 신고자에게 안내가 보이고 읽지 않음 1건이 된다', async () => {
  const { reportId } = await newReport(reporterId, 'B');
  sessionUserId = adminId;
  assert.equal((await admin('POST', `/community/reports/${reportId}/resolve`, { note: '  확인했고 문제가 없어 종료했어요.  ' })).status, 200);

  sessionUserId = reporterId;
  const mine = (await community('GET', '/reports/mine')).json.data.find((r) => r.id === reportId);
  assert.equal(mine.status, 'resolved');
  assert.equal(mine.resolutionNote, '확인했고 문제가 없어 종료했어요.');
  assert.equal(mine.isUnseen, true);
  assert.equal((await community('GET', '/reports/unseen-count')).json.data.count, 1);
});

test('"내 신고 내역"을 열면(seen) 읽지 않음이 사라지고, 다시 호출해도 그대로다', async () => {
  sessionUserId = reporterId;
  assert.equal((await community('POST', '/reports/seen')).json.data.updated, 1);
  assert.equal((await community('GET', '/reports/unseen-count')).json.data.count, 0);
  assert.equal((await community('POST', '/reports/seen')).json.data.updated, 0);
  const [[row]] = await pool.query("SELECT resolution_seen_at FROM community_reports WHERE reporter_id = ? AND status = 'resolved' LIMIT 1", [reporterId]);
  assert.ok(row.resolution_seen_at);
});

test('처리 안내를 비우면 NULL로 저장된다(화면이 기본 문구를 보여준다), 너무 길면 400', async () => {
  const { reportId } = await newReport(reporterId, 'C');
  sessionUserId = adminId;
  const tooLong = await admin('POST', `/community/reports/${reportId}/resolve`, { note: 'x'.repeat(501) });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.json.code, 'INVALID_RESOLUTION_NOTE');
  assert.equal((await admin('POST', `/community/reports/${reportId}/resolve`, { note: '   ' })).status, 200);
  const [[row]] = await pool.query('SELECT status, resolution_note FROM community_reports WHERE id = ?', [reportId]);
  assert.deepEqual([row.status, row.resolution_note], ['resolved', null]);
});

test('제재와 함께 처리해도 신고자 안내가 따로 저장된다 — 제재 사유와 섞이지 않는다', async () => {
  const { reportId, postId: pid } = await newReport(reporterId, 'D');
  sessionUserId = adminId;
  const res = await admin('POST', `/community/reports/${reportId}/sanction`, {
    scope: 'post_apply', duration: '7d', reason: '커뮤니티 운영 정책 위반', resolutionNote: '신고해 주셔서 감사합니다. 운영 정책에 따라 조치했어요.',
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const [[row]] = await pool.query('SELECT resolution_note FROM community_reports WHERE id = ?', [reportId]);
  assert.equal(row.resolution_note, '신고해 주셔서 감사합니다. 운영 정책에 따라 조치했어요.');
  const [[sanction]] = await pool.query('SELECT reason FROM student_sanctions WHERE report_id = ?', [reportId]);
  assert.equal(sanction.reason, '커뮤니티 운영 정책 위반');
  void pid;
});

test('다른 사람의 신고·처리 안내는 보이지 않는다, 신고 대상자(글쓴이)에게도 나가지 않는다', async () => {
  sessionUserId = otherId;
  const list = (await community('GET', '/reports/mine')).json.data;
  assert.deepEqual(list, []);
  assert.equal((await community('GET', '/reports/unseen-count')).json.data.count, 0);
  assert.equal((await community('POST', '/reports/seen')).json.data.updated, 0);

  sessionUserId = authorId;
  assert.deepEqual((await community('GET', '/reports/mine')).json.data, []);
});

test('신고자에게 내려가는 응답에는 신고 대상자 정보·제재 정보가 없다', async () => {
  sessionUserId = reporterId;
  const text = JSON.stringify((await community('GET', '/reports/mine')).json);
  for (const key of ['reportedStudent', 'reported_student_id', 'sanction', 'email']) assert.equal(text.includes(key), false, key);
});

test('처리 안내는 관리자만 쓸 수 있다(일반 학생이 resolve를 호출하면 거부)', async () => {
  const { reportId } = await newReport(reporterId, 'E');
  sessionUserId = reporterId;
  const res = await admin('POST', `/community/reports/${reportId}/resolve`, { note: '내가 처리' });
  assert.notEqual(res.status, 200);
  const [[row]] = await pool.query('SELECT status FROM community_reports WHERE id = ?', [reportId]);
  assert.equal(row.status, 'pending');
});
