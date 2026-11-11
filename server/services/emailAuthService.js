// 이메일 코드 로그인의 코드를 만들고, 저장하고, 검증하는 서비스
// 코드는 email_login_tokens 표에 한 줄씩 적고, 6자리 원문 대신 해시만 저장한다
// 이 파일의 "코드"는 메일로 보내는 6자리 숫자 코드다
//   - API 응답의 code(EMAIL_CODE_SENT 등)는 결과 이름표라서 다른 것이다

const crypto = require('crypto');
const pool = require('../db');

// 코드 유효 시간: 15분
const CODE_TTL_MS = 15 * 60 * 1000;

// 코드 하나당 시도 상한: 5회
const MAX_ATTEMPTS = 5;

// 하루 한도: 최근 24시간 안의 사용 안 된 코드 8개
//   - 사용된 코드는 로그인에 성공한 정상 사용자의 것이라 세지 않는다
//   - 공격자가 남의 이메일로 보낸 코드는 쓰일 수 없어서 계속 세어진다
const MAX_SENDS_PER_DAY = 8;

// 6자리 코드를 만든다
//   - crypto.randomInt로 0~999999 중 하나를 뽑고, padStart로 앞을 0으로 채운다 (42 → 000042)
function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// 코드를 해시(요약본)로 바꾼다
//   - 같은 입력이면 같은 해시가 나오고, 해시에서 원래 코드로 되돌릴 수는 없다
function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// 코드 발급 함수: 새 코드를 만들어 해시만 DB에 저장하고, 원문은 메일 발송용으로 돌려준다
//   - 원문 6자리는 API 응답에 담지 않는다 (담으면 메일함을 못 본 사람도 로그인할 수 있다)
//   - purpose: 코드의 용도 (로그인, 계정 삭제 재인증). 용도가 다른 코드끼리 섞이지 않게 한다
async function createLoginToken(email, purpose = 'login') {
  const code = generateCode();
  const codeHash = hashCode(code);

  // 만료 시각은 앱 시계로 계산해 넣지만, 검증할 때는 DB의 NOW()와 비교한다
  //   - 함정: 두 시계가 어긋나면 15분이 그만큼 늘거나 줄어든다
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await pool.query(
    'INSERT INTO email_login_tokens (email, code_hash, purpose, expires_at) VALUES (?, ?, ?, ?)',
    [email, codeHash, purpose, expiresAt]
  );

  return code;
}

// 메일 발송이 실패하면 방금 저장한 코드를 지운다
//   - 안 지우면 받지도 못한 코드 때문에 재전송 쿨다운(5분)에 걸린다
async function discardLoginToken(email, code, purpose = 'login') {
  await pool.query(
    'DELETE FROM email_login_tokens WHERE email = ? AND purpose = ? AND code_hash = ? AND consumed_at IS NULL',
    [email, purpose, hashCode(code)]
  );
}

