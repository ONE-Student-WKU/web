const pool = require('../db');

/**
 * server/services/reportedStudentService.js
 * 관리자 신고함에서 "신고 대상자"를 눌렀을 때 보여줄 요약 정보(읽기 전용).
 *
 * 노출하지 않는 것(의도적): 실제 이메일, 비밀번호/OAuth 식별자, 학번 전체(입학년도만), 역할(role).
 * 이 서비스는 매칭 상대에게 실제 이메일을 숨기도록 설계돼 있어(community_email_proxies),
 * 관리자 화면이라도 판단에 필요한 최소 정보만 내려준다 — 라우트(admin.js)가 requireAdmin을 먼저 통과시킨다.
 */

// 제재가 지금 효력이 있는지/해제됐는지/기간이 끝났는지 — sanctionService.getActiveSanction의 "유효" 정의와 같다
// (lifted_at이 비었고 ends_at이 없거나 아직 안 지남).
function sanctionState(row, now) {
  if (row.lifted_at) return 'lifted';
  if (row.ends_at && new Date(row.ends_at) <= now) return 'expired';
  return 'active';
}

async function getReportedStudentSummary(studentId, now = new Date()) {
  const [[student]] = await pool.query(
    `SELECT s.id, s.name, s.admission_year, s.created_at, d.name AS department_name
     FROM students s
     LEFT JOIN departments d ON d.id = s.department_id
     WHERE s.id = ?`,
    [studentId]
  );
  if (!student) return null;

  const [[{ postCount }]] = await pool.query('SELECT COUNT(*) AS postCount FROM community_posts WHERE author_id = ?', [studentId]);
  const [[{ applicationCount }]] = await pool.query('SELECT COUNT(*) AS applicationCount FROM community_applications WHERE applicant_id = ?', [studentId]);
  const [reportRows] = await pool.query('SELECT status, COUNT(*) AS n FROM community_reports WHERE reported_student_id = ? GROUP BY status', [studentId]);
  const [sanctionRows] = await pool.query(
    `SELECT id, reason, scope, starts_at, ends_at, lifted_at, created_at
     FROM student_sanctions WHERE student_id = ? ORDER BY created_at DESC, id DESC`,
    [studentId]
  );

  const reportsByStatus = Object.fromEntries(reportRows.map((r) => [r.status, Number(r.n)]));
  const sanctions = sanctionRows.map((r) => ({
    id: r.id,
    scope: r.scope,
    reason: r.reason,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    liftedAt: r.lifted_at,
    state: sanctionState(r, now),
  }));

  return {
    id: student.id,
    nickname: student.name || `user${student.id}`,
    department: student.department_name || null,
    admissionYear: student.admission_year ?? null,
    joinedAt: student.created_at,
    postCount: Number(postCount),
    applicationCount: Number(applicationCount),
    // 이 사람이 신고당한 횟수(처리 상태별). 아직 처리 안 된 신고(pending)와 처리 완료(resolved)를 나눠 보여준다.
    reportsReceived: {
      pending: reportsByStatus.pending || 0,
      resolved: reportsByStatus.resolved || 0,
      total: Object.values(reportsByStatus).reduce((a, b) => a + b, 0),
    },
    sanctions,
  };
}

module.exports = { getReportedStudentSummary, sanctionState };
