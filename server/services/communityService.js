const pool = require('../db');

/**
 * server/services/communityService.js
 * 커뮤니티(스터디/프로젝트 모집) 게시판 — DB 접근 계층.
 * 신청/수락/모집마감 관련 함수는 3단계에서 추가된다.
 */

// studentService.js의 serializeStudent()와 동일한 닉네임 폴백(student.name || user{id}) —
// 가입 시 name을 NULL로 남겨두는 정책이라 표시 시점에 계산해야 한다. 한 곳(studentService)의
// 규칙을 SQL로 다시 구현하지 않고 그대로 재사용.
function nicknameOf(row) {
  return row.author_name || `user${row.author_id}`;
}

// 이 학과에 승인 대기 없이도 학생이 볼 수 있는 글 목록을 위한 전제: status='pending'인
// 글은 목록/상세 어디서도 제3자에게 노출되면 안 된다(db/schema.sql 커뮤니티 게시판 주석
// 참고 — 관리자 승인 전엔 비공개). 아래 학생용 함수들이 이 규칙을 지킨다.

async function createPost(authorId, { title, body }) {
  const [result] = await pool.query(
    "INSERT INTO community_posts (author_id, title, body, status) VALUES (?, ?, ?, 'pending')",
    [authorId, title, body]
  );
  return result.insertId;
}

async function listApprovedPosts() {
  const [rows] = await pool.query(
    `SELECT p.id, p.title, p.body, p.closed_at, p.created_at, p.author_id, s.name AS author_name
     FROM community_posts p
     JOIN students s ON s.id = p.author_id
     WHERE p.status = 'approved'
     ORDER BY p.created_at DESC`
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    author: nicknameOf(row),
  }));
}

// 작성자 본인은 상태(대기/승인/반려) 무관하게 자기 글을 전부 볼 수 있다 — 승인 전엔
// 목록에 안 뜨니 이게 없으면 글을 썼는지 확인할 방법이 없다.
async function listMyPosts(studentId) {
  const [rows] = await pool.query(
    `SELECT id, title, body, status, closed_at, created_at
     FROM community_posts
     WHERE author_id = ?
     ORDER BY created_at DESC`,
    [studentId]
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    closedAt: row.closed_at,
    createdAt: row.created_at,
  }));
}

// 승인된 글은 누구나, 그 외(대기/반려)는 작성자 본인만 볼 수 있다 — id를 알아도 남의
// 비공개 글을 못 보게 막는 게 목적.
async function getPostById(id, { studentId }) {
  const [rows] = await pool.query(
    `SELECT p.id, p.title, p.body, p.status, p.closed_at, p.created_at, p.author_id, s.name AS author_name
     FROM community_posts p
     JOIN students s ON s.id = p.author_id
     WHERE p.id = ?`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.status !== 'approved' && row.author_id !== studentId) return null;

  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    author: nicknameOf(row),
    isMine: row.author_id === studentId,
  };
}

async function listPostsForAdmin(status) {
  const [rows] = await pool.query(
    'SELECT id, author_id, title, body, status, created_at FROM community_posts WHERE status = ? ORDER BY created_at ASC',
    [status]
  );
  return rows;
}

// status가 이미 'pending'이 아니면 아무 것도 안 바뀐다 — 이미 처리된 글을 다시
// 승인/반려하는 걸 막는 가드. affectedRows를 돌려줘서 호출부가 "존재하지 않거나 이미
// 처리된 글"을 실제 성공과 구분할 수 있게 한다(그렇지 않으면 관리자가 아무 효과 없는
// 요청에도 성공 응답을 받는다).
async function decidePost(id, status) {
  const [result] = await pool.query(
    "UPDATE community_posts SET status = ?, decided_at = NOW() WHERE id = ? AND status = 'pending'",
    [status, id]
  );
  return result.affectedRows > 0;
}

// 존재하지 않는 id를 삭제 시도해도 조용히 200이 나가지 않도록 affectedRows를 돌려준다.
async function deletePost(id) {
  const [result] = await pool.query('DELETE FROM community_posts WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

module.exports = {
  createPost,
  listApprovedPosts,
  listMyPosts,
  getPostById,
  listPostsForAdmin,
  decidePost,
  deletePost,
};
