const pool = require('../db');

/**
 * server/services/noticeService.js
 * 커뮤니티 공지(community_notices) — 운영자가 쓰고 학생은 읽기만 한다. 승인 절차·신청·신고·댓글이 없다.
 * 새 공지 점: 학생이 공지 목록을 마지막으로 본 시각(community_notice_seen)보다 뒤에 올라온 공지 수. 한 번도 안 봤으면 전부 새 공지다.
 */

const NOTICE_TITLE_MAX_LENGTH = 60;
const NOTICE_BODY_MAX_LENGTH = 3000;

function serialize(row, seenAt) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isNew: seenAt === undefined ? false : seenAt === null || new Date(row.created_at) > new Date(seenAt),
  };
}

async function seenAtOf(studentId) {
  const [rows] = await pool.query('SELECT seen_at FROM community_notice_seen WHERE student_id = ?', [studentId]);
  return rows.length ? rows[0].seen_at : null;
}

/** 공지 목록(최신 순). isNew는 이 학생이 목록을 마지막으로 본 뒤에 올라온 공지다. */
async function listNotices(studentId) {
  const [[rows], seenAt] = await Promise.all([
    pool.query('SELECT id, title, body, created_at, updated_at FROM community_notices ORDER BY created_at DESC, id DESC'),
    seenAtOf(studentId),
  ]);
  return rows.map((row) => serialize(row, seenAt));
}

async function countUnseen(studentId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count FROM community_notices n
     LEFT JOIN community_notice_seen s ON s.student_id = ?
     WHERE s.seen_at IS NULL OR n.created_at > s.seen_at`,
    [studentId]
  );
  return Number(row.count);
}

async function markSeen(studentId) {
  await pool.query(
    'INSERT INTO community_notice_seen (student_id, seen_at) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE seen_at = NOW()',
    [studentId]
  );
}

async function createNotice(authorId, { title, body }) {
  const [result] = await pool.query('INSERT INTO community_notices (author_id, title, body) VALUES (?, ?, ?)', [authorId, title, body]);
  return result.insertId;
}

// 수정은 created_at을 그대로 둔다 — 고친 공지로 새 공지 점이 다시 뜨지 않게(오탈자 수정 같은 일이 대부분이다).
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
  markSeen,
  createNotice,
  updateNotice,
  deleteNotice,
  normalizeNoticeInput,
};
