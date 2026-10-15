const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const pool = require('../db');
const emailAuthService = require('../services/emailAuthService');

/**
 * server/test/emailAuth.bruteforce.test.js
 * 이메일 인증코드(6자리) 무차별 대입 방어 — 코드 하나당 시도 상한(MAX_ATTEMPTS=5)이 "동시에 쏜" 요청에도 지켜져야 한다.
 * 예전엔 시도 횟수를 읽고(SELECT) → 비교하고 → 올리는(UPDATE) 세 단계가 따로라서, 동시 요청 수십 개가 전부
 * "아직 0번 틀렸다"를 읽고 통과해 상한이 사실상 없었다. DB에 임시 토큰을 만들고 끝나면 지운다.
 */

const email = `bruteforce-${Date.now()}@example.test`;

after(async () => {
  await pool.query('DELETE FROM email_login_tokens WHERE email = ?', [email]);
  await pool.end();
});

test('틀린 코드를 동시에 수십 번 보내도 시도 횟수는 상한(5)까지만 비교된다', async () => {
  const realCode = await emailAuthService.createLoginToken(email);
  const wrong = (i) => String((Number(realCode) + 1 + i) % 1000000).padStart(6, '0');

  const results = await Promise.all(
    Array.from({ length: 40 }, (_, i) => emailAuthService.verifyLoginToken(email, wrong(i)))
  );

  const compared = results.filter((r) => r.reason === 'INVALID_CODE').length;
  assert.ok(compared <= 5, `상한 5를 넘겨 ${compared}번이나 코드를 비교해 줬다`);
  assert.ok(results.every((r) => r.ok === false));

  // 상한을 소진한 뒤에는 맞는 코드도 거절된다(그 코드는 폐기하고 새로 받아야 한다).
  const afterLimit = await emailAuthService.verifyLoginToken(email, realCode);
  assert.equal(afterLimit.ok, false);
  assert.equal(afterLimit.reason, 'TOO_MANY_ATTEMPTS');
});

test('맞는 코드는 한 번만 쓸 수 있다(동시에 두 번 보내도 한쪽만 성공)', async () => {
  const email2 = `onetime-${crypto.randomBytes(4).toString('hex')}@example.test`;
  try {
    const code = await emailAuthService.createLoginToken(email2);
    const results = await Promise.all([
      emailAuthService.verifyLoginToken(email2, code),
      emailAuthService.verifyLoginToken(email2, code),
      emailAuthService.verifyLoginToken(email2, code),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
  } finally {
    await pool.query('DELETE FROM email_login_tokens WHERE email = ?', [email2]);
  }
});

test('정상 흐름: 맞는 코드는 통과하고 틀린 코드는 INVALID_CODE', async () => {
  const email3 = `normal-${crypto.randomBytes(4).toString('hex')}@example.test`;
  try {
    const code = await emailAuthService.createLoginToken(email3);
    const wrongCode = String((Number(code) + 1) % 1000000).padStart(6, '0');
    assert.equal((await emailAuthService.verifyLoginToken(email3, wrongCode)).reason, 'INVALID_CODE');
    assert.equal((await emailAuthService.verifyLoginToken(email3, code)).ok, true);
    assert.equal((await emailAuthService.verifyLoginToken(email3, code)).reason, 'NOT_FOUND');
  } finally {
    await pool.query('DELETE FROM email_login_tokens WHERE email = ?', [email3]);
  }
});
