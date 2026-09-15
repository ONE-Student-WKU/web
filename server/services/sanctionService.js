const pool = require('../db');

/**
 * server/services/sanctionService.js
 * 커뮤니티 사용자 제재(#201) — 정지 부여/해제/조회. 신고함(admin.js)에서 이어지는
 * 조치로만 쓰이지만, report_id는 nullable이라 향후 신고 없이 직접 거는 조치도 스키마
 * 변경 없이 얹을 수 있다.
 */

async function createSanction({ studentId, reason, scope, durationDays, createdBy, reportId = null }) {
  const endsAt = durationDays === null ? null : new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
  const [result] = await pool.query(
    `INSERT INTO student_sanctions (student_id, reason, scope, starts_at, ends_at, created_by, report_id)
     VALUES (?, ?, ?, NOW(), ?, ?, ?)`,
    [studentId, reason, scope, endsAt, createdBy, reportId]
  );
  return result.insertId;
}

async function liftSanction(id) {
  const [result] = await pool.query('UPDATE student_sanctions SET lifted_at = NOW() WHERE id = ? AND lifted_at IS NULL', [id]);
  return result.affectedRows > 0;
}

// 한 계정에 제재가 여러 번 쌓일 수 있어서(이력 보존), "지금 실제로 적용 중인 제재"는
// 해제 안 됐고(lifted_at NULL) 기간이 남아있거나 영구인 것 중 가장 최근 것 하나로 정의한다.
async function getActiveSanction(studentId) {
  const [rows] = await pool.query(
    `SELECT id, scope, reason, ends_at
     FROM student_sanctions
     WHERE student_id = ? AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > NOW())
     ORDER BY created_at DESC LIMIT 1`,
    [studentId]
  );
  return rows[0] || null;
}

// 관리자 "제재 관리" 탭 — 지금 유효한 제재 전체(계정별로 여러 건이어도 최신 것만 남기지
// 않고 그대로 보여준다. 한 계정에 2개 이상 겹쳐 있는 건 정상 상황이 아니라 관리자가
// 알아채야 할 신호에 가깝다).
async function listActiveSanctions() {
  const [rows] = await pool.query(
    `SELECT s.id, s.student_id, s.reason, s.scope, s.starts_at, s.ends_at, st.name AS student_name
     FROM student_sanctions s
     JOIN students st ON st.id = s.student_id
     WHERE s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > NOW())
     ORDER BY s.created_at DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    student: r.student_name || `user${r.student_id}`,
    reason: r.reason,
    scope: r.scope,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
  }));
}

module.exports = {
  createSanction,
  liftSanction,
  getActiveSanction,
  listActiveSanctions,
};
