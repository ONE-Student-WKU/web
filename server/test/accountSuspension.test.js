// routes/auth.js → services/mailer.js가 require 시점에 Resend 클라이언트를 만들어서 키가 없으면 throw한다(consent.test.js와 같은 이유로 더미 값).
process.env.RESEND_API_KEY ||= 're_test_dummy';
process.env.GOOGLE_CLIENT_ID ||= 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET ||= 'test-client-secret';
process.env.OAUTH_CALLBACK_BASE_URL ||= 'http://localhost:5173';

const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const pool = require('../db');
const studentService = require('../services/studentService');
const sanctionService = require('../services/sanctionService');
const signupBlockService = require('../services/signupBlockService');
const communityService = require('../services/communityService');
const emailAuthService = require('../services/emailAuthService');
const { CURRENT_CONSENT_VERSION } = require('../services/consent');
const { blockSuspendedAccount } = require('../middleware/accountSuspension');
const meRouter = require('../routes/me');
const authRouter = require('../routes/auth');
const communityRouter = require('../routes/community');

/**
 * server/test/accountSuspension.test.js
 * 서비스 전체 이용 정지(#457):
 *  - 정지 계정은 허용 목록(로그인·재인증·로그아웃, GET·DELETE /api/me) 밖의 /api 요청이 403 ACCOUNT_SUSPENDED
 *  - GET /api/me가 정지 사유·기간을 내려준다
 *  - 정지 중 계정 삭제는 재가입 제한 기록(해시)을 남기고, 그 이메일·Google 계정의 새 가입은 막힌다
 *  - 가장 무거운 제재가 먼저 보인다(계정 정지가 가벼운 제재에 가려지지 않는다)
 *  - 커뮤니티: 글쓴이가 정지 중인 글에는 신청할 수 없고, 정지 중인 학생의 대기 신청은 신청자 목록에서 빠진다
 * 학생·제재·글 조회는 mock이라 DB가 필요 없다.
 */

const STUDENT = { id: 7, email: 'Kim@Example.com', oauth_id: 'google-sub-7', role: 'student', name: 'kim' };
const SUSPENSION = { id: 1, scope: 'account', reason: '문의하기에서 욕설 반복', ends_at: new Date('2026-11-03T05:00:00Z') };
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

let server;
let baseUrl;
let session;
let suspension;
let recorded;
let deleted;

before(async () => {
  mock.method(studentService, 'findById', async (id) => (id === STUDENT.id ? { ...STUDENT } : null));
  mock.method(studentService, 'deleteStudent', async (id) => deleted.push(id));
  mock.method(sanctionService, 'getActiveAccountSuspension', async () => suspension);
  mock.method(sanctionService, 'getActiveSanction', async () => null);
  mock.method(signupBlockService, 'recordBlock', async (student, s) => recorded.push({ student, s }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = session;
    next();
  });
  app.use('/api', blockSuspendedAccount);
  app.use('/api/auth', authRouter);
  app.use('/api', meRouter);
  app.use('/api/community', communityRouter);
  // 허용 목록 밖의 아무 기능 — 막히지 않으면 200
  app.get('/api/courses', (req, res) => res.json({ code: 'OK' }));
  app.post('/api/inquiries', (req, res) => res.json({ code: 'OK' }));
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
  session = { userId: STUDENT.id, destroy: (cb) => cb() };
  suspension = SUSPENSION;
  recorded = [];
  deleted = [];
});

async function call(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json() };
}

