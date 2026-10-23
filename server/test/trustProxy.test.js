const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { TRUST_PROXY_HOPS } = require('../middleware/security');

/**
 * server/test/trustProxy.test.js
 * Railway 엣지는 X-Forwarded-For를 자기에게 접속한 IP 하나로 덮어쓴다(2026-10-23 운영 실측). app.js와 같은 trust proxy 값으로
 * req.ip가 그 값을 읽는지, 그리고 혹시 여러 값이 이어진 헤더가 오더라도 클라이언트가 지어낸 앞쪽 값을 믿지 않는지 확인한다.
 * DB 없이 같은 설정의 작은 앱만 띄운다.
 */

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.set('trust proxy', TRUST_PROXY_HOPS);
  app.get('/ip', (req, res) => res.json({ ip: req.ip, protocol: req.protocol }));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function getIp(headers) {
  const res = await fetch(`${baseUrl}/ip`, { headers });
  return res.json();
}

test('Railway 엣지가 넘긴 접속 IP를 req.ip로 읽는다', async () => {
  // Vercel을 거친 요청이면 이 값은 Vercel 출구 IP, Railway로 직접 왔으면 실제 접속 IP다.
  const { ip } = await getIp({ 'X-Forwarded-For': '76.76.21.21' });
  assert.equal(ip, '76.76.21.21');
});

test('여러 값이 이어진 헤더가 와도 클라이언트가 지어낸 앞쪽 값은 믿지 않는다', async () => {
  const { ip } = await getIp({ 'X-Forwarded-For': '198.51.100.77, 203.0.113.7' });
  assert.equal(ip, '203.0.113.7');
});

test('프록시가 넘긴 https 프로토콜을 믿는다(세션 쿠키 secure 판정)', async () => {
  const { protocol } = await getIp({ 'X-Forwarded-For': '76.76.21.21', 'X-Forwarded-Proto': 'https' });
  assert.equal(protocol, 'https');
});
