const pool = require('../db');

/**
 * server/services/inquiryService.js
 * 문의하기(#166) — 버그/문제 제보, 커뮤니티와 무관한 범용 채널. DB 접근 계층.
 */

// communityService.js의 nicknameOf와 동일한 닉네임 폴백 — 파일마다 따로 두는 게 이 코드베이스의
// 기존 컨벤션(공유 유틸로 안 뺌, communityService.js 상단 주석 참고).
function nicknameOf(name, id) {
  return name || `user${id}`;
}

async function createInquiry(studentId, title, content) {
  const [result] = await pool.query(
    "INSERT INTO inquiries (student_id, title, content, status) VALUES (?, ?, ?, 'open')",
    [studentId, title, content]
  );
  return result.insertId;
}

async function listMyInquiries(studentId) {
  const [rows] = await pool.query(
    'SELECT id, title, content, status, created_at, resolved_at FROM inquiries WHERE student_id = ? ORDER BY created_at DESC',
    [studentId]
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }));
}

async function listInquiriesForAdmin(status) {
  const [rows] = await pool.query(
    `SELECT i.id, i.title, i.content, i.status, i.created_at, i.resolved_at, s.name AS student_name, s.id AS student_id
     FROM inquiries i
     JOIN students s ON s.id = i.student_id
     WHERE i.status = ?
     ORDER BY i.created_at ASC`,
    [status]
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    student: nicknameOf(row.student_name, row.student_id),
  }));
}

// status가 이미 'open'이 아니면 아무 것도 안 바뀐다(community 쪽 decidePost와 동일한
// 재처리 방지 가드).
async function resolveInquiry(id) {
  const [result] = await pool.query(
    "UPDATE inquiries SET status = 'resolved', resolved_at = NOW() WHERE id = ? AND status = 'open'",
    [id]
  );
  return result.affectedRows > 0;
}

module.exports = {
  createInquiry,
  listMyInquiries,
  listInquiriesForAdmin,
  resolveInquiry,
};
