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

const { buildRelayMessage, sanitizeRelayHtml, relayInboundEmail, RELAY_LIMITS } = emailRelayService;

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

test('sanitizeRelayHtml: 스크립트/이벤트 속성/숨김 요소/1×1 이미지는 지우고, 외부 이미지는 안내 문구로 바꾸고, 링크와 cid 이미지는 남긴다', () => {
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
  assert.ok(!out.includes('img.example'), '외부 이미지는 크기와 상관없이 주소가 남으면 안 됨');
  assert.ok(out.includes('외부 이미지는 개인정보 보호를 위해 표시되지 않습니다'));
  assert.ok(out.includes('src="cid:ii_abc123"'));
  assert.ok(out.includes('href="https://example.com"'));
  assert.ok(!out.includes('javascript:'));
});

test('sanitizeRelayHtml: style은 안전한 속성만 남기고 외부 요청(url)·화면 덮기(position)는 걸러낸다', () => {
  const cases = [
    '<div style="background:url(https://evil.example/t.gif)">배경</div>',
    '<div style="background-image:url(&quot;https://evil.example/t.gif&quot;)">배경2</div>',
    '<ul style="list-style-image:url(https://evil.example/l.gif)"><li>목록</li></ul>',
    '<div style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999">위장</div>',
    '<div style="color:url(https://evil.example/c)">색</div>',
    '<table style="background:#fff url(https://evil.example/t.gif)"><tr><td>표</td></tr></table>',
  ];
  for (const html of cases) {
    const out = sanitizeRelayHtml(html);
    assert.ok(!out.includes('evil.example'), `외부 주소가 남음: ${out}`);
    assert.ok(!/url\(|position|z-index/i.test(out), `위험한 style이 남음: ${out}`);
  }
  assert.ok(sanitizeRelayHtml(cases[3]).includes('위장'), 'style만 걸러지고 글은 남아야 함');

  const kept = sanitizeRelayHtml(
    '<p style="color: rgb(34, 34, 34); background-color:#ffeeaa; text-align:center; font-weight:bold; font-size:14px; font-family: Arial, 맑은 고딕, sans-serif">서식</p>'
  );
  assert.ok(kept.includes('color:rgb(34, 34, 34)'));
  assert.ok(kept.includes('background-color:#ffeeaa'));
  assert.ok(kept.includes('text-align:center'));
  assert.ok(kept.includes('font-weight:bold'));
  assert.ok(kept.includes('font-size:14px'));
  assert.ok(kept.includes('font-family:Arial, 맑은 고딕, sans-serif'));
});

// allowedStyles를 넣으면 exclusiveFilter가 걸러진 뒤의 style을 보게 돼, 숨김 요소가 오히려 보이게 되는
// 함정이 있다(리뷰 #247에서 실측). 숨김 판정이 원본 속성 기준으로 이뤄지는지 고정한다.
test('sanitizeRelayHtml: 숨김 요소는 style 허용 목록과 상관없이 내용째 제거된다', () => {
  const hidden = [
    '<div style="display:none">숨김1</div>',
    '<div style="display: none !important">숨김2</div>',
    '<div style="DISPLAY:NONE">숨김3</div>',
    '<div style="color:red; display:none">숨김4</div>',
    '<span style="visibility:hidden">숨김5</span>',
    '<div style="mso-hide:all">숨김6</div>',
    '<p hidden>숨김7</p>',
    '<table style="display:none"><tr><td>숨김8<img src="cid:x"></td></tr></table>',
  ];
  for (const html of hidden) {
    const out = sanitizeRelayHtml(`<p>보임</p>${html}`);
    assert.ok(!out.includes('숨김'), `숨김 요소가 남음: ${out}`);
    assert.ok(out.includes('보임'));
  }
  assert.equal(sanitizeRelayHtml('<img src="cid:pixel" style="width:1px;height:1px">'), '', 'style로 크기를 준 1×1 cid 이미지도 제거');
  assert.ok(!sanitizeRelayHtml('<p>a</p>').includes('data-relay'), '내부 표시 속성은 출력에 남지 않음');
});

test('sanitizeRelayHtml: 외부 이미지는 크기·형식과 상관없이 모두 막고 cid 이미지만 남긴다', () => {
  const external = [
    '<img src="https://img.example/a.png" width="600" height="400">',
    '<img src="https://img.example/b.png">',
    '<img src="https://img.example/c.png" width="2" height="2">',
    '<img src="//img.example/d.png">',
    '<img src="http://img.example/e.png" width="1">',
    '<img src="HTTPS://img.example/f.png">',
  ];
  for (const html of external) {
    const out = sanitizeRelayHtml(html);
    assert.ok(!out.includes('img.example'), `외부 이미지 주소가 남음: ${out}`);
    assert.ok(!/<img/i.test(out), `빈 img 태그가 남음: ${out}`);
  }
  // 1×1 같은 추적 이미지는 안내 문구 없이 조용히 사라지고, 일반 외부 이미지만 안내 문구가 붙는다.
  assert.equal(sanitizeRelayHtml('<img src="https://t.example/p.gif" width="1" height="1">'), '');
  assert.ok(sanitizeRelayHtml(external[0]).includes('외부 이미지는 개인정보 보호를 위해 표시되지 않습니다'));

  const srcset = sanitizeRelayHtml('<img src="cid:ok1" srcset="https://img.example/2x.png 2x" alt="사진">');
  assert.ok(srcset.includes('src="cid:ok1"'));
  assert.ok(!srcset.includes('srcset') && !srcset.includes('img.example'));
  assert.ok(sanitizeRelayHtml('<img src="CID:Upper@host">').includes('src="CID:Upper@host"'));
  assert.equal(sanitizeRelayHtml('<img>'), '', 'src 없는 img는 제거');
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

test('buildRelayMessage: 제목의 개행·제어문자는 공백으로 바꿔 헤더 주입을 막고, 너무 긴 제목은 자른다', () => {
  assert.equal(buildRelayMessage({ subject: 'a\r\nBcc: attacker@example.com', text: 't' }).subject, 'a Bcc: attacker@example.com');
  assert.equal(buildRelayMessage({ subject: 'x\n\n\ny\tz\u0000w', text: 't' }).subject, 'x y z w');
  assert.equal(buildRelayMessage({ subject: '\r\n', text: 't' }).subject, '(제목 없음)');
  const long = buildRelayMessage({ subject: '가'.repeat(500), text: 't' }).subject;
  assert.equal(long, `${'가'.repeat(RELAY_LIMITS.maxSubjectLength)}…`);
});

test('buildRelayMessage: 전달 안내(notices)는 HTML 안내 상자와 텍스트 본문 모두에 이스케이프해 넣는다', () => {
  const msg = buildRelayMessage({ subject: 's', text: '본문', html: null }, { notices: ['첨부 <1개> 누락'] });
  assert.ok(msg.html.includes('첨부 &lt;1개&gt; 누락'));
  assert.ok(msg.text.includes('※ 첨부 <1개> 누락'));
  assert.ok(!buildRelayMessage({ subject: 's', text: '본문', html: null }).text.includes('※'), '안내가 없으면 상자도 없음');
});

test('buildRelayMessage: 한도를 넘는 큰 HTML 본문은 서식 없이 텍스트로 보내고 빠르게 끝난다', () => {
  const chunk = '<div style="color:#333"><p>큰 본문 <b>테스트</b></p><img src="https://img.example/x.png"></div>';
  const html = chunk.repeat(Math.ceil((RELAY_LIMITS.maxHtmlLength * 5) / chunk.length)); // 한도의 5배
  const started = Date.now();
  const msg = buildRelayMessage({ subject: 's', text: null, html });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 3000, `너무 오래 걸림: ${elapsed}ms`);
  assert.ok(msg.html.includes('원본 메일 본문이 너무 커서 서식 없이 텍스트로만 전달되었습니다.'));
  assert.ok(msg.html.includes('white-space:pre-wrap'), '서식 없는 텍스트 양식으로 들어감');
  assert.ok(!msg.html.includes('img.example'));
  assert.ok(msg.text.includes('큰 본문 테스트'));
  assert.ok(msg.html.length < RELAY_LIMITS.maxHtmlLength * 2, `결과 HTML이 너무 큼: ${msg.html.length}`);

  const hugeText = buildRelayMessage({ subject: 's', text: 'a'.repeat(RELAY_LIMITS.maxTextLength + 10), html: null });
  assert.ok(hugeText.text.includes('원본 메일 본문이 너무 길어 앞부분만 전달되었습니다.'));
  assert.ok(hugeText.text.length < RELAY_LIMITS.maxTextLength + 1000);
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

// 첨부 목록 항목 n개를 만든다(size는 바이트). 가짜 fetch는 URL에 적힌 크기만큼 바이트를 돌려준다.
function attachmentItems(sizes) {
  return sizes.map((size, i) => ({
    id: `a${i}`,
    filename: `f${i}.bin`,
    size,
    content_type: 'application/octet-stream',
    content_disposition: 'attachment',
    download_url: `https://dl/a${i}?size=${size}`,
  }));
}

function sizedFetch() {
  const state = { calls: [], active: 0, maxActive: 0, signals: [] };
  const fetchImpl = async (url, opts = {}) => {
    state.calls.push(url);
    state.signals.push(opts.signal);
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    await new Promise((r) => setTimeout(r, 5));
    state.active -= 1;
    const size = Number(new URL(url).searchParams.get('size'));
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(size) };
  };
  return { fetchImpl, state };
}

const MB = 1024 * 1024;

test('relayInboundEmail: 첨부는 하나씩 순서대로 내려받고, 각 요청에 타임아웃 signal을 건다', async () => {
  const items = attachmentItems([100, 200, 300]);
  const { client, calls } = fakeClient({ received: { subject: 's', text: 't', html: null, attachments: items }, attachments: items });
  const { fetchImpl, state } = sizedFetch();
  await relayInboundEmail({ emailId: 'em_seq', to: 't@example.com', from: 'p@relay.example' }, { client, fetchImpl });

  assert.equal(state.maxActive, 1, '동시에 둘 이상 내려받으면 안 됨');
  assert.deepEqual(state.calls, items.map((a) => a.download_url));
  assert.ok(state.signals.every((s) => s instanceof AbortSignal));
  const [payload] = calls.send[0];
  assert.equal(payload.attachments.length, 3);
  assert.ok(!payload.text.includes('※'), '한도 안이면 안내 없음');
});

test('relayInboundEmail: 첨부 개수 한도를 넘는 첨부는 내려받지 않고, 본문에 빠진 개수를 안내한다', async () => {
  const items = attachmentItems(Array(RELAY_LIMITS.maxAttachments + 1).fill(10));
  const { client, calls } = fakeClient({ received: { subject: 's', text: 't', html: '<p>본문</p>', attachments: items }, attachments: items });
  const { fetchImpl, state } = sizedFetch();
  await relayInboundEmail({ emailId: 'em_cnt', to: 't@example.com', from: 'p@relay.example' }, { client, fetchImpl });

  assert.equal(state.calls.length, RELAY_LIMITS.maxAttachments, '한도를 넘는 첨부는 다운로드 자체를 안 함');
  const [payload] = calls.send[0];
  assert.equal(payload.attachments.length, RELAY_LIMITS.maxAttachments);
  assert.ok(payload.html.includes('첨부파일 1개는 전달 한도'));
  assert.ok(payload.text.includes('첨부파일 1개는 전달 한도'));
  assert.ok(payload.html.includes('본문'));
});

test('relayInboundEmail: 합계 크기 한도는 경계값까지 허용하고, 넘는 첨부만 건너뛴다', async () => {
  const total = RELAY_LIMITS.maxAttachmentTotalBytes;
  // 정확히 한도: 모두 전달
  const exact = attachmentItems([total - 1 * MB, 1 * MB]);
  const ok = fakeClient({ received: { subject: 's', text: 't', html: null, attachments: exact }, attachments: exact });
  await relayInboundEmail({ emailId: 'em_exact', to: 't@example.com', from: 'p@relay.example' }, { client: ok.client, fetchImpl: sizedFetch().fetchImpl });
  assert.equal(ok.calls.send[0][0].attachments.length, 2);
  assert.ok(!ok.calls.send[0][0].text.includes('※'));

  // 1바이트 초과: 두 번째(큰 것)는 건너뛰고, 그 뒤 작은 첨부는 여유가 있으니 전달
  const over = attachmentItems([total - 1 * MB, 1 * MB + 1, 100]);
  const big = fakeClient({ received: { subject: 's', text: 't', html: null, attachments: over }, attachments: over });
  const { fetchImpl, state } = sizedFetch();
  await relayInboundEmail({ emailId: 'em_over', to: 't@example.com', from: 'p@relay.example' }, { client: big.client, fetchImpl });
  assert.deepEqual(state.calls, [over[0].download_url, over[2].download_url], '한도를 넘는 첨부는 다운로드하지 않음');
  const [payload] = big.calls.send[0];
  assert.deepEqual(payload.attachments.map((a) => a.filename), ['f0.bin', 'f2.bin']);
  assert.ok(payload.text.includes('첨부파일 1개는 전달 한도'));
});

test('relayInboundEmail: 목록의 size가 실제보다 작아도, 내려받은 실제 크기로 한도를 다시 확인한다', async () => {
  const items = attachmentItems([5 * MB, 5 * MB]);
  items[1].size = 10; // 목록에는 작게 적혀 있지만
  items[1].download_url = `https://dl/a1?size=${6 * MB}`; // 실제로는 6MB
  const { client, calls } = fakeClient({ received: { subject: 's', text: 't', html: null, attachments: items }, attachments: items });
  await relayInboundEmail({ emailId: 'em_lie', to: 't@example.com', from: 'p@relay.example' }, { client, fetchImpl: sizedFetch().fetchImpl });

  const [payload] = calls.send[0];
  assert.equal(payload.attachments.length, 1);
  assert.ok(payload.text.includes('첨부파일 1개는 전달 한도'));
});

test('relayInboundEmail: 첨부 다운로드 타임아웃은 첨부를 빼고 보내지 않고 예외를 올린다(웹훅 재시도에 맡김)', async () => {
  const items = attachmentItems([100]);
  const { client, calls } = fakeClient({ received: { subject: 's', text: 't', html: null, attachments: items }, attachments: items });
  const timingOut = async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  await assert.rejects(
    relayInboundEmail({ emailId: 'em_to', to: 't@example.com', from: 'p@relay.example' }, { client, fetchImpl: timingOut }),
    { name: 'TimeoutError' }
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
