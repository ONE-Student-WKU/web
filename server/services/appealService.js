const pool = require('../db');

/**
 * server/services/appealService.js
 * 정지 이의 제기 — 서비스 전체 이용 정지 중에는 문의하기가 막혀서(middleware/accountSuspension.js), 정지 화면 안에서 이의를
 * 정지 한 번에 1건만 받는다. 이의는 문의함(inquiries)에 sanction_id를 붙여 넣어 관리자 알림·답변 흐름을 그대로 쓰고,
 * 관리자 답변(resolution_note)은 학생의 정지 화면에 보인다. 문의하기로 정지된 경우에도 통로가 1건으로 묶여 피해가 거기까지다.
 */

// 문의함에서 이의 제기를 알아보게 하는 제목 — 관리자 화면에만 쓰이는 서버 저장 값이라 한국어 그대로 둔다.
const APPEAL_TITLE = '정지 이의 제기';
const APPEAL_MAX_LENGTH = 2000;

function isValidAppealContent(content) {
  return typeof content === 'string' && content.trim().length > 0 && content.trim().length <= APPEAL_MAX_LENGTH;
}

function toAppeal(row) {
  return row
    ? { content: row.content, createdAt: row.created_at, status: row.status, reply: row.resolution_note }
    : null;
}

// 그 정지에 대해 이 학생이 보낸 이의(없으면 null).
async function getAppeal(sanctionId, studentId) {
  const [rows] = await pool.query(
    'SELECT content, created_at, status, resolution_note FROM inquiries WHERE sanction_id = ? AND student_id = ? ORDER BY id LIMIT 1',
    [sanctionId, studentId]
  );
  return toAppeal(rows[0]);
}

// 이미 보냈으면 null(정지 한 번에 1건).
async function createAppeal(studentId, sanctionId, content) {
  if (await getAppeal(sanctionId, studentId)) return null;
  await pool.query(
    "INSERT INTO inquiries (student_id, title, content, status, sanction_id) VALUES (?, ?, ?, 'open', ?)",
    [studentId, APPEAL_TITLE, content.trim(), sanctionId]
  );
  return getAppeal(sanctionId, studentId);
}

module.exports = { APPEAL_TITLE, isValidAppealContent, getAppeal, createAppeal };
