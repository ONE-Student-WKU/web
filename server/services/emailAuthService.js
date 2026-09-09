const crypto = require('crypto');
const pool = require('../db');

/**
 * server/services/emailAuthService.js
 * 이메일 인증코드(OTP) 로그인 — 도메인 제한 없이 어떤 이메일이든 인증코드로 로그인/가입
 * (구글 OAuth의 두 번째 로그인 수단, PR #142 후속). 1회용 코드는 평문 저장하지 않고
 * SHA-256 해시로만 db/schema.sql의 email_login_tokens에 저장한다.
 */

const CODE_TTL_MS = 15 * 60 * 1000;  // 15분
const MAX_ATTEMPTS = 5;               // 코드 대입 시도 상한(무차별 대입 방지)

function generateCode() {
  // 6자리 숫자 코드
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// 이메일 주소로 새 로그인 코드를 발급한다. 반환된 평문 코드는 발송 용도로만 호출부
// (routes/auth.js)에서 쓰고, API 응답에는 절대 포함하지 않는다.
async function createLoginToken(email) {
  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await pool.query(
    'INSERT INTO email_login_tokens (email, code_hash, purpose, expires_at) VALUES (?, ?, ?, ?)',
    [email, codeHash, 'login', expiresAt]
  );

  return code;
}

// 코드를 검증한다. 같은 이메일에 대해 아직 소비되지 않고 만료되지 않은 가장 최근 토큰만 대상.
async function verifyLoginToken(email, code) {
  const [rows] = await pool.query(
    `SELECT * FROM email_login_tokens
     WHERE email = ? AND consumed_at IS NULL AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [email]
  );
  const token = rows[0];
  if (!token) return { ok: false, reason: 'NOT_FOUND' };

  if (token.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
  }

  if (token.code_hash !== hashCode(code)) {
    await pool.query('UPDATE email_login_tokens SET attempts = attempts + 1 WHERE id = ?', [token.id]);
    return { ok: false, reason: 'INVALID_CODE' };
  }

  await pool.query('UPDATE email_login_tokens SET consumed_at = NOW() WHERE id = ?', [token.id]);
  return { ok: true };
}

module.exports = { createLoginToken, verifyLoginToken };
