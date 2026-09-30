const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

// Resend 클라이언트는 모듈 로드 시 생성되므로(키가 없으면 생성자가 throw) 로드 전에 채워둔다.
// 실제 API는 호출하지 않는다 — relayInboundEmail에는 가짜 client를 넘긴다.
process.env.RESEND_API_KEY ||= 're_test_dummy';

const pool = require('../db');
const communityService = require('../services/communityService');
const emailRelayService = require('../services/emailRelayService');
const emailRelayRouter = require('../routes/emailRelay');

const { buildRelayMessage, sanitizeRelayHtml, relayInboundEmail } = emailRelayService;

/**
 * server/test/emailRelayService.relay.test.js
 * 이메일 프록시(#182) 스팸 대응 회귀 방지 — 받은 메일을 원문 그대로 forward하던 방식이
 * Gmail에서 스팸으로 분류돼, 본문을 정리(추적 픽셀/숨김 요소 제거)하고 안내 양식으로 감싸
 * send()로 다시 보내도록 바꿨다. 그 정리/양식/발송 인자와, 웹훅 라우트가 새 함수를 부르는지를 확인.
 */

after(async () => {
  await pool.end();
});

// 실제로 스팸 분류됐던 네이버 발신 메일과 같은 구조(</html> 뒤에 숨김 테이블 + 읽음 확인 이미지).
// 추적 토큰 값만 가짜로 바꿨다.
const NAVER_HTML =
  '<html><head><style>p{margin-top:0px;margin-bottom:0px;}</style></head><body>' +
  '<div style="font-size:14px; font-family:Malgun Gothic,맑은 고딕,sans-serif;">테스트</div></body></html>' +
  "<table style='display:none'><tr><td><img src=\"https://mail.naver.com/readReceipt/notify/?img=FAKE_TOKEN.gif\" border=\"0\"/></td></tr></table>";

test('sanitizeRelayHtml: 네이버 읽음 확인 픽셀과 숨김 테이블, html/head/style 껍데기를 제거하고 본문은 남긴다', () => {
  const out = sanitizeRelayHtml(NAVER_HTML);
  assert.ok(out.includes('테스트'));
  assert.ok(!out.includes('readReceipt'));
  assert.ok(!out.includes('FAKE_TOKEN'));
  assert.ok(!/<table/i.test(out));
  assert.ok(!/<(html|head|body|style)/i.test(out));
  assert.ok(!out.includes('margin-top:0px;margin-bottom'), 'style 태그 안의 CSS 텍스트가 본문에 새면 안 됨');
});

test('sanitizeRelayHtml: 스크립트/이벤트 속성/숨김 요소/1×1 이미지는 지우고 일반 이미지와 링크, cid 이미지는 남긴다', () => {
  const out = sanitizeRelayHtml(
    '<div>보이는 글</div>' +
      '<script>alert(1)</script>' +
      '<a href="https://example.com" onclick="steal()">링크</a>' +
      '<div style="display: none">숨김 글</div>' +
      '<span hidden>hidden 속성 글</span>' +
      '<img src="https://tracker.example/p.gif" width="1" height="1">' +
      '<img src="https://tracker.example/q.gif" style="width:1px;height:1px">' +
      '<img src="https://img.example/photo.png" width="300" height="200">' +
      '<img src="cid:ii_abc123">' +
      '<a href="javascript:steal()">나쁜 링크</a>'
  );
  assert.ok(out.includes('보이는 글'));
  assert.ok(!out.includes('<script') && !out.includes('alert(1)'));
  assert.ok(!out.includes('onclick'));
  assert.ok(!out.includes('숨김 글'));
  assert.ok(!out.includes('hidden 속성 글'));
  assert.ok(!out.includes('tracker.example'));
  assert.ok(out.includes('https://img.example/photo.png'));
  assert.ok(out.includes('src="cid:ii_abc123"'));
  assert.ok(out.includes('href="https://example.com"'));
  assert.ok(!out.includes('javascript:'));
});

test('buildRelayMessage: 본문을 안내 양식으로 감싸고, 텍스트 본문에도 같은 안내를 붙인다', () => {
  const msg = buildRelayMessage({ subject: '최원강', text: '111', html: NAVER_HTML });
  assert.equal(msg.subject, '최원강');
  assert.ok(msg.html.includes('ONE Student 커뮤니티 매칭을 통해 전달된 메일입니다.'));
  assert.ok(msg.html.includes('서로의 실제 이메일 주소는 공개되지 않습니다.'));
  assert.ok(msg.html.includes('테스트'));
  assert.ok(!msg.html.includes('readReceipt'));
  assert.ok(msg.text.startsWith('ONE Student 커뮤니티 매칭을 통해 전달된 메일입니다.'));
  assert.ok(msg.text.includes('\n111\n'));
});

