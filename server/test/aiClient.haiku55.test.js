const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const aiClient = require('../services/aiClient');

/**
 * server/test/aiClient.haiku55.test.js
 * Claude Haiku 5.5 전환(D-91): 요청 모양(모델·effort·max_tokens)과 응답 읽기(thinking 블록 건너뛰기, 거절 처리).
 * 실제 API는 부르지 않는다 — fetch를 가로채 요청을 보고 응답을 흉내 낸다.
 */

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function mockFetch(response, requests = []) {
  global.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => response, text: async () => '' };
  };
  return requests;
}

const TEXT_REPLY = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"label":"OK"}' }] };

test('모든 호출이 Haiku 5.5에 effort low로 가고, 생각이 들어갈 자리만큼 max_tokens를 둔다', async () => {
  const requests = mockFetch(TEXT_REPLY);
  await aiClient.classifyForModeration('system', 'content');
  await aiClient.draftInquiryReply('system', 'content');
  await aiClient.analyzeQuestion('졸업학점 몇이야');
  await aiClient.getAIChatResponse('졸업학점 몇이야', [], []);
  assert.equal(requests.length, 4);
  for (const body of requests) {
    assert.equal(body.model, 'claude-haiku-5-5');
    assert.deepEqual(body.output_config, { effort: 'low' });
    assert.ok(body.max_tokens >= 1024, `max_tokens ${body.max_tokens}`);
    // Haiku 5.5에서 400이 나는 값은 보내지 않는다(샘플링 파라미터, 직접 정한 생각 예산)
    for (const key of ['temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(key in body), key);
  }
});

test('응답 앞에 thinking 블록이 붙어도 text 블록만 답으로 쓴다', async () => {
  mockFetch({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: '답변' }] });
  assert.equal(await aiClient.draftInquiryReply('system', 'content'), '답변');
  assert.equal(await aiClient.getAIChatResponse('질문', [], []), '답변');
});

test('안전 분류기가 거절하면(stop_reason refusal) 빈 답 대신 오류를 던진다 — 호출부의 실패 경로를 탄다', async () => {
  mockFetch({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms' }, content: [] });
  await assert.rejects(() => aiClient.classifyForModeration('system', 'content'), /ANTHROPIC_REFUSAL: general_harms/);
  await assert.rejects(() => aiClient.getAIChatResponse('질문', [], []), /ANTHROPIC_REFUSAL/);
  // 질문 분석은 실패해도 원문 그대로 검색하는 폴백이 있다
  assert.deepEqual(await aiClient.analyzeQuestion('원문 질문'), { searchQuery: '원문 질문', intent: 'DEFAULT' });
});
