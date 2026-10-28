const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const studentService = require('../services/studentService');
const sanctionService = require('../services/sanctionService');
const warningService = require('../services/warningService');
const communityService = require('../services/communityService');
const moderationLabelService = require('../services/moderationLabelService');
const meRouter = require('../routes/me');
const adminRouter = require('../routes/admin');

/**
 * server/test/warning.test.js
 * 경고 기록(약관 6항의 "경고"):
 *  - 관리자가 범위 'warning'으로 보내면 정지·제한이 아니라 경고 기록이 남는다(기간 없이). 신고함에서 보내면 신고된 글도 지운다
 *  - GET /api/me가 아직 확인하지 않은 경고를 내려주고, 학생이 확인하면 다음 경고(없으면 null)를 돌려준다
 *  - 관리자 "지난 제재"에 경고가 섞여 나온다
 * 학생·제재·경고·신고 조회는 mock이라 DB가 필요 없다.
 */

const STUDENT = { id: 7, role: 'student', name: 'kim' };
const ADMIN = { id: 1, role: 'admin', name: 'admin' };
const WARNING = { id: 31, reason: '문의하기에 욕설을 썼어요', createdAt: new Date('2026-10-28T01:00:00Z') };

let server;
let baseUrl;
let session;
let created;
let deleted;
let pending;

before(async () => {
  mock.method(studentService, 'findById', async (id) => (id === STUDENT.id ? { ...STUDENT } : id === ADMIN.id ? { ...ADMIN } : null));
  mock.method(sanctionService, 'getActiveAccountSuspension', async () => null);
  mock.method(sanctionService, 'createSanction', async (args) => created.push({ kind: 'sanction', ...args }));
  mock.method(warningService, 'createWarning', async (args) => created.push({ kind: 'warning', ...args }));
  mock.method(warningService, 'getPendingWarning', async () => pending[0] || null);
  mock.method(warningService, 'acknowledgeWarning', async (id, studentId) => {
    if (studentId !== STUDENT.id || !pending.length || pending[0].id !== id) return false;
    pending.shift();
    return true;
  });
  mock.method(communityService, 'getReportById', async () => ({ id: 5, reportedStudentId: STUDENT.id, targetType: 'post', targetId: 90 }));
  mock.method(communityService, 'deletePost', async (id) => deleted.push(id));
  mock.method(communityService, 'resolveReport', async () => true);
  mock.method(communityService, 'resolvePendingReportsForTarget', async () => 0);
  // AI 분류 비교 기록은 이 테스트의 대상이 아니고 실제 DB를 열어 프로세스가 끝나지 않게 하므로 막는다.
  mock.method(moderationLabelService, 'recordDecision', async () => {});

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = session;
    next();
  });
  app.use('/api', meRouter);
  app.use('/api/admin', adminRouter);
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
  session = { userId: ADMIN.id };
  created = [];
  deleted = [];
  pending = [];
});

async function call(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json() };
}

describe('관리자가 경고를 보낼 때', () => {
  test('학생에게 직접: 기간 없이 경고 기록만 남고 정지·제한은 만들지 않는다', async () => {
    const res = await call('POST', `/api/admin/community/students/${STUDENT.id}/sanction`, { scope: 'warning', reason: ' 문의하기에 욕설을 썼어요 ' });
    assert.equal(res.status, 200);
    assert.deepEqual(created, [{ kind: 'warning', studentId: STUDENT.id, reason: '문의하기에 욕설을 썼어요', createdBy: ADMIN.id, reportId: null }]);
  });

  test('신고함에서: 경고 기록에 신고 id가 붙고, 신고된 글은 제재와 같이 지워진다', async () => {
    const res = await call('POST', '/api/admin/community/reports/5/sanction', { scope: 'warning', reason: '커뮤니티 운영 정책 위반' });
    assert.equal(res.status, 200);
    assert.equal(created.length, 1);
    assert.equal(created[0].kind, 'warning');
    assert.equal(created[0].reportId, 5);
    assert.deepEqual(deleted, [90]);
  });

  test('정지·제한은 지금처럼 기간이 있어야 한다(경고만 기간을 보지 않는다)', async () => {
    const missing = await call('POST', `/api/admin/community/students/${STUDENT.id}/sanction`, { scope: 'full', reason: '사유' });
    assert.equal(missing.body.code, 'INVALID_DURATION');
    const ok = await call('POST', `/api/admin/community/students/${STUDENT.id}/sanction`, { scope: 'full', duration: '7d', reason: '사유' });
    assert.equal(ok.status, 200);
    assert.equal(created[0].kind, 'sanction');
    assert.equal(created[0].durationDays, 7);
  });

  test('경고에도 사유는 있어야 한다', async () => {
    const res = await call('POST', `/api/admin/community/students/${STUDENT.id}/sanction`, { scope: 'warning', reason: '  ' });
    assert.equal(res.body.code, 'REQUIRED_REASON');
    assert.equal(created.length, 0);
  });
});

