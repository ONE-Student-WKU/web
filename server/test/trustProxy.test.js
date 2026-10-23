const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { TRUST_PROXY_HOPS } = require('../middleware/security');

/**
 * server/test/trustProxy.test.js
 * 운영 요청은 학생 → Vercel → Railway 엣지 → 서버로 와서 X-Forwarded-For가 "학생 IP, Vercel IP"가 된다.
 * app.js와 같은 trust proxy 값으로 req.ip가 학생 IP로 읽히는지 확인한다(예전 값 1에서는 Vercel IP로 읽혀
 * IP 기준 제한이 전체 학생 합계로 묶였다). DB 없이 같은 설정의 작은 앱만 띄운다.
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

test('Vercel을 거친 요청은 학생 IP를 req.ip로 읽는다', async () => {
  const { ip } = await getIp({ 'X-Forwarded-For': '203.0.113.7, 76.76.21.21' });
  assert.equal(ip, '203.0.113.7');
});

test('학생마다 다른 IP로 읽혀 IP 기준 제한이 서로 묶이지 않는다', async () => {
  const a = await getIp({ 'X-Forwarded-For': '203.0.113.7, 76.76.21.21' });
  const b = await getIp({ 'X-Forwarded-For': '198.51.100.9, 76.76.21.21' });
  assert.notEqual(a.ip, b.ip);
});

test('Railway에 직접 온 요청(앞 단계 하나)은 그 접속 IP를 읽는다', async () => {
  const { ip } = await getIp({ 'X-Forwarded-For': '198.51.100.9' });
  assert.equal(ip, '198.51.100.9');
});

test('프록시가 넘긴 https 프로토콜을 믿는다(세션 쿠키 secure 판정)', async () => {
  const { protocol } = await getIp({ 'X-Forwarded-For': '203.0.113.7, 76.76.21.21', 'X-Forwarded-Proto': 'https' });
  assert.equal(protocol, 'https');
});
