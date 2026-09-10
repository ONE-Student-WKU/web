const { Resend } = require('resend');

/**
 * server/services/mailer.js
 * Resend 래퍼 — 이메일 인증코드(OTP) 로그인 발송 전용(server/services/emailAuthService.js).
 * RESEND_API_KEY / RESEND_FROM_ADDRESS는 .env(로컬) / Railway 환경변수(운영)에서 주입.
 */

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS; // 예: 'ONE Student <no-reply@mail.도메인>'

async function sendLoginCode(email, code) {
  await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: '[ONE Student] 로그인 인증코드',
    text: `인증코드: ${code}\n\n15분 이내에 입력해주세요. 본인이 요청하지 않았다면 이 메일을 무시하세요.`,
  });
}

module.exports = { sendLoginCode };
