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

// 도메인 제한 없이 아무 이메일이나 발송 대상이 될 수 있어(로그인 계정 소유 확인 전 단계),
// 발송 자체를 좁게 제한해야 남의 메일함을 대상으로 한 이메일 폭탄을 막을 수 있다.
// 정책: 발송 후 5분 쿨다운 + 24시간 내 미사용(consumed_at IS NULL) 코드 최대 8회 → 이후
// 그 날은 차단. "미사용"만 세는 이유: 로그인에 실제로 성공한 코드는 그 순간 그 로그인
// 시도가 끝난 것이므로, 같은 날 다른 기기/세션에서 또 로그인하려는 정상적인 재시도까지
// 이 카운터에 묶이면 안 된다(로그인 상태 유지를 꺼뒀거나 세션이 끊겨서 하루에 여러 번
// 로그인해야 하는 경우가 실사용에서 실제로 있었음 — 성공한 로그인까지 세면 스팸을
// 안 보낸 사용자가 스팸 방지 장치에 락아웃당하는 꼴이 됨). 공격자가 보낸 코드는 받는
// 사람이 입력할 수 없으니 항상 미사용으로 남아 이 카운터에 그대로 잡힌다.
// 5분/24시간 수치 자체는 checkResendAllowed의 SQL(INTERVAL 5 MINUTE / 24 HOUR)에 있다 —
// 거기서 DB의 NOW() 기준으로 판정해야 해서 여기 상수로 안 빼고 SQL에 그대로 둠.
const MAX_SENDS_PER_DAY = 8;

function generateCode() {
  // 6자리 숫자 코드
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// 이메일 주소로 새 로그인 코드를 발급한다. 반환된 평문 코드는 발송 용도로만 호출부
// (routes/auth.js)에서 쓰고, API 응답에는 절대 포함하지 않는다.
// purpose로 용도를 구분(기본 'login') — 계정 삭제 재인증(delete_reauth) 등 다른 목적의 코드가
// 서로의 검증 대상에 섞이지 않게 한다(db/schema.sql의 email_login_tokens.purpose 컬럼).
async function createLoginToken(email, purpose = 'login') {
  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await pool.query(
    'INSERT INTO email_login_tokens (email, code_hash, purpose, expires_at) VALUES (?, ?, ?, ?)',
    [email, codeHash, purpose, expiresAt]
  );

  return code;
}

// 코드를 검증한다. 같은 이메일+purpose에 대해 아직 소비되지 않고 만료되지 않은 가장 최근
// 토큰만 대상.
async function verifyLoginToken(email, code, purpose = 'login') {
  const [rows] = await pool.query(
    `SELECT * FROM email_login_tokens
     WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [email, purpose]
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

// 코드 발송(최초/재전송) 전에 호출 — 쿨다운/일일 한도에 걸리면 언제 다시 시도할 수 있는지
// (retryAt)를 같이 돌려줘서 호출부가 클라이언트에 타이머로 보여줄 수 있게 한다.
// consumed_at IS NULL(미사용 코드만) 대상으로 판정한다 — 위 MAX_SENDS_PER_DAY 주석 참고.
// "쿨다운이 남았는지/얼마나 남았는지"는 MySQL의 NOW() 기준으로 초 단위 "남은 시간"만 받아오고,
// 클라이언트에 내려줄 실제 시각(retryAt)은 그 남은 시간을 Node 프로세스의 Date.now()에
// 더해서 만든다 — DB 서버와 앱 서버 시계가 어긋나 있어도(로컬 Docker에서 실제로 겪음: 컨테이너
// 시계가 몇 시간씩 밀려 있었음) "얼마나 남았나"라는 상대값만 DB에서 받으므로 절대 시각 자체는
// 클라이언트가 보는 시계(Node 서버 시계)와 항상 일치한다.
async function checkResendAllowed(email, purpose = 'login') {
  const [rows] = await pool.query(
    `SELECT
       TIMESTAMPDIFF(SECOND, NOW(), created_at + INTERVAL 5 MINUTE) AS cooldown_remaining_sec,
       TIMESTAMPDIFF(SECOND, NOW(), created_at + INTERVAL 24 HOUR) AS daily_remaining_sec
     FROM email_login_tokens
     WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND created_at > NOW() - INTERVAL 24 HOUR
     ORDER BY created_at ASC`,
    [email, purpose]
  );

  if (rows.length === 0) return { ok: true };

  const last = rows[rows.length - 1];
  if (last.cooldown_remaining_sec > 0) {
    return { ok: false, retryAt: new Date(Date.now() + last.cooldown_remaining_sec * 1000) };
  }

  if (rows.length >= MAX_SENDS_PER_DAY) {
    const oldest = rows[0];
    return { ok: false, retryAt: new Date(Date.now() + Math.max(oldest.daily_remaining_sec, 0) * 1000) };
  }

  return { ok: true };
}

module.exports = { createLoginToken, verifyLoginToken, checkResendAllowed };
