const pool = require('../db');

/**
 * server/services/warningService.js
 * 경고 기록(약관 6항의 "경고") — 기능은 막지 않고 기록만 남겨, 관리자가 반복 여부를 셀 수 있게 하고(docs/moderation-policy.md)
 * 학생에게는 다음 접속 때 사유를 한 번 보여준다. 정지·제한(sanctionService.js)과 표를 나눈 이유는 db/schema.sql 10-1-1.
 */

async function createWarning({ studentId, reason, createdBy, reportId = null }) {
  const [result] = await pool.query(
    'INSERT INTO student_warnings (student_id, reason, created_by, report_id) VALUES (?, ?, ?, ?)',
    [studentId, reason, createdBy, reportId]
  );
  return result.insertId;
}

// 학생이 아직 확인하지 않은 경고 중 가장 오래된 것 — 여러 개면 확인할 때마다 다음 것이 뜬다(GET /api/me).
async function getPendingWarning(studentId) {
  const [rows] = await pool.query(
    `SELECT id, reason, created_at FROM student_warnings
     WHERE student_id = ? AND acknowledged_at IS NULL
     ORDER BY created_at ASC, id ASC LIMIT 1`,
    [studentId]
  );
  const row = rows[0];
  return row ? { id: row.id, reason: row.reason, createdAt: row.created_at } : null;
}

// 본인 경고만 확인 처리한다. 이미 확인했거나 남의 경고면 false.
async function acknowledgeWarning(id, studentId) {
  const [result] = await pool.query(
    'UPDATE student_warnings SET acknowledged_at = NOW() WHERE id = ? AND student_id = ? AND acknowledged_at IS NULL',
    [id, studentId]
  );
  return result.affectedRows > 0;
}

// 경고 취소 — 잘못된 경고라 기록을 지운다(횟수에서 빠지고, 아직 확인하지 않았으면 학생에게도 뜨지 않는다).
async function deleteWarning(id) {
  const [result] = await pool.query('DELETE FROM student_warnings WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

// 관리자 요약(reportedStudentService)의 경고 목록 — 최근 것부터.
async function listWarningsForStudent(studentId) {
  const [rows] = await pool.query(
    `SELECT id, reason, created_at, acknowledged_at FROM student_warnings
     WHERE student_id = ? ORDER BY created_at DESC, id DESC`,
    [studentId]
  );
  return rows.map((r) => ({ id: r.id, reason: r.reason, createdAt: r.created_at, acknowledgedAt: r.acknowledged_at }));
}

// 관리자 "지난 제재"에 섞어 보여줄 최근 경고 100건 — 경고는 기간이 없어 "적용 중"에는 나오지 않는다.
async function listRecentWarnings() {
  const [rows] = await pool.query(
    `SELECT w.id, w.student_id, w.reason, w.report_id, w.created_at, w.acknowledged_at, st.name AS student_name
     FROM student_warnings w
     JOIN students st ON st.id = w.student_id
     ORDER BY w.created_at DESC, w.id DESC
     LIMIT 100`
  );
  return rows.map((r) => ({
    id: r.id,
    student: r.student_name || `user${r.student_id}`,
    reason: r.reason,
    reportId: r.report_id,
    createdAt: r.created_at,
    acknowledgedAt: r.acknowledged_at,
  }));
}

module.exports = { createWarning, getPendingWarning, acknowledgeWarning, deleteWarning, listWarningsForStudent, listRecentWarnings };
