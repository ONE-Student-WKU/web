const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const communityService = require('../services/communityService');
const adminRouter = require('../routes/admin');
const communityRouter = require('../routes/community');

/**
 * server/test/admin.sanctionReason.test.js
 * 제재 사유가 사용자에게 보이는 모든 경로(GET /my-sanction, SANCTIONED 응답)에 신고자의 신고 사유가 새지 않는지(PR2, 항목 7).
 * 신고 사유(community_reports.reason)는 관리자 API(신고함)에서만 나가고, 사용자에게는 관리자가 입력한 제재 사유(student_sanctions.reason)만 나간다.
 * 임시 학생·글·신고·제재를 만들고 끝나면 지운다. 로컬 DB 전용.
 */

const run = Date.now();
const REPORT_REASON = `신고자가 쓴 비난과 개인정보 010-9999-0000 ${run}`;
const SANCTION_REASON = '커뮤니티 운영 정책 위반';
let adminId;
let authorId;
let reporterId;
let postId;
let server;
let baseUrl;
let sessionUserId;

async function makeStudent(tag, role = 'student') {
  const [r] = await pool.query('INSERT INTO students (email, name, role, onboarding_completed_at) VALUES (?, ?, ?, NOW())', [`sr-${tag}-${run}@example.test`, `sr${tag}${run}`, role]);
  return r.insertId;
}

before(async () => {
  adminId = await makeStudent('admin', 'admin');
  authorId = await makeStudent('author');
  reporterId = await makeStudent('reporter');
  postId = await communityService.createPost(authorId, { title: '문제글', body: '본문', category: 'study', capacity: null });
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [postId]);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: sessionUserId };
    next();
  });
  app.use('/api/admin', adminRouter);
  app.use('/api/community', communityRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  try {
    // 제재(student_sanctions.created_by)가 관리자를 참조하므로 제재받은 학생(CASCADE로 제재 삭제)을 먼저 지운다.
    for (const id of [authorId, reporterId, adminId]) if (id) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  } finally {
    await pool.end();
  }
});

const call = async (path, options = {}) => {
  const res = await fetch(`${baseUrl}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  return { status: res.status, raw: await res.text() };
};

test('관리자 신고함에는 신고 사유가 보이지만(참고용), 제재 확정 후 사용자에게 가는 응답에는 신고 사유가 한 글자도 없다', async () => {
  sessionUserId = reporterId;
  const reported = await call(`/api/community/${postId}/report`, { method: 'POST', body: JSON.stringify({ reason: REPORT_REASON }) });
  assert.equal(reported.status, 201);

  sessionUserId = adminId;
  const list = await call('/api/admin/community/reports?status=pending');
  assert.ok(list.raw.includes(REPORT_REASON), '관리자 신고함에는 신고 사유가 보인다');
  const reportId = JSON.parse(list.raw).data.find((r) => r.reason === REPORT_REASON).id;

  // 관리자가 (화면 기본값인) 중립 문구로 제재를 확정한다 — 전면 정지가 아닌 경고성
  const sanctioned = await call(`/api/admin/community/reports/${reportId}/sanction`, {
    method: 'POST',
    body: JSON.stringify({ scope: 'post_apply', duration: '7d', reason: SANCTION_REASON }),
  });
  assert.equal(sanctioned.status, 200);

  // 제재받는 사용자가 볼 수 있는 모든 응답: my-sanction, 글쓰기 시도(SANCTIONED)
  sessionUserId = authorId;
  const mine = await call('/api/community/my-sanction');
  assert.equal(JSON.parse(mine.raw).data.reason, SANCTION_REASON);
  const write = await call('/api/community', { method: 'POST', body: JSON.stringify({ title: '새글', body: '본문', category: 'study' }) });
  assert.equal(write.status, 403);
  assert.equal(JSON.parse(write.raw).code, 'SANCTIONED');
  assert.equal(JSON.parse(write.raw).data.reason, SANCTION_REASON);
  for (const res of [mine, write]) {
    assert.ok(!res.raw.includes(REPORT_REASON), '신고 사유가 사용자 응답에 새었다');
    assert.ok(!res.raw.includes('010-9999-0000'));
  }

  // 신고자(제3자)에게도 신고 사유·제재 사유가 새지 않는다
  sessionUserId = reporterId;
  const reporterView = await call('/api/community/my-sanction');
  assert.equal(JSON.parse(reporterView.raw).data, null);
});

test('일반 사용자는 신고 사유가 담긴 관리자 신고함 API를 못 읽는다(403)', async () => {
  sessionUserId = authorId;
  const res = await call('/api/admin/community/reports?status=resolved');
  assert.equal(res.status, 403);
  assert.ok(!res.raw.includes(REPORT_REASON));
});
