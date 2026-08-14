const path = require('path');
// server/scripts에서 실행돼도 항상 리포지토리 루트의 .env를 찾도록 절대경로로 지정.
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fs = require('fs');
const pool = require('../db');
const embeddingClient = require('../services/embeddingClient');

/**
 * server/scripts/seedRegulations.js
 * db/regulations/*.md(정리 문서)와 db/regulations/_source/*.txt(학칙 원문)를
 * 청크로 분할해 임베딩(Voyage AI)을 생성하고 regulation_documents/regulation_chunks에 저장한다.
 * 근거: db/schema.sql 7번 섹션 (하이브리드 소스 전략 / 청크 분할 기준)
 *
 * 임베딩 API 호출에 비용이 들기 때문에, 이미 임베딩된 문서(title+source_type 동일)는
 * 기본적으로 건너뛴다. 원문이 바뀌어 재임베딩이 필요하면 --force로 실행.
 */

const REGULATIONS_ROOT = path.resolve(__dirname, '..', '..', 'db', 'regulations');
const SOURCE_DIR = path.join(REGULATIONS_ROOT, '_source');
const FORCE = process.argv.includes('--force');

// 원문(_source/*.txt) 파일명 -> 문서 제목/카테고리 매핑. 새 원문 파일이 추가되면 여기 등록.
const VERBATIM_DOCS = {
  '원광대학교_학칙_전문.txt': { title: '원광대학교 학칙 전문', category: '학칙' },
  '원광대학교_학칙시행규칙_전문.txt': { title: '원광대학교 학칙시행규칙 전문', category: '학칙시행규칙' },
  '원광대학교_수업관리규정_전문.txt': { title: '원광대학교 수업관리규정 전문', category: '수업관리규정' },
};
const VERBATIM_EFFECTIVE_DATE = '2026-06-26'; // db/regulations/_source/ 파일명의 개정일 기준(2026.06.26 최신본)

function listCuratedFiles() {
  const files = [];
  for (const entry of fs.readdirSync(REGULATIONS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '_source') continue;
    const dirPath = path.join(REGULATIONS_ROOT, entry.name);
    for (const file of fs.readdirSync(dirPath)) {
      if (file.endsWith('.md')) files.push({ category: entry.name, filePath: path.join(dirPath, file) });
    }
  }
  return files;
}

// 정리 문서: "###"(또는 "##") 소제목 단위로 결정론적 분할. H1 제목은 문서 제목으로만 쓰고 청크에서 제외.
function chunkCuratedMarkdown(content) {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : null;
  const sourceUrlMatch = content.match(/^출처:\s*(https?:\/\/\S+)/m);

  const body = content.replace(/^#\s+.+\n/, '');
  const headingRe = /^#{2,3}\s+.+$/gm;
  const matches = [...body.matchAll(headingRe)];

  const chunks = [];
  if (matches.length === 0) {
    if (body.trim()) chunks.push(body.trim());
  } else {
    const preamble = body.slice(0, matches[0].index).trim();
    if (preamble) chunks.push(preamble);

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
      const chunk = body.slice(start, end).trim();
      if (chunk) chunks.push(chunk);
    }
  }

  return { title, sourceUrl: sourceUrlMatch ? sourceUrlMatch[1] : null, chunks };
}

// 원문: "제N조(...)" 패턴 기준 조 단위로 분할. 첫 조 이전의 장 제목/개정이력은 전문(前文) 청크로 별도 보존.
// "【별표 N】"도 별도 경계로 잡는다 — 안 그러면 부칙 마지막 조(시행일)에 뒤따르는 별표 부속표
// 전체(학과별 입학정원 등, 수만 자)가 조문 하나에 통째로 붙어버려 청크 하나가 지나치게 커진다.
function chunkVerbatimText(content) {
  const articleRe = /^(?:제\d+조(?:\([^)]*\))?|【별표\s*\d+】)/gm;
  const matches = [...content.matchAll(articleRe)];

  const chunks = [];
  if (matches.length === 0) {
    if (content.trim()) chunks.push(content.trim());
    return chunks;
  }

  const preamble = content.slice(0, matches[0].index).trim();
  if (preamble) chunks.push(preamble);

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const chunk = content.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

async function findExistingDocument(title, sourceType) {
  const [rows] = await pool.query(
    'SELECT id FROM regulation_documents WHERE title = ? AND source_type = ?',
    [title, sourceType]
  );
  return rows[0] || null;
}