describe('허용 목록', () => {
  test('정지 계정의 다른 기능 요청은 403 ACCOUNT_SUSPENDED와 사유·기간', async () => {
    const r = await call('GET', '/api/courses');
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'ACCOUNT_SUSPENDED');
    assert.equal(r.body.data.reason, SUSPENSION.reason);
    assert.equal(new Date(r.body.data.endsAt).toISOString(), SUSPENSION.ends_at.toISOString());
  });

  test('문의하기와 프로필 수정도 막힌다', async () => {
    assert.equal((await call('POST', '/api/inquiries', { title: 't', content: 'c' })).status, 403);
    assert.equal((await call('PATCH', '/api/me', { name: 'x' })).body.code, 'ACCOUNT_SUSPENDED');
  });

  test('GET /api/me는 열려 있고 정지 사유·기간을 내려준다', async () => {
    const r = await call('GET', '/api/me');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.suspension.reason, SUSPENSION.reason);
    assert.ok(r.body.data.suspension.endsAt);
  });

  test('로그아웃은 열려 있다', async () => {
    assert.equal((await call('POST', '/api/auth/logout')).body.code, 'LOGOUT_SUCCESS');
  });

  test('정지가 아니면(없거나 끝났거나 해제됨) 그대로 통과하고 /me의 suspension은 null', async () => {
    suspension = null;
    assert.equal((await call('GET', '/api/courses')).status, 200);
    assert.equal((await call('GET', '/api/me')).body.data.suspension, null);
  });

  test('로그인하지 않은 요청은 가드가 건드리지 않는다', async () => {
    session = {};
    assert.equal((await call('GET', '/api/courses')).status, 200);
  });
});

describe('정지 중 계정 삭제', () => {
  test('재인증 후 삭제하면 재가입 제한 기록을 남기고 지운다', async () => {
    session.deleteReauthAt = Date.now();
    const r = await call('DELETE', '/api/me');
    assert.equal(r.body.code, 'ACCOUNT_DELETE_SUCCESS');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].student.email, STUDENT.email);
    assert.equal(recorded[0].s, SUSPENSION);
    assert.deepEqual(deleted, [STUDENT.id]);
  });

  test('정지가 아니면 기록 없이 지운다', async () => {
    suspension = null;
    session.deleteReauthAt = Date.now();
    await call('DELETE', '/api/me');
    assert.equal(recorded.length, 0);
    assert.deepEqual(deleted, [STUDENT.id]);
  });
});

describe('재가입 제한', () => {
  test('막힌 이메일로 새 계정을 만들려 하면 403 SIGNUP_BLOCKED, 계정을 만들지 않는다', async () => {
    session = { userId: undefined, regenerate: (cb) => cb(), save: (cb) => cb(), cookie: {} };
    const created = [];
    mock.method(emailAuthService, 'verifyLoginToken', async () => ({ ok: true }));
    mock.method(studentService, 'findByEmail', async () => null);
    mock.method(studentService, 'createEmailStudent', async (args) => created.push(args));
    const blocked = mock.method(signupBlockService, 'isBlocked', async () => true);
    const r = await call('POST', '/api/auth/email/verify', { email: 'kim@example.com', code: '123456', consent: CURRENT_CONSENT_VERSION });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'SIGNUP_BLOCKED');
    assert.deepEqual(blocked.mock.calls[0].arguments[0], { email: 'kim@example.com' });
    assert.equal(created.length, 0);
  });
});

