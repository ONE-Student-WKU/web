const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const studentService = require('../services/studentService');
const sanctionService = require('../services/sanctionService');
const communityService = require('../services/communityService');
const adminRouter = require('../routes/admin');
const communityRouter = require('../routes/community');

/**
 * server/test/community.authorSanction.test.js
 * 커뮤니티 글에서 작성자를 눌러 바로 제재(신고 없이)하는 기능의 서버 규칙:
 *  - POST /api/admin/community/students/:id/sanction — 입력 검증, 관리자 계정은 대상이 될 수 없음, 신고·글 삭제 부수 효과 없음
 *  - GET /api/community/:id — 작성자 id는 관리자에게만 내려간다
 * 학생 조회·제재 생성·글 조회는 mock이라 DB가 필요 없다.
 */

const USERS = { 1: { id: 1, role: 'admin' }, 2: { id: 2, role: 'student' }, 3: { id: 3, role: 'admin' }, 4: { id: 4, role: 'student' } };
let server;
let baseUrl;
let sessionUserId;
let created;
let postArgs;

before(async () => {
  mock.method(studentService, 'findById', async (id) => USERS[id] || null);
  mock.method(sanctionService, 'getActiveSanction', async () => null);
  mock.method(sanctionService, 'createSanction', async (args) => {
    created.push(args);
    return 99;
  });
  mock.method(communityService, 'getPostById', async (id, opts) => {
    postArgs = { id, ...opts };
    return { id: Number(id), title: '글', author: 'user2' };
  });

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
  mock.restoreAll();
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  sessionUserId = 1;
  created = [];
  postArgs = null;
});

async function sanction(studentId, body) {
  const res = await fetch(`${baseUrl}/api/admin/community/students/${studentId}/sanction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, code: (await res.json()).code };
}

test('관리자가 학생을 직접 제재하면 신고 없이(report_id 없이) 제재가 만들어진다', async () => {
  const r = await sanction(2, { scope: 'post_apply', duration: '7d', reason: '  욕설 ' });
  assert.deepEqual(r, { status: 200, code: 'STUDENT_SANCTIONED' });
  assert.deepEqual(created, [{ studentId: 2, reason: '욕설', scope: 'post_apply', durationDays: 7, createdBy: 1 }]);
});

test('영구정지는 기간이 null이다', async () => {
  await sanction(2, { scope: 'full', duration: 'permanent', reason: '반복 위반' });
  assert.equal(created[0].durationDays, null);
  assert.equal(created[0].scope, 'full');
});

test('관리자 계정(본인·다른 관리자)은 제재할 수 없다', async () => {
  assert.deepEqual(await sanction(1, { scope: 'full', duration: '1d', reason: '실수' }), { status: 400, code: 'CANNOT_SANCTION_ADMIN' });
  assert.deepEqual(await sanction(3, { scope: 'full', duration: '1d', reason: '실수' }), { status: 400, code: 'CANNOT_SANCTION_ADMIN' });
  assert.equal(created.length, 0);
});

test('없는 학생이면 404이고, 잘못된 id도 404이다', async () => {
  assert.deepEqual(await sanction(404, { scope: 'full', duration: '1d', reason: 'x' }), { status: 404, code: 'STUDENT_NOT_FOUND' });
  assert.deepEqual(await sanction('abc', { scope: 'full', duration: '1d', reason: 'x' }), { status: 404, code: 'STUDENT_NOT_FOUND' });
  assert.equal(created.length, 0);
});

test('범위·기간·사유가 잘못되면 400이고 제재를 만들지 않는다', async () => {
  assert.deepEqual(await sanction(2, { scope: 'nope', duration: '1d', reason: 'x' }), { status: 400, code: 'INVALID_SCOPE' });
  assert.deepEqual(await sanction(2, { scope: 'full', duration: '2d', reason: 'x' }), { status: 400, code: 'INVALID_DURATION' });
  assert.deepEqual(await sanction(2, { scope: 'full', duration: '1d', reason: '   ' }), { status: 400, code: 'REQUIRED_REASON' });
  assert.deepEqual(await sanction(2, {}), { status: 400, code: 'INVALID_SCOPE' });
  assert.equal(created.length, 0);
});

test('관리자가 아니면 제재할 수 없다(403)', async () => {
  sessionUserId = 4;
  assert.deepEqual(await sanction(2, { scope: 'full', duration: '1d', reason: 'x' }), { status: 403, code: 'FORBIDDEN' });
  assert.equal(created.length, 0);
});

test('글 상세는 관리자 요청일 때만 작성자 id를 내려주도록 요청한다', async () => {
  sessionUserId = 1;
  await fetch(`${baseUrl}/api/community/5`);
  assert.equal(postArgs.includeAuthorId, true);

  sessionUserId = 4;
  await fetch(`${baseUrl}/api/community/5`);
  assert.equal(postArgs.includeAuthorId, false);
});