// 코드 검증 함수: 입력한 코드가 맞는지 확인하고, 맞으면 그 코드를 사용 완료로 바꾼다
//   - 성공: { ok: true }
//   - 실패: { ok: false, reason: NOT_FOUND | TOO_MANY_ATTEMPTS | INVALID_CODE }
async function verifyLoginToken(email, code, purpose = 'login') {

  // 이 이메일의 쓸 수 있는 코드 중 가장 최근 1개를 찾는다
  //   - consumed_at IS NULL: 이미 쓴 코드는 빼서 나중에 다시 넣지 못하게 한다 (1회용)
  //   - expires_at > NOW(): 15분이 지난 코드는 뺀다 (만료)
  const [rows] = await pool.query(
    `SELECT * FROM email_login_tokens
     WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [email, purpose]
  );
  const token = rows[0];

  // 못 찾으면 만료 · 이미 사용 · 발급 안 됨을 구분하지 않고 NOT_FOUND로 답한다
  //   - 사용자가 할 일은 셋 다 "코드 다시 요청"으로 같다
  //   - 공격자에게 "방금 누가 썼다" 같은 정보를 주지 않는 효과도 있다 (추정: 코드에 적힌 이유는 아님)
  if (!token) return { ok: false, reason: 'NOT_FOUND' };

  // 비교하기 전에 시도 한 칸을 먼저 차지한다 (시도 = 비교 기회)
  //   - 판단(attempts < 5)과 +1을 UPDATE 한 문장에 넣어 DB가 최신 값으로 한 번에 처리한다 (원자적 갱신)
  //   - 따로 하면 동시에 보낸 요청들이 모두 옛 값 0을 읽고 통과해 5회 제한이 무너진다 (경쟁 상태, race condition)
  //   - affectedRows: 이번 UPDATE가 조건에 맞아 바꾼 줄 수
  //   - affectedRows는 DB에 저장되는 값이 아니라, UPDATE를 실행할 때마다 요청별로 돌려받는 결과다
  //   - 0이면 이미 5회를 다 쓴 것 → 맞는 코드여도 비교하지 않고 거절한다
  const [claim] = await pool.query(
    'UPDATE email_login_tokens SET attempts = attempts + 1 WHERE id = ? AND consumed_at IS NULL AND attempts < ?',
    [token.id, MAX_ATTEMPTS]
  );
  if (claim.affectedRows === 0) return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };

  // 저장된 해시(expected)와 입력한 코드의 해시(actual)를 비교한다
  //   - timingSafeEqual: Node 내장 crypto의 함수. 어디서 달라지든 끝까지 비교한다 (타이밍 공격 방지)
  //   - ===는 다른 글자에서 바로 멈춰서, 몇 글자까지 맞았는지가 시간 차이로 드러난다
  //   - 길이를 먼저 보는 이유: timingSafeEqual은 길이가 다르면 에러를 던져 500이 된다 → 그 전에 INVALID_CODE로 끝낸다
  //   - 길이 검사는 입력한 숫자의 자릿수가 아니라 두 해시의 길이를 비교한다
  //   - 둘 다 해시(32바이트)라 정상이면 길이가 항상 같다 (3자리를 넣어도 해시는 32바이트 → 내용 비교에서 INVALID_CODE)
  //   - 길이가 다르면 사용자가 아니라 서버 쪽 문제라서, 500으로 드러내는 게 더 맞다 (개선점)
  const expected = Buffer.from(token.code_hash, 'hex');
  const actual = Buffer.from(hashCode(String(code)), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'INVALID_CODE' };
  }

  // 같은 코드를 동시에 두 번 보내도 한쪽만 성공하게 사용 완료로 바꾼다 (1회용)
  //   - consumed_at IS NULL 조건: 먼저 온 요청만 줄을 바꾸고 affectedRows 1을 받는다
  //   - 늦게 온 요청은 이미 채워져 있어 affectedRows 0 → NOT_FOUND
  const [consume] = await pool.query(
    'UPDATE email_login_tokens SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL',
    [token.id]
  );
  if (consume.affectedRows === 0) return { ok: false, reason: 'NOT_FOUND' };
  return { ok: true };
}

// 재전송 확인 함수: 코드를 또 보내도 되는지 정하고, 안 되면 다시 요청할 수 있는 시각(retryAt)을 돌려준다
//   - 쿨다운(다시 요청할 수 있을 때까지 기다리는 시간): 가장 최근 코드가 발급된 지 5분이 안 됐으면 막는다
//   - 하루 한도: 24시간 안의 사용 안 된 코드가 8개 이상이면 막는다
async function checkResendAllowed(email, purpose = 'login') {

  // 이 이메일의 최근 24시간 사용 안 된 코드를 오래된 순으로 가져온다
  //   - TIMESTAMPDIFF(SECOND, 지금, 끝나는 시각): 쿨다운 · 하루 한도가 끝날 때까지 남은 초
  //   - DB에서는 남은 초만 받고, 시각은 앱 시계에 더해 만든다
  //   - 이유: DB와 앱 서버의 시계가 다를 수 있어서. 남은 초는 어느 시계로 재도 같다
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

  // 가장 최근 코드가 아직 쿨다운 중이면 막는다
  const last = rows[rows.length - 1];
  if (last.cooldown_remaining_sec > 0) {
    return { ok: false, retryAt: new Date(Date.now() + last.cooldown_remaining_sec * 1000) };
  }

  // 하루 한도를 넘었으면 막는다
  if (rows.length >= MAX_SENDS_PER_DAY) {
    const oldest = rows[0];
    return { ok: false, retryAt: new Date(Date.now() + Math.max(oldest.daily_remaining_sec, 0) * 1000) };
  }

  return { ok: true };
}

module.exports = { createLoginToken, discardLoginToken, verifyLoginToken, checkResendAllowed };
