const { Resend } = require('resend');

/**
 * server/services/mailer.js
 * Resend 래퍼 — 이메일 인증코드(OTP) 로그인 발송 전용(server/services/emailAuthService.js).
 * RESEND_API_KEY / RESEND_FROM_ADDRESS는 .env(로컬) / Railway 환경변수(운영)에서 주입.
 */

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS; // 예: 'ONE Student <no-reply@mail.도메인>'

async function sendLoginCode(email, code) {
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: '[ONE Student] 로그인 인증코드',
    text: `인증코드: ${code}\n\n15분 이내에 입력해주세요. 본인이 요청하지 않았다면 이 메일을 무시하세요.`,
  });

  // resend.emails.send()는 API 요청이 거부돼도(from/도메인 권한 불일치 등) throw하지 않고
  // { data, error } 형태로 반환한다. error를 확인하지 않으면 호출부(auth.js)가 발송 실패를
  // 모른 채 200 EMAIL_CODE_SENT를 응답해버리는 문제가 있어 여기서 명시적으로 throw한다.
  if (error) {
    const err = new Error(`Resend 발송 실패: ${error.name ?? 'unknown'} - ${error.message ?? JSON.stringify(error)}`);
    err.cause = error;
    throw err;
  }

  return data;
}

module.exports = { sendLoginCode };
