const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const communityService = require('../services/communityService');
const communityRouter = require('../routes/community');

/**
 * server/test/community.report.test.js
 * 신고 생성 규칙(PR3): ① 같은 신고자가 같은 대상을 처리 상태와 무관하게 다시 신고할 수 없고 동시 요청도 한 건만 들어간다(항목 4)
 * ② 자기 글/자기 신청은 서버가 거부한다(항목 8). 임시 학생·글·신청·신고를 만들고 끝나면 지운다. 로컬 DB 전용.
 */

const run = Date.now();
let authorId;
let reporterId;
let otherReporterId;
let postId;
let post2Id;
let applicationId;
let server;
let baseUrl;
let sessionUserId;

async function makeStudent(tag) {
  const [r] = await pool.query('INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())', [`rp-${tag}-${run}@example.test`, `rp${tag}${run}`]);
  return r.insertId;
}

const reportsOf = async (reporter, type, target) => {
  const [rows] = await pool.query('SELECT id, status FROM community_reports WHERE reporter_id = ? AND target_type = ? AND target_id = ?', [reporter, type, target]);
  return rows;
};

before(async () => {
  authorId = await makeStudent('author');
  reporterId = await makeStudent('reporter');
  otherReporterId = await makeStudent('other');
  postId = await communityService.createPost(authorId, { title: '글1', body: '본문', category: 'study', capacity: null });
  post2Id = await communityService.createPost(authorId, { title: '글2', body: '본문', category: 'study', capacity: null });
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id IN (?, ?)", [postId, post2Id]);
  const applied = await communityService.applyToPost(postId, reporterId, '신청 메시지');
  applicationId = applied.id;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: sessionUserId };
    next();
  });
  app.use('/api/community', communityRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const id of [authorId, reporterId, otherReporterId]) if (id) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  } finally {
    await pool.end();
  }
});

test('중복 신고: 같은 신고자가 같은 글을 대기 중에 다시 신고하면 DUPLICATE_REPORT, 행은 늘지 않는다', async () => {
  const first = await communityService.createReport(reporterId, 'post', postId, '첫 신고');
  assert.equal(first.ok, true);
  const again = await communityService.createReport(reporterId, 'post', postId, '또 신고');
  assert.deepEqual(again, { ok: false, reason: 'DUPLICATE_REPORT' });
  assert.equal((await reportsOf(reporterId, 'post', postId)).length, 1);
});

test('중복 신고(정책): 처리 완료된 뒤에도 같은 사람이 같은 글을 다시 신고할 수 없다', async () => {
  const [row] = await reportsOf(reporterId, 'post', postId);
  assert.equal(await communityService.resolveReport(row.id), true);
  const after = await communityService.createReport(reporterId, 'post', postId, '처리 후 재신고');
  assert.deepEqual(after, { ok: false, reason: 'DUPLICATE_REPORT' });
  assert.equal((await reportsOf(reporterId, 'post', postId)).length, 1);
});

test('중복이 아닌 경우: 다른 신고자, 같은 신고자의 다른 글, 같은 숫자 id의 다른 대상 종류는 각각 접수된다', async () => {
  assert.equal((await communityService.createReport(otherReporterId, 'post', postId, '다른 사람 신고')).ok, true);
  assert.equal((await communityService.createReport(reporterId, 'post', post2Id, '다른 글 신고')).ok, true);
  // target_type이 다르면 id가 같아도 별개 대상(글 id와 신청 id는 서로 다른 테이블)
  const asApp = await communityService.createReport(authorId, 'application', applicationId, '신청 신고(글쓴이가 신고)');
  assert.equal(asApp.ok, true);
});

test('동시 요청(더블 클릭): 같은 신고자가 같은 글을 동시에 8번 신고해도 정확히 1건만 접수된다', async () => {
  const fresh = await communityService.createPost(authorId, { title: '동시글', body: '본문', category: 'study', capacity: null });
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [fresh]);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => communityService.createReport(otherReporterId, 'post', fresh, `동시 신고 ${i}`)));
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.equal(results.filter((r) => !r.ok && r.reason === 'DUPLICATE_REPORT').length, 7);
  assert.equal((await reportsOf(otherReporterId, 'post', fresh)).length, 1);
});

