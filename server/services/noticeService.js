const pool = require('../db');

/**
 * server/services/noticeService.js
 * 커뮤니티 공지(community_notices) — 운영팀이 쓰고 학생은 읽기만 한다. 승인 절차·신청·신고·댓글이 없다.
 * 새 공지: 학생이 아직 열어 보지 않은 공지(community_notice_reads)다. 상세를 열거나 "모두 읽음으로 표시"를 눌러야 읽은 것이 된다
 * (예전에는 목록을 한 번 열면 모든 공지가 읽은 것이 됐다 — 2026-10-23 피드백). 그 전에 쓰던 "목록을 마지막으로 본 시각"
 * (community_notice_seen)은 더 갱신하지 않고, 그보다 먼저 올라온 공지를 이미 본 것으로 치는 데만 쓴다. 자기가 쓴 공지(관리자)는
 * 자기에게 새 공지로 세지 않는다.
 */

const NOTICE_TITLE_MAX_LENGTH = 60;
const NOTICE_BODY_MAX_LENGTH = 3000;

// 새 공지 조건. n = 공지, r = 이 학생의 읽음 기록, s = 이 학생의 예전 "본 시각". 마지막 ?는 이 학생 id(자기가 쓴 공지 빼기).
const IS_NEW = '(r.notice_id IS NULL AND (s.seen_at IS NULL OR n.created_at > s.seen_at) AND (n.author_id IS NULL OR n.author_id <> ?))';
const JOIN_READS = `LEFT JOIN community_notice_reads r ON r.notice_id = n.id AND r.student_id = ?
     LEFT JOIN community_notice_seen s ON s.student_id = ?`;

function serialize(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isNew: Boolean(Number(row.is_new)),
  };
}

/** 공지 목록(최신 순). isNew는 이 학생이 아직 열어 보지 않은 공지다. */
async function listNotices(studentId) {
  const [rows] = await pool.query(
    `SELECT n.id, n.title, n.body, n.created_at, n.updated_at, ${IS_NEW} AS is_new
     FROM community_notices n
     ${JOIN_READS}
     ORDER BY n.created_at DESC, n.id DESC`,
    [studentId, studentId, studentId]
  );
  return rows.map(serialize);
}

async function countUnseen(studentId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count FROM community_notices n
     ${JOIN_READS}
     WHERE ${IS_NEW}`,
    [studentId, studentId, studentId]
  );
  return Number(row.count);
}

/** 공지 하나를 읽은 것으로 기록한다. 없는 공지면 false. 이미 읽었으면 그대로 둔다. */
async function markRead(studentId, noticeId) {
  const [result] = await pool.query(
    'INSERT IGNORE INTO community_notice_reads (student_id, notice_id) SELECT ?, id FROM community_notices WHERE id = ?',
    [studentId, noticeId]
  );
  if (result.affectedRows > 0) return true;
  const [[exists]] = await pool.query('SELECT COUNT(*) AS count FROM community_notices WHERE id = ?', [noticeId]);
  return Number(exists.count) > 0;
}

/** 지금 있는 공지를 모두 읽은 것으로 기록한다("모두 읽음으로 표시"). */
async function markAllRead(studentId) {
  await pool.query('INSERT IGNORE INTO community_notice_reads (student_id, notice_id) SELECT ?, id FROM community_notices', [studentId]);
}

async function createNotice(authorId, { title, body }) {
  const [result] = await pool.query('INSERT INTO community_notices (author_id, title, body) VALUES (?, ?, ?)', [authorId, title, body]);
  return result.insertId;
}

// 수정은 created_at과 읽음 기록을 그대로 둔다 — 고친 공지로 새 공지 점이 다시 뜨지 않게(오탈자 수정 같은 일이 대부분이다).
async function updateNotice(id, { title, body }) {
  const [result] = await pool.query('UPDATE community_notices SET title = ?, body = ?, updated_at = NOW() WHERE id = ?', [title, body, id]);
  return result.affectedRows > 0;
}

async function deleteNotice(id) {
  const [result] = await pool.query('DELETE FROM community_notices WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

/** 제목·본문 검사 — 앞뒤 공백을 뗀 값을 돌려준다. 잘못되면 null. */
function normalizeNoticeInput(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!title || title.length > NOTICE_TITLE_MAX_LENGTH || !text || text.length > NOTICE_BODY_MAX_LENGTH) return null;
  return { title, body: text };
}

module.exports = {
  NOTICE_TITLE_MAX_LENGTH,
  NOTICE_BODY_MAX_LENGTH,
  listNotices,
  countUnseen,
  markRead,
  markAllRead,
  createNotice,
  updateNotice,
  deleteNotice,
  normalizeNoticeInput,
};
