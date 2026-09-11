const pool = require('../db');

/**
 * server/services/communityService.js
 * 커뮤니티(스터디/프로젝트 모집) 게시판 — 관리자 승인 관련 DB 접근 계층.
 * 글 작성/신청 관련 함수는 2~3단계에서 추가된다.
 */

async function listPostsForAdmin(status) {
  const [rows] = await pool.query(
    'SELECT id, author_id, title, body, status, created_at FROM community_posts WHERE status = ? ORDER BY created_at ASC',
    [status]
  );
  return rows;
}

// status가 이미 'pending'이 아니면 아무 것도 안 바뀐다 — 이미 처리된 글을 다시
// 승인/반려하는 걸 막는 가드.
async function decidePost(id, status) {
  await pool.query(
    "UPDATE community_posts SET status = ?, decided_at = NOW() WHERE id = ? AND status = 'pending'",
    [status, id]
  );
}

async function deletePost(id) {
  await pool.query('DELETE FROM community_posts WHERE id = ?', [id]);
}

module.exports = { listPostsForAdmin, decidePost, deletePost };
