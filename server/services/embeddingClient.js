/**
 * server/services/embeddingClient.js
 * Voyage AI 임베딩 API 클라이언트. Claude(Anthropic)는 자체 임베딩 API가 없어
 * Anthropic이 공식 추천하는 Voyage AI를 사용한다.
 */

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3-lite';
const MAX_RETRIES = 6;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 결제수단 미등록 계정은 3 RPM으로 제한되는데(Voyage 정책), 시딩 스크립트가 문서 단위로
// 연속 호출하다 보면 바로 걸린다. Retry-After 헤더가 있으면 그대로 따르고, 없으면 3 RPM
// 주기(~20초)에 맞춘 백오프로 재시도 — 결제수단을 등록하면 자연히 재시도 없이 통과한다.
async function requestEmbeddings(texts, inputType) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, input: texts, input_type: inputType }),
    });

    if (res.ok) return res.json();

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfterHeader = Number(res.headers.get('retry-after'));
      const delayMs = retryAfterHeader > 0 ? retryAfterHeader * 1000 : 21000;
      console.warn(`[RATE_LIMIT] Voyage 429 — ${Math.round(delayMs / 1000)}초 대기 후 재시도 (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(delayMs);
      continue;
    }

    const errText = await res.text();
    throw new Error(`VOYAGE_API_ERROR: ${res.status} ${errText}`);
  }
}

// input_type: 색인할 문서 청크는 'document', 사용자 질문은 'query'로 넘기면
// Voyage가 비대칭 임베딩으로 검색 품질을 높여준다(생략 시 대칭 임베딩).
async function getEmbeddings(texts, inputType) {
  const data = await requestEmbeddings(texts, inputType);
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function getEmbedding(text, inputType) {
  const [embedding] = await getEmbeddings([text], inputType);
  return embedding;
}

module.exports = {
  getEmbedding,
  getEmbeddings,
};
