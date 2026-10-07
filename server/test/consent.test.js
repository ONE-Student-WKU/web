const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const authRouter = require('../routes/auth');
const meRouter = require('../routes/me');
const emailAuthService = require('../services/emailAuthService');
const mailer = require('../services/mailer');
const { CURRENT_CONSENT_VERSION } = require('../services/consent');
const { mock } = require('node:test');

/**
 * server/test/consent.test.js
 * 이용약관·개인정보 수집·이용 동의: 로그인 폼의 필수 동의 없이는 Google 로그인 시작과 이메일 코드 발송·확인이 막히고,
 * 이메일 로그인에 성공하면 동의 시각·버전이 기록된다. 기존 계정(동의 기록 없음)은 /api/me의 consentRequired가 true이고
 * POST /api/me/consent로 동의한다. 메일 발송은 mock, 임시 학생·로그인 토큰은 끝나면 지운다.
 */

const run = Date.now();
const EMAIL = `consent-${run}@example.test`;
let server;
let baseUrl;
let sessionUserId;
let studentId;
let sentCode;

before(async () => {
  mock.method(mailer, 'sendLoginCode', async (email, code) => {
    sentCode = code;
  });

  const [r] = await pool.query('INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())', [
    `consent-existing-${run}@example.test`,
    `consent${run}`,
  ]);
  studentId = r.insertId;
  sessionUserId = studentId;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = req.session || {};
    req.session.userId = sessionUserId;
    req.session.regenerate = (cb) => cb();
    req.session.save = (cb) => cb();
    req.session.destroy = (cb) => cb();
    req.session.cookie = {};
    next();
  });
  app.use('/api/auth', authRouter);
  app.use('/api', meRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  mock.restoreAll();
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.query('DELETE FROM students WHERE email IN (?, ?)', [EMAIL, `consent-existing-${run}@example.test`]);
  try {
    await pool.query('DELETE FROM email_login_tokens WHERE email = ?', [EMAIL]);
  } catch {
    // 토큰 테이블 이름이 다르면 무시(테스트 결과와 무관한 정리)
  }
  await pool.end();
});

const post = async (path, body) => {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('Google 로그인 시작: 동의 표시가 없거나 버전이 다르면 Google로 보내지 않고 CONSENT_REQUIRED로 돌려보낸다', async () => {
  for (const query of ['', '?consent=', '?consent=1999-01-01', '?consent=true']) {
    const res = await fetch(`${baseUrl}/api/auth/google${query}`, { redirect: 'manual' });
    assert.equal(res.status, 302, query);
    assert.match(res.headers.get('location'), /authError=CONSENT_REQUIRED/, query);
  }
});

test('Google 로그인 시작: 현재 버전의 동의가 있으면 Google로 보낸다', async () => {
  const res = await fetch(`${baseUrl}/api/auth/google?consent=${CURRENT_CONSENT_VERSION}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /accounts\.google\.com/);
});

test('이메일 코드 발송: 동의가 없으면 400 CONSENT_REQUIRED이고 메일을 보내지 않는다', async () => {
  sentCode = null;
  const res = await post('/api/auth/email/request', { email: EMAIL });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'CONSENT_REQUIRED');
  assert.equal(sentCode, null);
});

test('이메일 로그인: 동의 없이는 코드를 확인하지 않고, 동의하고 로그인하면 계정이 만들어지며 동의가 기록된다', async () => {
  const sent = await post('/api/auth/email/request', { email: EMAIL, consent: CURRENT_CONSENT_VERSION });
  assert.equal(sent.status, 200);
  assert.ok(sentCode, '인증코드가 발송돼야 한다');

  const noConsent = await post('/api/auth/email/verify', { email: EMAIL, code: sentCode });
  assert.equal(noConsent.status, 400);
  assert.equal(noConsent.body.code, 'CONSENT_REQUIRED');
  const [none] = await pool.query('SELECT id FROM students WHERE email = ?', [EMAIL]);
  assert.equal(none.length, 0, '동의 없이는 계정이 만들어지지 않는다');

  const ok = await post('/api/auth/email/verify', { email: EMAIL, code: sentCode, consent: CURRENT_CONSENT_VERSION });
  assert.equal(ok.status, 200, '코드는 동의 거절로 소진되지 않아야 한다');
  const [[row]] = await pool.query('SELECT consent_version, consented_at FROM students WHERE email = ?', [EMAIL]);
  assert.equal(row.consent_version, CURRENT_CONSENT_VERSION);
  assert.ok(row.consented_at);
});

test('동의 기록이 없는 기존 계정은 consentRequired가 true이고, POST /api/me/consent로 동의하면 false가 된다', async () => {
  const before = await (await fetch(`${baseUrl}/api/me`)).json();
  assert.equal(before.data.consentRequired, true);

  const wrong = await post('/api/me/consent', { version: '1999-01-01' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'INVALID_CONSENT_VERSION');
  assert.equal((await (await fetch(`${baseUrl}/api/me`)).json()).data.consentRequired, true);

  const ok = await post('/api/me/consent', { version: CURRENT_CONSENT_VERSION });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.consentRequired, false);
  const [[row]] = await pool.query('SELECT consent_version FROM students WHERE id = ?', [studentId]);
  assert.equal(row.consent_version, CURRENT_CONSENT_VERSION);
});

test('이전 버전에 동의한 계정은 다시 동의해야 한다', async () => {
  await pool.query("UPDATE students SET consent_version = '2020-01-01' WHERE id = ?", [studentId]);
  const me = await (await fetch(`${baseUrl}/api/me`)).json();
  assert.equal(me.data.consentRequired, true);
});
