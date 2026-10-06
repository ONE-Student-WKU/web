const pool = require('../db');

/**
 * server/services/regulationService.js
 * 학칙·규정 청크(RAG 검색) + 챗봇 대화(chat_conversations/chat_messages) DB 접근 계층.
 */

const TOP_K = 5;
// 이 밑으로는 "관련 없음"으로 간주 — 실제 규정 코퍼스로 측정한 값: 관련 있는 질문은 최고
// 유사도가 보통 0.5~0.64, 완전 무관한 질문("점심 메뉴 추천해줘" 등)은 0.29를 못 넘었음
// (문서 제목/출처 같은 짧은 전문 청크가 일반적인 문장과 얕게 겹쳐서 0.25~0.3대 스코어가
// 남는 걸 확인함). 그 갭 사이인 0.4를 컷오프로 잡아 근거 문서를 못 찾았을 때 AI 호출 없이
// 바로 안내 문구를 반환한다.
const MIN_SIMILARITY = 0.4;

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// regulation_chunks는 관리자가 학칙을 재시딩하기 전까진 안 바뀌는 데이터인데, 매 챗봇
// 메시지마다 통째로 다시 읽어오고 있었다. 재시딩 이벤트를 별도로 감지하는 장치는 없으니
// TTL로 무효화한다 — 재시딩 후 최악의 경우에도 이 시간 안엔 최신 데이터로 갱신된다.
const CHUNK_CACHE_TTL_MS = 5 * 60 * 1000;
let chunkCache = { rows: null, expiresAt: 0 };

async function getAllChunkRows() {
  if (chunkCache.rows && Date.now() < chunkCache.expiresAt) return chunkCache.rows;

  const [rows] = await pool.query(
    `SELECT rc.id, rc.content, rc.embedding, rd.title AS document_title, rd.book_year
     FROM regulation_chunks rc
     JOIN regulation_documents rd ON rd.id = rc.document_id`
  );
  chunkCache = { rows, expiresAt: Date.now() + CHUNK_CACHE_TTL_MS };
  return rows;
}

// 청크가 수백 개 규모라 전부 메모리로 읽어 서버(Node.js)에서 유사도 계산 (schema.sql 7번 섹션 설계 결정)
//
// 예전엔 여기서 교육과정(db/curriculum) 청크도 함께 검색했는데, "특정 학기 과목 전부
// 나열해줘" 같은 질문은 top-K 유사도 특성상 일부 과목이 누락되는 문제가 반복 확인되어
// curriculum_courses 정형 테이블(curriculumService.lookupFromMessage)로 옮겼다. 그 근거로
// 과목명/학년·학기를 정규식으로 강제 포함시키던 로직도 같이 필요 없어져 제거함 — RAG는
// 이제 학칙처럼 진짜 비정형 프로즈 문서만 대상으로 하므로 순수 유사도 검색으로 충분하다.
//
// 연도 처리: 교육과정 책자 문서(book_year가 있는 문서)는 해마다 소제목이 같아서 유사도만으로 뽑으면 서로 다른
// 해의 비슷한 청크가 top-K를 채운다(예: 2024·2025·2026 해설의 같은 소제목 3개). 그래서 질문에서 정한 책자
// 학년도(options.bookYears)의 청크만 남기고, book_year가 없는 현행 규정 문서(학칙 등)는 그대로 경쟁시킨다.
// bookYears를 안 주면(옛 호출) 가장 최신 책자 하나만 쓴다 — 연도가 섞이는 것보다 낫다.
async function findRelevantChunks(queryEmbedding, options = {}) {
  const rows = await getAllChunkRows();

  const scored = rows.map((row) => ({
    chunkId: row.id,
    documentTitle: row.document_title,
    bookYear: row.book_year ?? null,
    content: row.content,
    score: cosineSimilarity(queryEmbedding, row.embedding),
  }));

  const availableYears = [...new Set(rows.map((r) => r.book_year).filter((y) => y != null))];
  const bookYears = options.bookYears && options.bookYears.length ? options.bookYears : availableYears.length ? [Math.max(...availableYears)] : [];
  return selectChunksByYear(scored, { bookYears, topK: options.topK || TOP_K, perYearMin: options.perYearMin || 0 });
}

/**
 * 점수가 매겨진 청크에서 질문의 책자 학년도에 맞는 것만 골라 top-K를 만든다(순수 함수).
 *  - bookYear가 null인 청크(현행 규정)는 항상 후보.
 *  - bookYear가 있는 청크는 bookYears에 포함된 것만 후보.
 *  - perYearMin: 여러 해를 비교할 때 각 해에서 최소 몇 개는 반드시 넣을지(그 해 청크가 MIN_SIMILARITY 이상일 때만).
 */
