const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const communityService = require('../services/communityService');
const communityRouter = require('../routes/community');

/**
 * server/test/community.myPosts.test.js
 * "내가 쓴 글" 목록이 글마다 받은 신청 수(전체/대기중)를 내려주는지(PR1, 항목 1)와,
 * 경고성 제재 중인 글쓴이의 글 수정(PATCH /:id)이 SANCTIONED로 막히는지(항목 5의 서버 쪽 전제)를 확인한다.
 * 임시 학생·글·신청·제재를 만들고 끝나면 지운다(학생 삭제 시 CASCADE). 로컬 DB 전용.
 */

const run = Date.now();
let authorId;
let applicantId;
let applicant2Id;
let server;
let baseUrl;
let sessionUserId;

async function makeStudent(tag) {
  const [r] = await pool.query('INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())', [`cm-${tag}-${run}@example.test`, `cm${tag}${run}`]);
  return r.insertId;
}

before(async () => {
  authorId = await makeStudent('author');
  applicantId = await makeStudent('app1');
  applicant2Id = await makeStudent('app2');

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
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const id of [authorId, applicantId, applicant2Id]) if (id) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  await pool.end();
});

test('listMyPosts: 글마다 받은 신청 수와 검토 대기 신청 수를 내려준다(신청 없는 글은 0)', async () => {
  const postA = await communityService.createPost(authorId, { title: '글A', body: '본문', category: 'study', capacity: null });
  const postB = await communityService.createPost(authorId, { title: '글B', body: '본문', category: 'project', capacity: null });
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id IN (?, ?)", [postA, postB]);

  const a1 = await communityService.applyToPost(postA, applicantId, '신청1');
  await communityService.applyToPost(postA, applicant2Id, '신청2');
  await communityService.decideApplication(a1.id, authorId, 'rejected', null); // 한 건은 처리 → 대기 1건만 남는다

  const mine = await communityService.listMyPosts(authorId);
  const byTitle = Object.fromEntries(mine.map((p) => [p.title, p]));
  assert.equal(byTitle['글A'].applicationCount, 2);
  assert.equal(byTitle['글A'].pendingApplicationCount, 1);
  assert.equal(byTitle['글B'].applicationCount, 0);
  assert.equal(byTitle['글B'].pendingApplicationCount, 0);
  assert.equal(typeof byTitle['글A'].applicationCount, 'number', 'COUNT는 숫자로 내려간다');
  // 기존 필드는 그대로
  for (const k of ['id', 'title', 'body', 'category', 'capacity', 'status', 'closedAt', 'createdAt']) assert.ok(k in byTitle['글A'], k);
});

test('listMyPosts: 다른 사람의 글에 달린 신청은 세지 않는다', async () => {
  const other = await communityService.listMyPosts(applicantId);
  assert.deepEqual(other, []);
});

test('PATCH /api/community/:id: 경고성 제재 중인 글쓴이의 글 수정은 SANCTIONED(403)로 막히고 제재 사유가 응답에 실린다', async () => {
  const postId = await communityService.createPost(authorId, { title: '수정글', body: '본문', category: 'study', capacity: null });
  await pool.query(
    "INSERT INTO student_sanctions (student_id, reason, scope, starts_at, ends_at, created_by) VALUES (?, '운영 정책 위반', 'post_apply', NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY), ?)",
    [authorId, authorId]
  );
  sessionUserId = authorId;
  const res = await fetch(`${baseUrl}/api/community/${postId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '새제목', body: '새본문', category: 'study' }),
  });
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.code, 'SANCTIONED');
  assert.equal(body.data.scope, 'post_apply');
  assert.equal(body.data.reason, '운영 정책 위반');
  const [[row]] = await pool.query('SELECT title FROM community_posts WHERE id = ?', [postId]);
  assert.equal(row.title, '수정글', '막힌 수정은 DB에 반영되지 않는다');
});