test('동시 요청(신청 신고)도 마찬가지로 1건만 접수된다', async () => {
  const [[{ id: freshApp }]] = await pool.query(
    "SELECT id FROM community_applications WHERE post_id = ? AND applicant_id = ?",
    [postId, reporterId]
  );
  const author2 = await makeStudent('author2');
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => communityService.createReport(author2, 'application', freshApp, '동시 신청 신고')));
    // author2는 글쓴이가 아니지만 서비스 함수 자체의 중복 방지를 본다(소유권 확인은 라우트가 한다)
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
    assert.equal((await reportsOf(author2, 'application', freshApp)).length, 1);
  } finally {
    await pool.query('DELETE FROM students WHERE id = ?', [author2]);
  }
});

test('자기 글 신고: 서비스는 CANNOT_REPORT_OWN을 돌려주고 신고 행을 만들지 않는다', async () => {
  const r = await communityService.createReport(authorId, 'post', postId, '내 글 신고');
  assert.deepEqual(r, { ok: false, reason: 'CANNOT_REPORT_OWN' });
  assert.equal((await reportsOf(authorId, 'post', postId)).length, 0);
});

test('자기 신청 신고: 신청자가 자기 신청을 신고하는 경우도 거부한다(데이터가 비정상이어도 서버가 막는다)', async () => {
  const [r] = await pool.query("INSERT INTO community_applications (post_id, applicant_id, message, status) VALUES (?, ?, '자기신청', 'pending')", [postId, authorId]);
  const res = await communityService.createReport(authorId, 'application', r.insertId, '내 신청 신고');
  assert.deepEqual(res, { ok: false, reason: 'CANNOT_REPORT_OWN' });
  assert.equal((await reportsOf(authorId, 'application', r.insertId)).length, 0);
});

const post = async (path, userId, body) => {
  sessionUserId = userId;
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('API: 자기 글 신고는 400 CANNOT_REPORT_OWN, 중복은 409 DUPLICATE_REPORT, 없는 글은 404, 정상은 201', async () => {
  assert.deepEqual(
    (({ status, body }) => [status, body.code])(await post(`/api/community/${postId}/report`, authorId, { reason: '내 글' })),
    [400, 'CANNOT_REPORT_OWN']
  );
  assert.deepEqual(
    (({ status, body }) => [status, body.code])(await post(`/api/community/${postId}/report`, reporterId, { reason: '또' })),
    [409, 'DUPLICATE_REPORT']
  );
  assert.deepEqual((({ status, body }) => [status, body.code])(await post('/api/community/999999999/report', reporterId, { reason: '없음' })), [404, 'INVALID_TARGET']);
  const fresh = await communityService.createPost(authorId, { title: 'API글', body: '본문', category: 'study', capacity: null });
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [fresh]);
  assert.deepEqual((({ status, body }) => [status, body.code])(await post(`/api/community/${fresh}/report`, reporterId, { reason: '정상' })), [201, 'COMMUNITY_REPORT_CREATED']);
});

test('API: 글쓴이가 자기 글에 달린 신청을 신고하는 것은 되고(정상), 신청자 본인이나 제3자는 403', async () => {
  assert.equal((await post(`/api/community/applications/${applicationId}/report`, reporterId, { reason: '내 신청' })).status, 403, '신청자 본인은 소유권 검사에서 403');
  assert.equal((await post(`/api/community/applications/${applicationId}/report`, otherReporterId, { reason: '제3자' })).status, 403);
  // 글쓴이가 이미 서비스 레벨 테스트에서 이 신청을 신고했으므로 API는 중복(409) — 소유권 검사는 통과했다는 뜻
  assert.equal((await post(`/api/community/applications/${applicationId}/report`, authorId, { reason: '글쓴이' })).status, 409);
});
