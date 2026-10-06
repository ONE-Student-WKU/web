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

function isHiddenOrTracking(tag, attribs) {
  if ('hidden' in attribs || hasHiddenStyle(attribs.style)) return true;
  if (tag === 'img') {
    if (isTinyImage(attribs)) return true;
    if (TRACKING_URL_PATTERNS.some((re) => re.test(attribs.src || ''))) return true;
  }
  return false;
}

// style은 아래 속성/값만 남긴다. 통째로 허용하면 background:url(...)·list-style-image 같은 CSS로
// 외부 요청(열람 시각·IP 추적)이 생기고, position:fixed로 메일 화면 전체를 덮어 우리 안내처럼
// 위장할 수도 있다. 값 정규식에 괄호가 들어가는 건 rgb()뿐이라 url()은 어디에도 통과하지 못한다.
const SAFE_COLOR = [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i, /^rgba?\(\s*\d{1,3}%?(\s*,\s*\d{1,3}%?){2}(\s*,\s*(0|1|0?\.\d+))?\s*\)$/i];
const SAFE_STYLES = {
  '*': {
    color: SAFE_COLOR,
    'background-color': SAFE_COLOR,
    'text-align': [/^(left|right|center|justify)$/i],
    'font-weight': [/^(normal|bold|\d{3})$/i],
    'font-style': [/^(normal|italic)$/i],
    'font-size': [/^\d{1,2}(\.\d+)?(px|pt|em|%)$/i],
    'font-family': [/^[-\w\s,'"가-힣]+$/],
    'text-decoration': [/^(none|underline|line-through)$/i],
  },
};

// 걸러낼 요소 표시. exclusiveFilter가 받는 attribs는 style이 allowedStyles로 걸러진 뒤의 값이라
// (style="display:none"처럼 남는 속성이 없으면 style 자체가 사라짐) 거기서 숨김을 판정하면 숨김
// 요소가 오히려 보이게 된다. 그래서 원본 속성을 볼 수 있는 transformTags에서 먼저 판정해 이 표시를 붙인다.
const HIDE_MARK = 'data-relay-hide';
// <img>는 내용을 가질 수 없는 요소라 transformTags의 text로 문구를 넣을 수 없다. 빈 span에 이 표시를
// 붙여 두고 정리가 끝난 뒤 문구로 바꾼다(원문에 같은 표시가 있어도 안내 문구가 하나 더 보일 뿐이다).
const EXTERNAL_IMAGE_MARK = 'data-relay-external-image';
const EXTERNAL_IMAGE_PLACEHOLDER = `<span ${EXTERNAL_IMAGE_MARK}="1"></span>`;
const EXTERNAL_IMAGE_NOTICE = '<span style="color:#888">[외부 이미지는 개인정보 보호를 위해 표시되지 않습니다]</span>';

function markRelayTag(tagName, attribs) {
  if (isHiddenOrTracking(tagName, attribs)) return { tagName, attribs: { ...attribs, [HIDE_MARK]: '1' } };
  // 외부 이미지는 받는 사람이 여는 순간 보낸 사람 서버에 열람 시각·IP가 남아 "서로의 실제 정보
  // 비공개" 약속과 어긋나므로, 인라인 첨부(cid:)가 아닌 이미지는 안내 문구로 바꾼다.
  if (tagName === 'img' && !/^cid:/i.test((attribs.src || '').trim())) {
    return attribs.src ? { tagName: 'span', attribs: { [EXTERNAL_IMAGE_MARK]: '1' } } : { tagName, attribs: { [HIDE_MARK]: '1' } };
  }
  return { tagName, attribs };
}

// 원문 HTML을 그대로 넘기면 보낸 사람 메일 서비스가 심은 추적 픽셀까지 상대에게 전달되고,
// Gmail이 그런 "원문 그대로 전달된" 메일을 스팸으로 분류하는 사례가 확인됐다(#182 스팸 조사).
// 허용 목록 방식으로 본문 표시에 필요한 태그/속성만 남기고, 숨김 요소·추적 이미지·외부 이미지·
// 스크립트는 버린다. <html>/<head>/<body> 껍데기도 여기서 벗겨져 우리 양식 안에 끼워 넣을 수 있다.
function sanitizeRelayHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'font', 'center'],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['style', 'dir', 'align', HIDE_MARK],
      // 기본값의 srcset은 외부 이미지 주소를 그대로 통과시키므로 img 속성은 직접 정한다.
      img: ['src', 'alt', 'width', 'height'],
      span: [EXTERNAL_IMAGE_MARK],
      font: ['color', 'size', 'face'],
      table: ['width', 'border', 'cellpadding', 'cellspacing'],
      td: ['width', 'colspan', 'rowspan', 'valign'],
      th: ['width', 'colspan', 'rowspan', 'valign'],
    },
    allowedEmptyAttributes: ['alt'],
    allowedStyles: SAFE_STYLES,
    allowedSchemes: ['http', 'https', 'mailto'],
    // 본문에 붙은 이미지(인라인 첨부)는 cid: 로 참조되고, 같은 content_id로 다시 첨부한다.
    allowedSchemesByTag: { img: ['cid'] },
    allowProtocolRelative: false,
    transformTags: { '*': markRelayTag },
    exclusiveFilter: (frame) => HIDE_MARK in frame.attribs,
  })
    .replaceAll(EXTERNAL_IMAGE_PLACEHOLDER, EXTERNAL_IMAGE_NOTICE)
    .trim();
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

