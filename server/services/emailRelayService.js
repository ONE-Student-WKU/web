const { Resend } = require('resend');

/**
 * server/services/emailRelayService.js
 * 커뮤니티 매칭 이메일 프록시(#182) 2단계 — Resend 인바운드 웹훅 검증 + 전달(forward) 전용
 * 래퍼. RESEND_API_KEY는 mailer.js와 동일한 값을 재사용하고, RESEND_WEBHOOK_SECRET은
 * .env(로컬)/Railway 환경변수(운영)에서 별도로 주입.
 */

const resend = new Resend(process.env.RESEND_API_KEY);
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

// svix 헤더 + raw body로 요청이 실제 Resend가 보낸 것인지 검증한다(서명 불일치 시 동기적으로
// throw). 이게 없으면 누구나 이 엔드포인트를 호출해 임의 emailId를 우리 학생에게
// forward시킬 수 있다. resend SDK의 verify()는 헤더 키를 svix- 접두사 없는 짧은 이름
// (id/timestamp/signature)으로, secret 키는 webhookSecret으로 받는다 — 온라인 예시들이
// 종종 svix- 원본 헤더명이나 secret 키를 그대로 써서 틀리는 부분이라(실제 설치된 SDK의
// .d.mts로 직접 확인함) 여기서 매핑을 명시한다.
function verifyWebhook(rawBody, headers) {
  return resend.webhooks.verify({
    payload: rawBody,
    headers: {
      id: headers['svix-id'],
      timestamp: headers['svix-timestamp'],
      signature: headers['svix-signature'],
    },
    webhookSecret: WEBHOOK_SECRET,
  });
}

// 받은 메일(emailId)을 실제 수신자(to)에게 원문 그대로 전달하되 발신자 표시만 상대방
// 프록시 주소(from)로 바꾼다 — passthrough가 기본값이라 본문/첨부는 우리가 손댈 필요 없이
// Resend가 그대로 옮겨준다.
async function forwardToRecipient({ emailId, to, from }) {
  const { data, error } = await resend.emails.receiving.forward({ emailId, to, from });
  if (error) {
    const err = new Error(`Resend 전달 실패: ${error.name ?? 'unknown'} - ${error.message ?? JSON.stringify(error)}`);
    err.cause = error;
    throw err;
  }
  return data;
}

module.exports = { verifyWebhook, forwardToRecipient };