describe('학생이 경고를 확인할 때', () => {
  beforeEach(() => {
    session = { userId: STUDENT.id };
  });

  test('GET /api/me가 아직 확인하지 않은 경고를 내려준다(없으면 null)', async () => {
    let res = await call('GET', '/api/me');
    assert.equal(res.body.data.pendingWarning, null);

    pending = [WARNING];
    res = await call('GET', '/api/me');
    assert.equal(res.body.data.pendingWarning.id, WARNING.id);
    assert.equal(res.body.data.pendingWarning.reason, WARNING.reason);
  });

  test('확인하면 다음 경고를 돌려주고, 마지막이면 null', async () => {
    pending = [WARNING, { ...WARNING, id: 32, reason: '두 번째' }];
    let res = await call('POST', `/api/me/warnings/${WARNING.id}/acknowledge`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.pendingWarning.id, 32);

    res = await call('POST', '/api/me/warnings/32/acknowledge');
    assert.equal(res.body.data.pendingWarning, null);
  });

  test('이미 확인했거나 남의 경고면 404', async () => {
    pending = [WARNING];
    const res = await call('POST', '/api/me/warnings/999/acknowledge');
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'WARNING_NOT_FOUND');
  });
});

describe('경고 취소·제재 철회(잘못된 조치)', () => {
  test('경고 취소는 기록을 지우고, 없는 경고면 404', async () => {
    const del = mock.method(warningService, 'deleteWarning', async (id) => String(id) === '31');
    const ok = await call('DELETE', '/api/admin/warnings/31');
    const missing = await call('DELETE', '/api/admin/warnings/99');
    del.mock.restore();
    assert.equal(ok.body.code, 'WARNING_DELETED');
    assert.equal(missing.status, 404);
  });

  test('제재 철회는 해제가 아니라 기록 삭제다', async () => {
    const withdraw = mock.method(sanctionService, 'withdrawSanction', async () => true);
    const lift = mock.method(sanctionService, 'liftSanction', async () => true);
    const res = await call('DELETE', '/api/admin/sanctions/4');
    const called = { withdraw: withdraw.mock.callCount(), lift: lift.mock.callCount() };
    withdraw.mock.restore();
    lift.mock.restore();
    assert.equal(res.body.code, 'SANCTION_WITHDRAWN');
    assert.deepEqual(called, { withdraw: 1, lift: 0 });
  });

  test('학생은 철회·취소 API를 쓸 수 없다', async () => {
    session = { userId: STUDENT.id };
    const res = await call('DELETE', '/api/admin/warnings/31');
    assert.equal(res.status, 403);
  });
});

describe('관리자 "지난 제재"', () => {
  test('경고가 kind로 구분돼 섞여 나오고, 날짜순(최근 먼저)이다', async () => {
    const pastMock = mock.method(sanctionService, 'listPastSanctions', async () => [
      { id: 1, student: 'a', reason: 'r', scope: 'full', startsAt: new Date('2026-10-10'), endsAt: new Date('2026-10-17'), liftedAt: null, reportId: null },
    ]);
    const warnMock = mock.method(warningService, 'listRecentWarnings', async () => [
      { id: 1, student: 'b', reason: 'w', reportId: null, createdAt: new Date('2026-10-28'), acknowledgedAt: null },
    ]);
    const res = await call('GET', '/api/admin/sanctions?status=past');
    pastMock.mock.restore();
    warnMock.mock.restore();

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.map((r) => `${r.kind}:${r.student}`),
      ['warning:b', 'sanction:a']
    );
    assert.equal('sortAt' in res.body.data[0], false);
  });
});
