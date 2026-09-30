const { Resend } = require('resend');
const sanitizeHtml = require('sanitize-html');

/**
 * server/services/emailRelayService.js
 * 커뮤니티 매칭 이메일 프록시(#182) 2단계 — Resend 인바운드 웹훅 검증 + 전달 전용
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

const SENDER_DISPLAY_NAME = 'ONE Student 매칭';

// 메일 클라이언트가 본문에 몰래 심는 수신 확인(읽음 추적) 이미지 주소. 1×1/숨김 이미지는
// 아래 isHiddenOrTracking이 일반적으로 걸러내고, 이 목록은 크기 표시 없이 들어오는 경우 대비.
const TRACKING_URL_PATTERNS = [/mail\.naver\.com\/readReceipt/i];

function hasHiddenStyle(style = '') {
  const s = style.toLowerCase().replace(/\s+/g, '');
  return s.includes('display:none') || s.includes('visibility:hidden') || s.includes('mso-hide:all');
}

function isTinyImage(attribs) {
  const dim = (v) => (v === undefined ? null : parseInt(String(v), 10));
  const w = dim(attribs.width);
  const h = dim(attribs.height);
  if (w !== null && h !== null && w <= 1 && h <= 1) return true;
  const s = (attribs.style || '').toLowerCase().replace(/\s+/g, '');
  return /(^|;)width:[01]px/.test(s) && /(^|;)height:[01]px/.test(s);
}

function isHiddenOrTracking(frame) {
  const { tag, attribs } = frame;
  if ('hidden' in attribs || hasHiddenStyle(attribs.style)) return true;
  if (tag === 'img') {
    if (isTinyImage(attribs)) return true;
    if (TRACKING_URL_PATTERNS.some((re) => re.test(attribs.src || ''))) return true;
  }
  return false;
}

// 원문 HTML을 그대로 넘기면 보낸 사람 메일 서비스가 심은 추적 픽셀까지 상대에게 전달되고,
// Gmail이 그런 "원문 그대로 전달된" 메일을 스팸으로 분류하는 사례가 확인됐다(#182 스팸 조사).
// 허용 목록 방식으로 본문 표시에 필요한 태그/속성만 남기고, 숨김 요소·추적 이미지·스크립트는
// 통째로 버린다. <html>/<head>/<body> 껍데기도 여기서 벗겨져 우리 양식 안에 끼워 넣을 수 있다.
function sanitizeRelayHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'font', 'center'],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      // hidden은 표시용이 아니라, exclusiveFilter가 받는 attribs에 남아 있어야 숨김 요소로 걸러낼 수 있어서 허용.
      '*': ['style', 'dir', 'align', 'hidden'],
      font: ['color', 'size', 'face'],
      table: ['width', 'border', 'cellpadding', 'cellspacing'],
      td: ['width', 'colspan', 'rowspan', 'valign'],
      th: ['width', 'colspan', 'rowspan', 'valign'],
    },
    allowedEmptyAttributes: ['alt', 'hidden'],
    allowedSchemes: ['http', 'https', 'mailto'],
    // 본문에 붙은 이미지(인라인 첨부)는 cid: 로 참조되고, 같은 content_id로 다시 첨부한다.
    allowedSchemesByTag: { img: ['http', 'https', 'cid'] },
    exclusiveFilter: isHiddenOrTracking,
  }).trim();
}

const HTML_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

function htmlToText(html) {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return stripped
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => HTML_ENTITIES[m])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// 사용자 본문을 "ONE Student 매칭으로 전달된 메일" 안내 양식으로 감싼다. 본문이 "111"처럼
// 짧거나 무의미해도 메일 전체가 정상 안내 메일로 읽히게 하려는 것 — 스팸 조사 0단계에서
// 이 문구/구조 그대로 스팸이던 짧은 메일들이 받은편지함으로 가는 것을 확인했으므로, 문구를
// 바꿀 때는 같은 방식으로 다시 검증할 것.
function buildRelayMessage(receivedEmail) {
  const text = (receivedEmail.text || '').trim() || (receivedEmail.html ? htmlToText(sanitizeRelayHtml(receivedEmail.html)) : '');
  const inner = receivedEmail.html
    ? sanitizeRelayHtml(receivedEmail.html)
    : `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>`;

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:'Malgun Gothic',sans-serif;color:#222">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e5e8;border-radius:8px;padding:24px">
<p style="margin:0 0 16px;font-size:13px;color:#555">ONE Student 커뮤니티 매칭을 통해 전달된 메일입니다.</p>
<hr style="border:none;border-top:1px solid #e3e5e8;margin:0 0 16px">
<div style="font-size:14px;line-height:1.6">${inner}</div>
<hr style="border:none;border-top:1px solid #e3e5e8;margin:16px 0">
<p style="margin:0;font-size:12px;color:#777">이 메일에 답장하면 상대방에게 전달되며, 서로의 실제 이메일 주소는 공개되지 않습니다.</p>
</div></body></html>`;
  const plain = `ONE Student 커뮤니티 매칭을 통해 전달된 메일입니다.\n\n----------\n${text}\n----------\n\n이 메일에 답장하면 상대방에게 전달되며, 서로의 실제 이메일 주소는 공개되지 않습니다.`;

  return {
    subject: (receivedEmail.subject || '').trim() || '(제목 없음)',
    html,
    text: plain,
  };
}

function resendError(label, error) {
  const err = new Error(`${label}: ${error.name ?? 'unknown'} - ${error.message ?? JSON.stringify(error)}`);
  err.cause = error;
  return err;
}

async function listAllAttachments(client, emailId) {
  const all = [];
  let after;
  for (;;) {
    const { data, error } = await client.emails.receiving.attachments.list({ emailId, limit: 100, ...(after && { after }) });
    if (error) throw resendError('Resend 첨부파일 조회 실패', error);
    all.push(...data.data);
    if (!data.has_more || data.data.length === 0) return all;
    after = data.data[data.data.length - 1].id;
  }
}

async function downloadAttachments(client, emailId, fetchImpl) {
  const items = await listAllAttachments(client, emailId);
  return Promise.all(
    items.map(async (a) => {
      const res = await fetchImpl(a.download_url);
      if (!res.ok) throw new Error(`첨부파일 다운로드 실패: ${a.filename ?? a.id} (HTTP ${res.status})`);
      return {
        filename: a.filename || undefined,
        content: Buffer.from(await res.arrayBuffer()),
        contentType: a.content_type,
        // 네이버 등은 content_id를 "<id@host>"처럼 꺾쇠로 감싸 주지만 본문은 "cid:id@host"로 참조하므로,
        // 꺾쇠를 벗겨야 본문 이미지와 첨부가 연결된다(그대로 넘기면 이미지가 깨짐).
        ...(a.content_disposition === 'inline' && a.content_id && { contentId: a.content_id.replace(/^<|>$/g, '') }),
      };
    })
  );
}

// 받은 메일(emailId)을 실제 수신자(to)에게 전달한다. 원문을 그대로 넘기는 forward() 대신
// 본문을 정리해 우리 양식으로 다시 만들어 보내고, 발신자는 상대방 프록시 주소(from)에
// 표시 이름을 붙인다. Resend가 웹훅을 재시도해도 같은 메일이 두 번 나가지 않도록 emailId를
// idempotency key로 쓴다. client/fetchImpl은 테스트에서 가짜로 바꿔 끼우기 위한 인자.
async function relayInboundEmail({ emailId, to, from }, { client = resend, fetchImpl = fetch } = {}) {
  const { data: received, error: getError } = await client.emails.receiving.get(emailId, { html_format: 'cid' });
  if (getError) throw resendError('Resend 수신 메일 조회 실패', getError);

  const attachments = received.attachments?.length ? await downloadAttachments(client, emailId, fetchImpl) : [];
  const message = buildRelayMessage(received);

  const { data, error } = await client.emails.send(
    {
      from: `${SENDER_DISPLAY_NAME} <${from}>`,
      to,
      ...message,
      ...(attachments.length && { attachments }),
    },
    { idempotencyKey: `relay-${emailId}` }
  );
  if (error) throw resendError('Resend 전달 실패', error);
  return data;
}

module.exports = { verifyWebhook, relayInboundEmail, buildRelayMessage, sanitizeRelayHtml };