test('buildRelayMessage: 제목이 비면 (제목 없음), 텍스트만 온 메일은 HTML 이스케이프해 넣는다', () => {
  const msg = buildRelayMessage({ subject: '  ', text: '<b>굵게</b> & 안녕', html: null });
  assert.equal(msg.subject, '(제목 없음)');
  assert.ok(msg.html.includes('&lt;b&gt;굵게&lt;/b&gt; &amp; 안녕'));
  assert.ok(msg.text.includes('<b>굵게</b> & 안녕'));
});

test('buildRelayMessage: HTML만 온 메일은 HTML에서 텍스트 본문을 만든다', () => {
  const msg = buildRelayMessage({ subject: 's', text: null, html: '<p>첫 줄</p><p>둘째 &amp; 줄</p><div style="display:none">숨김</div>' });
  assert.ok(msg.text.includes('첫 줄\n둘째 & 줄'));
  assert.ok(!msg.text.includes('숨김'));
});

function fakeClient({ received, attachments = [], getError = null, sendError = null } = {}) {
  const calls = { get: [], list: [], send: [] };
  const client = {
    emails: {
      receiving: {
        get: async (id, opts) => {
          calls.get.push([id, opts]);
          return getError ? { data: null, error: getError } : { data: received, error: null };
        },
        attachments: {
          list: async (opts) => {
            calls.list.push(opts);
            return { data: { object: 'list', has_more: false, data: attachments }, error: null };
          },
        },
      },
      send: async (payload, opts) => {
        calls.send.push([payload, opts]);
        return sendError ? { data: null, error: sendError } : { data: { id: 'sent-1' }, error: null };
      },
    },
  };
  return { client, calls };
}

const fakeFetch = async (url) => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(`bytes:${url}`).buffer });

test('relayInboundEmail: cid 형식으로 원문을 받아 양식으로 감싸 send()하고, 표시 이름과 idempotency key를 붙인다', async () => {
  const { client, calls } = fakeClient({ received: { subject: '안녕', text: '본문', html: NAVER_HTML, attachments: [] } });
  const result = await relayInboundEmail({ emailId: 'em_1', to: 'student@example.com', from: 'abc123@relay.example' }, { client, fetchImpl: fakeFetch });

  assert.deepEqual(result, { id: 'sent-1' });
  assert.deepEqual(calls.get, [['em_1', { html_format: 'cid' }]]);
  assert.equal(calls.list.length, 0, '첨부가 없으면 첨부 목록을 조회하지 않음');
  const [payload, opts] = calls.send[0];
  assert.equal(payload.from, 'ONE Student 매칭 <abc123@relay.example>');
  assert.equal(payload.to, 'student@example.com');
  assert.equal(payload.subject, '안녕');
  assert.ok(payload.html.includes('ONE Student 커뮤니티 매칭을 통해 전달된 메일입니다.'));
  assert.ok(!payload.html.includes('readReceipt'));
  assert.equal(payload.attachments, undefined);
  assert.deepEqual(opts, { idempotencyKey: 'relay-em_1' });
});

test('relayInboundEmail: 첨부파일을 내려받아 다시 붙이고, 인라인 이미지는 contentId를 유지한다', async () => {
  const { client, calls } = fakeClient({
    received: { subject: 's', text: 't', html: '<p>사진 <img src="cid:img1"></p>', attachments: [{ id: 'a1' }, { id: 'a2' }] },
    attachments: [
      { id: 'a1', filename: '과제.pdf', content_type: 'application/pdf', content_disposition: 'attachment', download_url: 'https://dl/a1' },
      { id: 'a2', filename: 'photo.png', content_type: 'image/png', content_disposition: 'inline', content_id: 'img1', download_url: 'https://dl/a2' },
    ],
  });
  await relayInboundEmail({ emailId: 'em_2', to: 't@example.com', from: 'p@relay.example' }, { client, fetchImpl: fakeFetch });

  assert.deepEqual(calls.list, [{ emailId: 'em_2', limit: 100 }]);
  const [payload] = calls.send[0];
  assert.ok(payload.html.includes('src="cid:img1"'));
  assert.equal(payload.attachments.length, 2);
  assert.equal(payload.attachments[0].filename, '과제.pdf');
  assert.equal(payload.attachments[0].contentType, 'application/pdf');
  assert.equal(payload.attachments[0].contentId, undefined);
  assert.equal(payload.attachments[0].content.toString(), 'bytes:https://dl/a1');
  assert.equal(payload.attachments[1].contentId, 'img1');
});