describe('signupBlockService', () => {
  let queries;
  before(() => {
    // 위 라우트 테스트에서 mock한 함수를 실제 구현으로 되돌린다.
    signupBlockService.recordBlock.mock?.restore();
    signupBlockService.isBlocked.mock?.restore();
  });
  beforeEach(() => {
    queries = [];
    mock.method(pool, 'query', async (sql, params) => {
      queries.push({ sql, params });
      return [[]];
    });
  });

  test('이메일은 공백·대소문자를 맞춘 해시로만 남고, 기간 정지는 정지가 끝날 때 기록도 지운다', async () => {
    await signupBlockService.recordBlock(STUDENT, SUSPENSION);
    const [emailHash, oauthHash, reason, endsAt, expiresAt] = queries[0].params;
    assert.equal(emailHash, sha('kim@example.com'));
    assert.equal(oauthHash, sha('google-sub-7'));
    assert.ok(!queries[0].params.includes(STUDENT.email));
    assert.equal(reason, SUSPENSION.reason);
    assert.equal(endsAt, SUSPENSION.ends_at);
    assert.equal(expiresAt.getTime(), SUSPENSION.ends_at.getTime());
  });

  test('영구 정지는 삭제한 날부터 1년 뒤에 지운다', async () => {
    const now = new Date('2026-10-27T00:00:00Z');
    await signupBlockService.recordBlock({ email: 'a@b.c', oauth_id: null }, { reason: 'r', ends_at: null }, now);
    const [, oauthHash, , endsAt, expiresAt] = queries[0].params;
    assert.equal(oauthHash, null);
    assert.equal(endsAt, null);
    assert.equal(expiresAt.toISOString(), '2027-10-27T00:00:00.000Z');
  });

  test('가입 확인은 해시로 비교한다', async () => {
    await signupBlockService.isBlocked({ email: ' KIM@example.com', oauthId: 'google-sub-7' });
    assert.deepEqual(queries[0].params, [sha('kim@example.com'), sha('google-sub-7'), sha('google-sub-7')]);
  });
});

describe('가장 무거운 제재가 먼저', () => {
  test('getActiveAccountSuspension은 유효 제재가 계정 정지일 때만 돌려준다', async () => {
    // 실제 함수를 쓰기 위해 이 describe 안에서만 원래 구현으로 되돌린다.
    sanctionService.getActiveAccountSuspension.mock.restore();
    sanctionService.getActiveSanction.mock.restore();
    let rows;
    let sql;
    mock.method(pool, 'query', async (q) => {
      sql = q;
      return [rows];
    });
    rows = [{ id: 1, scope: 'account', reason: 'r', ends_at: null }];
    assert.equal((await sanctionService.getActiveAccountSuspension(7)).scope, 'account');
    rows = [{ id: 2, scope: 'full', reason: 'r', ends_at: null }];
    assert.equal(await sanctionService.getActiveAccountSuspension(7), null);
    assert.match(sql, /ORDER BY FIELD\(scope, 'account', 'full', 'post_apply'\), created_at DESC/);
  });
});

describe('커뮤니티', () => {
  test('글쓴이가 정지 중인 글에 신청하면 409 POST_UNAVAILABLE, 신청을 만들지 않는다', async () => {
    suspension = null;
    mock.method(sanctionService, 'getActiveSanction', async () => null);
    mock.method(sanctionService, 'getActiveAccountSuspension', async () => null);
    mock.method(communityService, 'getPostById', async () => ({ id: 3, isMine: false, closedAt: null, recruitState: 'open', authorUnavailable: true }));
    const applied = mock.method(communityService, 'applyToPost', async () => ({ ok: true, id: 1 }));
    const r = await call('POST', '/api/community/3/apply', { message: '같이 해요' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'POST_UNAVAILABLE');
    assert.equal(applied.mock.callCount(), 0);
  });

  test('정지 중인 학생의 대기 신청만 신청자 목록에서 빠지고, 재신청 표시는 그대로다', async () => {
    mock.method(pool, 'query', async () => [
      [
        { id: 1, applicant_id: 20, message: 'a', status: 'rejected', applicant_name: 'x', applicant_suspended: 0 },
        { id: 2, applicant_id: 20, message: 'b', status: 'pending', applicant_name: 'x', applicant_suspended: 0 },
        { id: 3, applicant_id: 21, message: 'c', status: 'pending', applicant_name: 'y', applicant_suspended: 1 },
        { id: 4, applicant_id: 22, message: 'd', status: 'accepted', applicant_name: 'z', applicant_suspended: 1 },
      ],
    ]);
    const list = await communityService.getApplicantsForPost(3);
    assert.deepEqual(list.map((a) => a.id), [1, 2, 4]);
    assert.equal(list[1].hasAppliedBefore, true);
  });
});
