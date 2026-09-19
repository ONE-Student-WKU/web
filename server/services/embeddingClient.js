/**
 * server/services/embeddingClient.js
 * Voyage AI 임베딩 API 클라이언트. Claude(Anthropic)는 자체 임베딩 API가 없어
 * Anthropic이 공식 추천하는 Voyage AI를 사용한다.
 */

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3-lite';
// 시딩 스크립트(문서 수백 개를 한 번에 처리, 몇 분 기다려도 무방)에 맞춰 잡았던 값이라,
// 이 함수를 그대로 쓰는 챗봇 실시간 요청(server/routes/chat.js)엔 안 맞는다 — 429가 나면
// 최악의 경우 6번 × 21초 = 126초를 사용자가 그냥 기다리게 된다. 그래서 기본값은 실시간
// 요청 기준으로 낮게 잡고, 시딩 스크립트 쪽에서만 명시적으로 더 크게 넘긴다.
const DEFAULT_MAX_RETRIES = 2;
// 개별 시도마다의 상한 — Voyage가 응답을 안 주면 이 요청이 무기한 붙잡혀 있게 되므로 둔다.
// 429 사이의 의도된 대기(아래 delayMs)와는 별개다.
const REQUEST_TIMEOUT_MS = 20000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 결제수단 미등록 계정은 3 RPM으로 제한되는데(Voyage 정책), 시딩 스크립트가 문서 단위로
// 연속 호출하다 보면 바로 걸린다. Retry-After 헤더가 있으면 그대로 따르고, 없으면 3 RPM
// 주기(~20초)에 맞춘 백오프로 재시도 — 결제수단을 등록하면 자연히 재시도 없이 통과한다.
async function requestEmbeddings(texts, inputType, maxRetries) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, input: texts, input_type: inputType }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.ok) return res.json();

    if (res.status === 429 && attempt < maxRetries) {
      const retryAfterHeader = Number(res.headers.get('retry-after'));
      const delayMs = retryAfterHeader > 0 ? retryAfterHeader * 1000 : 21000;
      console.warn(`[RATE_LIMIT] Voyage 429 — ${Math.round(delayMs / 1000)}초 대기 후 재시도 (${attempt + 1}/${maxRetries})`);
      await sleep(delayMs);
      continue;
    }

    const errText = await res.text();
    throw new Error(`VOYAGE_API_ERROR: ${res.status} ${errText}`);
  }
}

// input_type: 색인할 문서 청크는 'document', 사용자 질문은 'query'로 넘기면
// Voyage가 비대칭 임베딩으로 검색 품질을 높여준다(생략 시 대칭 임베딩).
//
// maxRetries: 기본값은 챗봇 실시간 요청 기준(사용자를 오래 기다리게 하지 않도록 낮게).
// 시딩 스크립트처럼 기다려도 되는 배치 작업은 더 큰 값을 명시적으로 넘긴다.
async function getEmbeddings(texts, inputType, { maxRetries = DEFAULT_MAX_RETRIES } = {}) {
  const data = await requestEmbeddings(texts, inputType, maxRetries);
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function getEmbedding(text, inputType, options) {
  const [embedding] = await getEmbeddings([text], inputType, options);
  return embedding;
}

module.exports = {
  getEmbedding,
  getEmbeddings,
};
