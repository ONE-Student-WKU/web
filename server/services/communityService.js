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

module.exports = { listPostsForAdmin, decidePost, deletePost };
