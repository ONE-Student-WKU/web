const { Resend } = require('resend');

/**
 * server/services/mailer.js
 * Resend 래퍼 — 이메일 인증코드(OTP) 로그인 발송 전용(server/services/emailAuthService.js).
 * RESEND_API_KEY / RESEND_FROM_ADDRESS는 .env(로컬) / Railway 환경변수(운영)에서 주입.
 */

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS; // 예: 'ONE Student <no-reply@mail.도메인>'

// 목적(emailAuthService 토큰의 purpose)별 메일 이름 — 계정 삭제 재인증도 같은 함수로 보내므로 제목이 "로그인"으로 나가지 않게 나눈다.
const CODE_LABELS = {
  login: '로그인 인증코드',
  delete_reauth: '계정 삭제 확인 코드',
};

// 코드를 제목에도 넣어 휴대폰 알림·메일 목록에서 메일을 열지 않고 확인할 수 있게 한다. 본문에도 그대로 둔다 —
// 복사하기 쉽고, Gmail·iOS의 "코드 복사/자동 입력"이 본문에서 코드를 찾는다.
function buildCodeEmail(code, purpose = 'login') {
  const label = CODE_LABELS[purpose] ?? CODE_LABELS.login;
  return {
    subject: `[ONE Student] ${label}: ${code}`,
    text: `ONE Student ${label}예요.\n\n${code}\n\n15분 안에 입력해 주세요. 이 코드는 다른 사람에게 알려주지 마세요.`,
  };
}

async function sendLoginCode(email, code, purpose = 'login') {
  const { subject, text } = buildCodeEmail(code, purpose);
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject,
    text,
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

module.exports = { sendLoginCode, buildCodeEmail };