function selectChunksByYear(scored, { bookYears, topK = TOP_K, perYearMin = 0 }) {
  const allowed = new Set(bookYears);
  const candidates = scored
    .filter((c) => c.score >= MIN_SIMILARITY && (c.bookYear == null || allowed.has(c.bookYear)))
    .sort((a, b) => b.score - a.score);

  const picked = [];
  const pickedIds = new Set();
  if (perYearMin > 0 && bookYears.length > 1) {
    for (const year of bookYears) {
      for (const c of candidates.filter((x) => x.bookYear === year).slice(0, perYearMin)) {
        picked.push(c);
        pickedIds.add(c.chunkId);
      }
    }
  }
  for (const c of candidates) {
    if (picked.length >= topK) break;
    if (!pickedIds.has(c.chunkId)) {
      picked.push(c);
      pickedIds.add(c.chunkId);
    }
  }
  return picked.sort((a, b) => b.score - a.score).slice(0, Math.max(topK, perYearMin * bookYears.length));
}

// RAG에 들어 있는 교육과정 책자 학년도 목록(캐시된 청크에서 계산 — 추가 쿼리 없음).
async function getAvailableBookYears() {
  const rows = await getAllChunkRows();
  return [...new Set(rows.map((r) => r.book_year).filter((y) => y != null))].sort((a, b) => a - b);
}

// 직전 turn이 인용했던 청크를 이번 turn 근거에도 유지하기 위한 조회. "방금 답변 출처 알려줘"
// 같은 후속 질문은 검색 쿼리가 미묘하게 달라져 직전 turn과 다른(약한) 청크가 뽑히는 경우가
// 있는데, 그러면 모델이 "방금 그 근거를 지금 못 찾겠다"며 스스로 답을 부정하는 부작용이 생긴다.
async function findChunksByIds(chunkIds) {
  if (!chunkIds || chunkIds.length === 0) return [];
  const [rows] = await pool.query(
    `SELECT rc.id, rc.content, rd.title AS document_title, rd.book_year
     FROM regulation_chunks rc
     JOIN regulation_documents rd ON rd.id = rc.document_id
     WHERE rc.id IN (?)`,
    [chunkIds]
  );
  return rows.map((row) => ({ chunkId: row.id, documentTitle: row.document_title, bookYear: row.book_year ?? null, content: row.content }));
}

async function findOrCreateCurrentConversation(studentId) {
  const [rows] = await pool.query(
    'SELECT id FROM chat_conversations WHERE student_id = ? ORDER BY last_active_at DESC LIMIT 1',
    [studentId]
  );
  if (rows.length > 0) return rows[0].id;

  const [result] = await pool.query('INSERT INTO chat_conversations (student_id) VALUES (?)', [studentId]);
  return result.insertId;
}

async function findConversationById(studentId, conversationId) {
  const [rows] = await pool.query(
    'SELECT id FROM chat_conversations WHERE id = ? AND student_id = ?',
    [conversationId, studentId]
  );
  return rows[0] || null;
}

async function touchConversation(conversationId) {
  await pool.query('UPDATE chat_conversations SET last_active_at = NOW() WHERE id = ?', [conversationId]);
}

async function listMessages(conversationId) {
  const [rows] = await pool.query(
    'SELECT id, role, content, cited_chunk_ids, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY id',
    [conversationId]
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    citedChunkIds: r.cited_chunk_ids,
    createdAt: r.created_at,
  }));
}

// 사용자당 1일 채팅 한도 판정용 — 오늘 이 학생이 보낸 user 메시지 수(자정 리셋, 서버 시각 기준).
async function countTodayUserMessages(studentId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM chat_messages cm
     JOIN chat_conversations cc ON cc.id = cm.conversation_id
     WHERE cc.student_id = ? AND cm.role = 'user' AND DATE(cm.created_at) = CURDATE()`,
    [studentId]
  );
  return rows[0].count;
}

async function saveMessage(conversationId, { role, content, citedChunkIds }) {
  await pool.query(
    'INSERT INTO chat_messages (conversation_id, role, content, cited_chunk_ids) VALUES (?, ?, ?, ?)',
    [conversationId, role, content, citedChunkIds ? JSON.stringify(citedChunkIds) : null]
  );
}

module.exports = {
  MIN_SIMILARITY,
  findRelevantChunks,
  selectChunksByYear,
  getAvailableBookYears,
  findChunksByIds,
  findOrCreateCurrentConversation,
  findConversationById,
  touchConversation,
  listMessages,
  saveMessage,
  countTodayUserMessages,
};