test('relayInboundEmail: 꺾쇠로 감싼 content_id(네이버 형식)는 벗겨서 본문의 cid: 참조와 맞춘다', async () => {
  const { client, calls } = fakeClient({
    received: { subject: 's', text: 't', html: '<img src="cid:6ff6@cweb009.nm">', attachments: [{ id: 'a1' }] },
    attachments: [
      { id: 'a1', filename: 'image.png', content_type: 'image/png', content_disposition: 'inline', content_id: '<6ff6@cweb009.nm>', download_url: 'https://dl/a1' },
    ],
  });
  await relayInboundEmail({ emailId: 'em_4', to: 't@example.com', from: 'p@relay.example' }, { client, fetchImpl: fakeFetch });

  const [payload] = calls.send[0];
  assert.ok(payload.html.includes('src="cid:6ff6@cweb009.nm"'));
  assert.equal(payload.attachments[0].contentId, '6ff6@cweb009.nm');
});

test('relayInboundEmail: 첨부 다운로드가 실패하면 첨부 없이 보내지 않고 에러를 낸다', async () => {
  const { client, calls } = fakeClient({
    received: { subject: 's', text: 't', html: null, attachments: [{ id: 'a1' }] },
    attachments: [{ id: 'a1', filename: 'x.pdf', content_type: 'application/pdf', content_disposition: 'attachment', download_url: 'https://dl/a1' }],
  });
  const failingFetch = async () => ({ ok: false, status: 403 });
  await assert.rejects(
    relayInboundEmail({ emailId: 'em_3', to: 't@example.com', from: 'p@relay.example' }, { client, fetchImpl: failingFetch }),
    /첨부파일 다운로드 실패/
  );
  assert.equal(calls.send.length, 0);
});

test('relayInboundEmail: Resend 조회/발송 오류는 예외로 올린다', async () => {
  const getFail = fakeClient({ getError: { name: 'not_found', message: 'no email' } });
  await assert.rejects(relayInboundEmail({ emailId: 'x', to: 't@example.com', from: 'p@relay.example' }, { client: getFail.client }), /수신 메일 조회 실패/);
  assert.equal(getFail.calls.send.length, 0);

  const sendFail = fakeClient({ received: { subject: 's', text: 't', html: null, attachments: [] }, sendError: { name: 'validation_error', message: 'bad from' } });
  await assert.rejects(relayInboundEmail({ emailId: 'y', to: 't@example.com', from: 'p@relay.example' }, { client: sendFail.client }), /전달 실패: validation_error - bad from/);
});

test('POST /inbound: 서명 검증을 통과한 email.received 이벤트는 relayInboundEmail로 전달된다', async () => {
  const original = {
    verifyWebhook: emailRelayService.verifyWebhook,
    relayInboundEmail: emailRelayService.relayInboundEmail,
    findEmailRelayTarget: communityService.findEmailRelayTarget,
  };
  const relayed = [];
  emailRelayService.verifyWebhook = (raw) => JSON.parse(raw);
  emailRelayService.relayInboundEmail = async (args) => relayed.push(args);
  communityService.findEmailRelayTarget = async (addr) =>
    addr === 'mine@relay.example' ? { recipientEmail: 'real@example.com', senderProxyEmail: 'other@relay.example' } : null;

  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }));
  app.use('/api/email-relay', emailRelayRouter);
  const server = http.createServer(app).listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/email-relay/inbound`;
  const post = (body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  try {
    const ok = await post({ type: 'email.received', data: { email_id: 'em_9', to: ['mine@relay.example'] } });
    assert.equal(ok.code, 'RELAYED');
    assert.deepEqual(relayed, [{ emailId: 'em_9', to: 'real@example.com', from: 'other@relay.example' }]);

    const unknown = await post({ type: 'email.received', data: { email_id: 'em_10', to: ['nobody@relay.example'] } });
    assert.equal(unknown.code, 'PROXY_NOT_FOUND');
    assert.equal(relayed.length, 1);
  } finally {
    server.close();
    Object.assign(emailRelayService, { verifyWebhook: original.verifyWebhook, relayInboundEmail: original.relayInboundEmail });
    communityService.findEmailRelayTarget = original.findEmailRelayTarget;
  }
});
