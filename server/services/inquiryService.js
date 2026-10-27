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
    'SELECT id, title, content, status, created_at, resolved_at, resolution_note FROM inquiries WHERE student_id = ? ORDER BY created_at DESC',
    [studentId]
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
  }));
}

async function listInquiriesForAdmin(status) {
  const [rows] = await pool.query(
    `SELECT i.id, i.title, i.content, i.status, i.created_at, i.resolved_at, i.resolution_note, s.name AS student_name, s.id AS student_id,
            s.admission_year, d.name AS department_name,
            ss.id AS sanction_id, ss.scope AS sanction_scope, ss.reason AS sanction_reason, ss.ends_at AS sanction_ends_at,
            ss.lifted_at AS sanction_lifted_at
     FROM inquiries i
     JOIN students s ON s.id = i.student_id
     LEFT JOIN departments d ON d.id = s.department_id
     LEFT JOIN student_sanctions ss ON ss.id = i.sanction_id
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
    resolutionNote: row.resolution_note,
    student: nicknameOf(row.student_name, row.student_id),
    // 문의 상세에서 그 학생의 제재 이력을 보고 바로 제재할 때 쓴다(#457 — 문의하기 욕설은 커뮤니티 밖 위반).
    studentId: row.student_id,
    // 졸업요건·과목 문의에 답하려면 학과·학번이 필요하다(관리자 문의 상세). 이메일 같은 다른 계정 정보는 내려주지 않는다.
    department: row.department_name,
    admissionYear: row.admission_year,
    // 정지 화면에서 보낸 이의 제기면 그 정지(appealService.js). 제재가 철회돼 지워졌으면 null.
    appealFor: row.sanction_id
      ? { id: row.sanction_id, scope: row.sanction_scope, reason: row.sanction_reason, endsAt: row.sanction_ends_at, liftedAt: row.sanction_lifted_at }
      : null,
  }));
}

// status가 이미 'open'이 아니면 아무 것도 안 바뀐다(community 쪽 decidePost와 동일한
// 재처리 방지 가드). note는 문의자에게 보여줄 처리 답변(선택, 없으면 null).
async function resolveInquiry(id, note = null) {
  const [result] = await pool.query(
    "UPDATE inquiries SET status = 'resolved', resolved_at = NOW(), resolution_note = ? WHERE id = ? AND status = 'open'",
    [note, id]
  );
  return result.affectedRows > 0;
}

module.exports = {
  createInquiry,
  listMyInquiries,
  listInquiriesForAdmin,
  resolveInquiry,
};
