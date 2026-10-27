const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { getEmbeddings } = require('../services/embeddingClient');

/**
 * server/test/embeddingClient.retry.test.js
 * 시딩에서만 시간 초과·연결 끊김·5xx를 재시도하고(retryTransient), 챗봇 실시간 요청(기본값)은 바로 실패하는지(#412).
 * fetch를 바꿔 끼워 Voyage를 부르지 않는다.
 */

const realFetch = global.fetch;
let calls;

function okResponse(n) {
  return { ok: true, status: 200, json: async () => ({ data: Array.from({ length: n }, (_, index) => ({ index, embedding: [index] })) }) };
}
const timeoutError = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
const statusResponse = (status) => ({ ok: false, status, headers: { get: () => null }, text: async () => `status ${status}` });

function fetchSequence(steps) {
  global.fetch = async () => {
    const step = steps[Math.min(calls, steps.length - 1)];
    calls += 1;
    if (step instanceof Error) throw step;
    return step;
  };
}

beforeEach(() => { calls = 0; });
afterEach(() => { global.fetch = realFetch; });

const SEED = { maxRetries: 3, retryTransient: true, transientDelayMs: 1 };

test('시딩(retryTransient): 시간 초과 두 번 뒤 성공하면 결과를 돌려준다', async () => {
  fetchSequence([timeoutError(), timeoutError(), okResponse(2)]);
  const out = await getEmbeddings(['가', '나'], 'document', SEED);
  assert.deepEqual(out, [[0], [1]]);
  assert.equal(calls, 3);
});

test('시딩(retryTransient): 503·연결 끊김도 재시도한다', async () => {
  fetchSequence([statusResponse(503), Object.assign(new TypeError('fetch failed')), okResponse(1)]);
  const out = await getEmbeddings(['가'], 'document', SEED);
  assert.deepEqual(out, [[0]]);
  assert.equal(calls, 3);
});

test('시딩(retryTransient): 재시도 횟수를 넘기면 마지막 오류로 실패한다', async () => {
  fetchSequence([timeoutError()]);
  await assert.rejects(getEmbeddings(['가'], 'document', SEED), { name: 'TimeoutError' });
  assert.equal(calls, 4, '처음 1번 + 재시도 3번');
});

test('챗봇 실시간 요청(기본값): 시간 초과·5xx는 재시도하지 않고 바로 실패한다', async () => {
  fetchSequence([timeoutError(), okResponse(1)]);
  await assert.rejects(getEmbeddings(['가'], 'query'), { name: 'TimeoutError' });
  assert.equal(calls, 1);

  calls = 0;
  fetchSequence([statusResponse(503), okResponse(1)]);
  await assert.rejects(getEmbeddings(['가'], 'query'), /VOYAGE_API_ERROR: 503/);
  assert.equal(calls, 1);
});

test('400 같은 요청 오류는 시딩에서도 재시도하지 않는다', async () => {
  fetchSequence([statusResponse(400), okResponse(1)]);
  await assert.rejects(getEmbeddings(['가'], 'document', SEED), /VOYAGE_API_ERROR: 400/);
  assert.equal(calls, 1);
});