// 결제수단 미등록 계정은 10K TPM(분당 토큰)까지만 허용되는데, 청크 많은 문서를 통째로
// 한 요청에 넣으면 그 요청 자체가 한도를 넘어버려 재시도해도 절대 성공하지 못한다
// (분당 한도인데 요청 하나가 이미 한도 초과라 몇 분을 기다려도 항상 초과 상태).
// 문자 수 기준으로 안전하게 나눠 여러 요청으로 보낸다 — 한글은 토큰당 대략 1.5~2자
// 수준이라 6000자면 넉넉히 10K 토큰 아래로 들어옴.
const MAX_CHARS_PER_BATCH = 6000;

function splitIntoBatches(chunks) {
  const batches = [];
  let current = [];
  let currentLen = 0;

  for (const chunk of chunks) {
    if (current.length > 0 && currentLen + chunk.length > MAX_CHARS_PER_BATCH) {
      batches.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(chunk);
    currentLen += chunk.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function insertDocumentWithChunks({ title, category, sourceType, sourceUrl, effectiveDate, chunks }) {
  // 임베딩을 전부 성공시킨 뒤에야 DB에 쓴다 — 문서 행을 먼저 넣어두면, 배치 중간에 실패했을 때
  // 청크 없는 빈 문서만 남고 재실행 시 findExistingDocument가 "이미 있음"으로 건너뛰어버려서
  // 영영 재시도가 안 되는 문제가 생긴다.
  const embeddings = [];
  for (const batch of splitIntoBatches(chunks)) {
    const batchEmbeddings = await embeddingClient.getEmbeddings(batch, 'document');
    embeddings.push(...batchEmbeddings);
  }

  const [result] = await pool.query(
    'INSERT INTO regulation_documents (title, category, source_type, source_url, effective_date) VALUES (?, ?, ?, ?, ?)',
    [title, category, sourceType, sourceUrl ?? null, effectiveDate ?? null]
  );
  const documentId = result.insertId;

  for (let i = 0; i < chunks.length; i++) {
    await pool.query(
      'INSERT INTO regulation_chunks (document_id, chunk_index, content, embedding) VALUES (?, ?, ?, ?)',
      [documentId, i, chunks[i], JSON.stringify(embeddings[i])]
    );
  }
  return chunks.length;
}

async function seedDocument({ title, category, sourceType, sourceUrl, effectiveDate, chunks }) {
  if (chunks.length === 0) {
    console.warn(`[SKIP] ${title}: 청크가 비어있음`);
    return 0;
  }

  const existing = await findExistingDocument(title, sourceType);
  if (existing && !FORCE) {
    console.log(`[SKIP] ${title} (이미 임베딩됨, 재실행하려면 --force)`);
    return 0;
  }
  if (existing && FORCE) {
    await pool.query('DELETE FROM regulation_documents WHERE id = ?', [existing.id]); // chunks는 CASCADE로 같이 삭제
  }

  const count = await insertDocumentWithChunks({ title, category, sourceType, sourceUrl, effectiveDate, chunks });
  console.log(`[OK] ${title}: ${count}개 청크`);
  return count;
}

async function seedCuratedDocs() {
  let total = 0;
  for (const { category, filePath } of listCuratedFiles()) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { title, sourceUrl, chunks } = chunkCuratedMarkdown(content);
    total += await seedDocument({
      title: title || path.basename(filePath, '.md'),
      category,
      sourceType: 'CURATED',
      sourceUrl,
      effectiveDate: null,
      chunks,
    });
  }
  return total;
}

async function seedVerbatimDocs() {
  let total = 0;
  const files = fs.readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.txt'));

  for (const file of files) {
    const meta = VERBATIM_DOCS[file];
    if (!meta) {
      console.warn(`[SKIP] ${file}: VERBATIM_DOCS에 제목/카테고리 매핑이 없음`);
      continue;
    }
    const content = fs.readFileSync(path.join(SOURCE_DIR, file), 'utf-8');
    const chunks = chunkVerbatimText(content);
    total += await seedDocument({
      title: meta.title,
      category: meta.category,
      sourceType: 'VERBATIM',
      sourceUrl: null,
      effectiveDate: VERBATIM_EFFECTIVE_DATE,
      chunks,
    });
  }
  return total;
}

async function run() {
  try {
    const curatedCount = await seedCuratedDocs();
    const verbatimCount = await seedVerbatimDocs();
    console.log(`규정 임베딩 시딩 완료 (정리 문서 ${curatedCount}청크, 원문 ${verbatimCount}청크)`);
  } catch (err) {
    console.error('규정 시딩 실패:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
