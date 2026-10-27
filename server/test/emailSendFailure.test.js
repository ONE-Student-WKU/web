// routes/auth.js → services/mailer.js가 require 시점에 Resend 클라이언트를 만들어서 키가 없으면 throw한다(consent.test.js와 같은 이유).
process.env.RESEND_API_KEY ||= 're_test_dummy';
process.env.GOOGLE_CLIENT_ID ||= 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET ||= 'test-client-secret';
process.env.OAUTH_CALLBACK_BASE_URL ||= 'http://localhost:5173';

const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const authRouter = require('../routes/auth');
const mailer = require('../services/mailer');
const { CURRENT_CONSENT_VERSION } = require('../services/consent');

/**
 * server/test/emailSendFailure.test.js
 * 인증코드 메일 발송이 실패하면(Resend 하루 한도 초과 등) 503 EMAIL_SEND_FAILED로 답하고, 받지 못한 코드를 지워
 * 발송이 되살아난 뒤 바로 다시 요청할 수 있다(재전송 쿨다운에 묶이지 않는다). 메일 발송은 mock.
 */

const EMAIL = `send-fail-${Date.now()}@example.test`;
let server;
let baseUrl;
let failSend = true;

before(async () => {
  mock.method(mailer, 'sendLoginCode', async () => {
    if (failSend) throw new Error('Resend 발송 실패: daily_quota_exceeded');
  });
  mock.method(console, 'error', () => {});

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {};
    next();
  });
  app.use('/api/auth', authRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  mock.restoreAll();
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.query('DELETE FROM email_login_tokens WHERE email = ?', [EMAIL]);
  await pool.end();
});

const requestCode = async () => {
  const res = await fetch(`${baseUrl}/api/auth/email/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, consent: CURRENT_CONSENT_VERSION }),
  });
  return { status: res.status, body: await res.json() };
};

test('발송 실패: 503 EMAIL_SEND_FAILED이고 받지 못한 코드는 남지 않는다', async () => {
  const res = await requestCode();
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'EMAIL_SEND_FAILED');
  const [rows] = await pool.query('SELECT id FROM email_login_tokens WHERE email = ?', [EMAIL]);
  assert.equal(rows.length, 0);
});

test('발송이 되살아나면 쿨다운 없이 바로 다시 요청할 수 있다', async () => {
  failSend = false;
  const res = await requestCode();
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 'EMAIL_CODE_SENT');
});
