#!/usr/bin/env node
/**
 * scripts/ci/seed-regulations-stub.js
 * CI(테스트용 임시 DB)에서 `seed:regulations`를 시크릿 없이 돌리기 위한 래퍼.
 *
 * 왜 필요한가: 실제 `seed:regulations`는 Voyage 임베딩 API(VOYAGE_API_KEY — 시크릿·비용)를 호출한다. 서버 테스트는 임베딩/AI 호출을
 * mock하고 "규정 청크가 DB에 있다는 사실"만 필요로 하므로(chat.route.yearContext.test 등), 임베딩만 결정적인 가짜 벡터로 바꿔 같은 시드
 * 스크립트를 그대로 실행한다. 이렇게 만든 청크의 벡터는 **실제 검색 품질과 무관**하다 — 챗봇 품질 확인에 쓰면 안 된다.
 *
 * 안전장치: DB_HOST가 localhost/127.0.0.1이 아니면 실행을 거부한다(운영 DB에 가짜 임베딩이 들어가는 사고 방지).
 */
'use strict';

const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const host = process.env.DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`[seed-regulations-stub] DB_HOST=${host} — 로컬/CI DB에서만 실행할 수 있어요. 중단합니다.`);
  process.exit(1);
}

const serverDir = path.resolve(__dirname, '..', '..', 'server');
const embeddingClient = require(path.join(serverDir, 'services', 'embeddingClient'));

// 텍스트 길이로 8차원 one-hot을 만든다(같은 입력 → 같은 벡터, 외부 호출 없음).
embeddingClient.getEmbeddings = async (texts) => texts.map((t, i) => {
  const v = new Array(8).fill(0);
  v[(t.length + i) % 8] = 1;
  return v;
});

process.chdir(serverDir);
require(path.join(serverDir, 'scripts', 'seedRegulations.js'));
