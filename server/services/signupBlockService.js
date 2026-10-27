const crypto = require('crypto');
const pool = require('../db');

/**
 * server/services/signupBlockService.js
 * 정지 중 탈퇴 계정의 재가입 제한(#457, 약관 6항·개인정보처리방침 4항).
 * 서비스 전체 이용 정지 중에 계정을 삭제하면 이메일·Google 고유 식별자의 해시와 정지 사유·기간만 남기고,
 * 정지가 끝날 때까지(영구 정지는 삭제한 날부터 1년) 같은 이메일·Google 계정으로 새 계정을 만들지 못하게 한다.
 *
 * 해시는 되돌릴 수 없는 값이라 원래 이메일을 보관하지 않으면서도 "같은 이메일인지"만 비교할 수 있다.
 * 다만 이메일처럼 짐작할 수 있는 값은 후보를 하나씩 해시해 맞춰 볼 수는 있다 — 그래서 보관 기간을 짧게 두고 지난 기록은 바로 지운다.
 */

const PERMANENT_BLOCK_DAYS = 365;
const CLEANUP_INTERVAL_MS = 6 * 3600 * 1000;

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// 로그인 라우트(routes/auth.js)가 이메일을 trim·소문자로 받으므로 같은 기준으로 맞춘다.
function hashEmail(email) {
  return hash(String(email).trim().toLowerCase());
}

// student: students 행(email, oauth_id), suspension: sanctionService.getActiveAccountSuspension 결과
async function recordBlock(student, suspension, now = new Date()) {
  const expiresAt = suspension.ends_at
    ? new Date(suspension.ends_at)
    : new Date(now.getTime() + PERMANENT_BLOCK_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO suspended_signup_blocks (email_hash, oauth_id_hash, reason, suspension_ends_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [hashEmail(student.email), student.oauth_id ? hash(student.oauth_id) : null, suspension.reason, suspension.ends_at || null, expiresAt]
  );
}

// 새 계정을 만들기 직전에 호출한다. oauthId는 Google 가입일 때만.
async function isBlocked({ email, oauthId = null }) {
  const [rows] = await pool.query(
    `SELECT 1 FROM suspended_signup_blocks
     WHERE expires_at > NOW() AND (email_hash = ? OR (? IS NOT NULL AND oauth_id_hash = ?))
     LIMIT 1`,
    [hashEmail(email), oauthId ? hash(oauthId) : null, oauthId ? hash(oauthId) : null]
  );
  return rows.length > 0;
}

async function deleteExpiredBlocks() {
  await pool.query('DELETE FROM suspended_signup_blocks WHERE expires_at <= NOW()');
}

// 보관 기간이 지난 기록을 지운다 — 방문 기록 정리(visitStatsService.startVisitRollup)와 같은 방식.
function startSignupBlockCleanup() {
  const run = () => deleteExpiredBlocks().catch((err) => console.error('[signupBlock] 지난 재가입 제한 기록 정리 실패:', err.message));
  run();
  setInterval(run, CLEANUP_INTERVAL_MS).unref();
}

module.exports = { PERMANENT_BLOCK_DAYS, hashEmail, recordBlock, isBlocked, deleteExpiredBlocks, startSignupBlockCleanup };