// 전달 한도. 첨부를 전부 메모리에 올려 한 번에 보내는 구조라, 한도가 없으면 큰 메일 하나로
// 메모리가 치솟고 웹훅 응답이 늦어져 Resend가 재시도를 반복한다. 본문 한도는 sanitize-html
// 파싱이 이벤트 루프를 오래 붙잡지 않게 하려는 것.
const RELAY_LIMITS = {
  maxAttachments: 10,
  maxAttachmentTotalBytes: 10 * 1024 * 1024,
  attachmentFetchTimeoutMs: 15_000,
  maxHtmlLength: 1024 * 1024,
  maxTextLength: 1024 * 1024,
  maxSubjectLength: 200,
};

// 제목의 개행·제어문자는 헤더 주입(예: "a\r\nBcc: ...")으로 이어질 수 있어 공백으로 바꾼다.
function cleanSubject(subject) {
  const s = (subject || '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!s) return '(제목 없음)';
  const chars = [...s];
  return chars.length > RELAY_LIMITS.maxSubjectLength ? `${chars.slice(0, RELAY_LIMITS.maxSubjectLength).join('')}…` : s;
}

// 사용자 본문을 "ONE Student 매칭으로 전달된 메일" 안내 양식으로 감싼다. 본문이 "111"처럼
// 짧거나 무의미해도 메일 전체가 정상 안내 메일로 읽히게 하려는 것 — 스팸 조사 0단계에서
// 이 문구/구조 그대로 스팸이던 짧은 메일들이 받은편지함으로 가는 것을 확인했으므로, 문구를
// 바꿀 때는 같은 방식으로 다시 검증할 것. notices는 전달 과정에서 빠진 것(첨부 등)을 받는
// 사람에게 알리는 문구로, 본문 위 안내 상자에 들어간다.
function buildRelayMessage(receivedEmail, { notices = [] } = {}) {
  const allNotices = [...notices];
  const rawHtml = receivedEmail.html || '';
  // 본문 HTML이 한도를 넘으면 서식을 포기하고 텍스트로만 보낸다(텍스트 본문이 없으면 앞부분에서 뽑음).
  const htmlTooLarge = rawHtml.length > RELAY_LIMITS.maxHtmlLength;
  if (htmlTooLarge) allNotices.push('원본 메일 본문이 너무 커서 서식 없이 텍스트로만 전달되었습니다.');
  const sanitized = rawHtml && !htmlTooLarge ? sanitizeRelayHtml(rawHtml) : '';

  let text = (receivedEmail.text || '').trim();
  if (!text && rawHtml) text = htmlToText(sanitized || sanitizeRelayHtml(rawHtml.slice(0, RELAY_LIMITS.maxHtmlLength)));
  if (text.length > RELAY_LIMITS.maxTextLength) {
    text = text.slice(0, RELAY_LIMITS.maxTextLength);
    allNotices.push('원본 메일 본문이 너무 길어 앞부분만 전달되었습니다.');
  }

  const inner = sanitized || `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>`;
  const noticeBox = allNotices.length
    ? `<div style="margin:0 0 16px;padding:12px;background:#fff8e1;border:1px solid #f0d58c;border-radius:6px;font-size:13px;color:#6b5400">${allNotices.map(escapeHtml).join('<br>')}</div>\n`
    : '';
  const noticeText = allNotices.length ? `${allNotices.map((n) => `※ ${n}`).join('\n')}\n\n` : '';

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:'Malgun Gothic',sans-serif;color:#222">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e5e8;border-radius:8px;padding:24px">
<p style="margin:0 0 16px;font-size:13px;color:#555">ONE Student 커뮤니티 매칭을 통해 전달된 메일입니다.</p>
${noticeBox}<hr style="border:none;border-top:1px solid #e3e5e8;margin:0 0 16px">
<div style="font-size:14px;line-height:1.6">${inner}</div>
<hr style="border:none;border-top:1px solid #e3e5e8;margin:16px 0">
<p style="margin:0;font-size:12px;color:#777">이 메일에 답장하면 상대방에게 전달되며, 서로의 실제 이메일 주소는 공개되지 않습니다.</p>
</div></body></html>`;
  const plain = `ONE Student 커뮤니티 매칭을 통해 전달된 메일입니다.\n\n${noticeText}----------\n${text}\n----------\n\n이 메일에 답장하면 상대방에게 전달되며, 서로의 실제 이메일 주소는 공개되지 않습니다.`;

  return {
    subject: cleanSubject(receivedEmail.subject),
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

// 첨부를 목록 순서대로 하나씩 내려받는다(동시에 받으면 메모리 사용량이 첨부 개수만큼 겹친다).
// 개수·합계 한도를 넘는 첨부는 목록의 size로 미리 건너뛰고(내려받은 실제 크기로 한 번 더 확인),
// 건너뛴 개수를 돌려줘 본문 안내에 쓴다. 한도 판정은 같은 메일이면 늘 같은 결과라, 웹훅 재시도 때도
// 같은 내용이 나가 idempotency key와 충돌하지 않는다. 반면 다운로드 실패(HTTP 오류·타임아웃)는
// 일시적일 수 있어 첨부를 빼고 보내지 않고 예외를 올려 Resend의 웹훅 재시도에 맡긴다.
async function downloadAttachments(client, emailId, fetchImpl) {
  const items = await listAllAttachments(client, emailId);
  const { maxAttachments, maxAttachmentTotalBytes, attachmentFetchTimeoutMs } = RELAY_LIMITS;
  const attachments = [];
  let totalBytes = 0;
  let skipped = 0;
  for (const a of items) {
    if (attachments.length >= maxAttachments || totalBytes + (a.size ?? 0) > maxAttachmentTotalBytes) {
      skipped += 1;
      continue;
    }
    const res = await fetchImpl(a.download_url, { signal: AbortSignal.timeout(attachmentFetchTimeoutMs) });
    if (!res.ok) throw new Error(`첨부파일 다운로드 실패: ${a.filename ?? a.id} (HTTP ${res.status})`);
    const content = Buffer.from(await res.arrayBuffer());
    if (totalBytes + content.length > maxAttachmentTotalBytes) {
      skipped += 1;
      continue;
    }
    totalBytes += content.length;
    attachments.push({
      filename: a.filename || undefined,
      content,
      contentType: a.content_type,
      // 네이버 등은 content_id를 "<id@host>"처럼 꺾쇠로 감싸 주지만 본문은 "cid:id@host"로 참조하므로,
      // 꺾쇠를 벗겨야 본문 이미지와 첨부가 연결된다(그대로 넘기면 이미지가 깨짐).
      ...(a.content_disposition === 'inline' && a.content_id && { contentId: a.content_id.replace(/^<|>$/g, '') }),
    });
  }
  return { attachments, skipped };
}

// 받은 메일(emailId)을 실제 수신자(to)에게 전달한다. 원문을 그대로 넘기는 forward() 대신
// 본문을 정리해 우리 양식으로 다시 만들어 보내고, 발신자는 상대방 프록시 주소(from)에
// 표시 이름을 붙인다. Resend가 웹훅을 재시도해도 같은 메일이 두 번 나가지 않도록 emailId를
// idempotency key로 쓴다. client/fetchImpl은 테스트에서 가짜로 바꿔 끼우기 위한 인자.
async function relayInboundEmail({ emailId, to, from }, { client = resend, fetchImpl = fetch } = {}) {
  const { data: received, error: getError } = await client.emails.receiving.get(emailId, { html_format: 'cid' });
  if (getError) throw resendError('Resend 수신 메일 조회 실패', getError);

  const { attachments, skipped } = received.attachments?.length
    ? await downloadAttachments(client, emailId, fetchImpl)
    : { attachments: [], skipped: 0 };
  const notices = skipped
    ? [`첨부파일 ${skipped}개는 전달 한도(최대 ${RELAY_LIMITS.maxAttachments}개, 합계 ${RELAY_LIMITS.maxAttachmentTotalBytes / 1024 / 1024}MB)를 넘어 전달되지 않았습니다. 필요하면 보낸 분께 다른 방법으로 요청해 주세요.`]
    : [];
  const message = buildRelayMessage(received, { notices });

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

module.exports = { verifyWebhook, relayInboundEmail, buildRelayMessage, sanitizeRelayHtml, RELAY_LIMITS };
