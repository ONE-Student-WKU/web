const { getPendingCounts } = require('./adminStatsService');

/**
 * server/services/adminAlertService.js
 * 관리자 알림 — 새 문의·신고·승인 대기 글이 생기면 Discord 채널(웹훅)에 한 줄 보낸다. 운영자가 메일을 자주 보지 않아도
 * 폰 푸시로 바로 알게 하려는 것이다(2026-10-24).
 *
 * - 메시지에는 종류와 미처리 건수, 사이트 주소만 넣는다. 문의·글 내용, 이름, 학과 같은 개인정보는 Discord(해외 서비스)로
 *   보내지 않는다 — 내용은 관리자 페이지에서 본다. 그래서 개인정보처리방침·동의 버전을 바꿀 일이 없다.
 * - DISCORD_WEBHOOK_URL이 비어 있으면(로컬 개발·테스트) 아무 것도 하지 않는다.
 * - 알림은 부가 기능이라 실패해도 사용자 요청에 영향을 주지 않는다. 호출하는 쪽은 기다리지 않고(fire-and-forget),
 *   이 함수는 절대 throw하지 않는다.
 */

const KINDS = {
  inquiry: { label: '새 문의가 들어왔어요', pendingKey: 'inquiries' },
  report: { label: '새 신고가 접수됐어요', pendingKey: 'reports' },
  post: { label: '승인을 기다리는 새 글이 있어요', pendingKey: 'posts' },
};

const TIMEOUT_MS = 5000;

// 웹훅에 보낼 본문. pending은 getPendingCounts()의 결과(실패하면 null — 건수 없이 보낸다).
function buildAdminAlertMessage(kind, pending, siteUrl) {
  const spec = KINDS[kind];
  if (!spec) return null;
  const parts = [spec.label];
  if (pending && Number.isFinite(pending[spec.pendingKey])) parts.push(`미처리 ${pending[spec.pendingKey]}건`);
  let content = parts.join(' · ');
  if (siteUrl) content += `\n관리자 페이지에서 보기: <${siteUrl}>`;
  // allowed_mentions.parse=[]: 본문이 무엇이든 @everyone 같은 멘션이 걸리지 않게 한다.
  return { username: 'ONE 알림', content, allowed_mentions: { parse: [] } };
}

// 옵션은 테스트용 주입 지점이다(DB·네트워크 없이 검증).
async function notifyAdmin(
  kind,
  { fetchImpl = globalThis.fetch, webhookUrl = process.env.DISCORD_WEBHOOK_URL, getPending = getPendingCounts } = {}
) {
  if (!webhookUrl || !KINDS[kind]) return false;
  try {
    let pending = null;
    try {
      pending = await getPending();
    } catch (err) {
      console.error('[adminAlert] 미처리 건수 조회 실패:', err.message);
    }
    const siteUrl = process.env.OAUTH_CALLBACK_BASE_URL || null;
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildAdminAlertMessage(kind, pending, siteUrl)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[adminAlert] Discord 웹훅 응답 ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    // 웹훅 주소는 비밀값이라 로그에 남기지 않는다(에러 메시지만).
    console.error('[adminAlert] Discord 웹훅 전송 실패:', err.message);
    return false;
  }
}

module.exports = { notifyAdmin, buildAdminAlertMessage };
