const { test } = require('node:test');
const assert = require('node:assert/strict');
const { notifyAdmin, buildAdminAlertMessage } = require('../services/adminAlertService');

/**
 * server/test/adminAlert.test.js
 * 관리자 Discord 알림(2026-10-24) — 건수와 링크만 보내고, 실패해도 throw하지 않는다.
 */

const PENDING = { reports: 1, inquiries: 3, posts: 2, total: 6 };
const URL = 'https://discord.example/api/webhooks/1/test';

function fakeFetch(response = { ok: true, status: 204 }) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (response instanceof Error) throw response;
    return response;
  };
  fn.calls = calls;
  return fn;
}

test('종류별 문구와 그 종류의 미처리 건수, 사이트 링크를 넣는다', () => {
  const msg = buildAdminAlertMessage('inquiry', PENDING, 'https://one.example');
  assert.equal(msg.content, '새 문의가 들어왔어요 · 미처리 3건\n관리자 페이지에서 보기: <https://one.example>');
  assert.equal(msg.username, 'ONE 알림');
  assert.deepEqual(msg.allowed_mentions, { parse: [] });
  assert.match(buildAdminAlertMessage('report', PENDING, null).content, /^새 신고가 접수됐어요 · 미처리 1건$/);
  assert.match(buildAdminAlertMessage('post', PENDING, null).content, /^승인을 기다리는 새 글이 있어요 · 미처리 2건$/);
});

test('건수를 못 구하면 건수 없이 보낸다', () => {
  assert.equal(buildAdminAlertMessage('inquiry', null, null).content, '새 문의가 들어왔어요');
});

test('모르는 종류는 메시지를 만들지 않는다', () => {
  assert.equal(buildAdminAlertMessage('unknown', PENDING, null), null);
});

test('웹훅 주소가 없으면 보내지 않는다', async () => {
  const fetchImpl = fakeFetch();
  assert.equal(await notifyAdmin('inquiry', { fetchImpl, webhookUrl: '', getPending: async () => PENDING }), false);
  assert.equal(fetchImpl.calls.length, 0);
});

test('웹훅 주소로 JSON POST를 보낸다', async () => {
  const fetchImpl = fakeFetch();
  const ok = await notifyAdmin('report', { fetchImpl, webhookUrl: URL, getPending: async () => PENDING });
  assert.equal(ok, true);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, URL);
  assert.equal(fetchImpl.calls[0].init.method, 'POST');
  assert.match(fetchImpl.calls[0].body.content, /^새 신고가 접수됐어요 · 미처리 1건/);
});

test('건수 조회가 실패해도 알림은 보낸다', async () => {
  const fetchImpl = fakeFetch();
  const getPending = async () => {
    throw new Error('db down');
  };
  assert.equal(await notifyAdmin('inquiry', { fetchImpl, webhookUrl: URL, getPending }), true);
  assert.match(fetchImpl.calls[0].body.content, /^새 문의가 들어왔어요(\n|$)/);
});

test('전송이 실패하거나 Discord가 에러를 돌려줘도 throw하지 않는다', async () => {
  const getPending = async () => PENDING;
  assert.equal(await notifyAdmin('post', { fetchImpl: fakeFetch(new Error('network')), webhookUrl: URL, getPending }), false);
  assert.equal(await notifyAdmin('post', { fetchImpl: fakeFetch({ ok: false, status: 429 }), webhookUrl: URL, getPending }), false);
});
