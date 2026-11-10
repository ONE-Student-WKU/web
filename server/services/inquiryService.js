const pool = require('../db');
const moderationLabelService = require('./moderationLabelService');

/**
 * server/services/inquiryService.js
 * 문의하기(#166) — 버그/문제 제보, 커뮤니티와 무관한 범용 채널. DB 접근 계층.
 */

// communityService.js의 nicknameOf와 동일한 닉네임 폴백 — 파일마다 따로 두는 게 이 코드베이스의
// 기존 컨벤션(공유 유틸로 안 뺌, communityService.js 상단 주석 참고).
function nicknameOf(name, id) {
  return name || `user${id}`;
}

// source: 어느 화면에서 연 문의인지(INQUIRY_SOURCES, 없으면 null). diagnosisSnapshot: 학생이 고른 진단 스냅샷(inquiryDiagnosisSnapshot.js) 또는 null.
const INQUIRY_SOURCES = ['GRADUATION_REPORT'];

async function createInquiry(studentId, title, content, { source = null, diagnosisSnapshot = null } = {}) {
  const [result] = await pool.query(
    "INSERT INTO inquiries (student_id, title, content, status, source, diagnosis_snapshot) VALUES (?, ?, ?, 'open', ?, ?)",
    [studentId, title, content, source, diagnosisSnapshot ? JSON.stringify(diagnosisSnapshot) : null]
  );
  return result.insertId;
}

// JSON 칸은 드라이버 설정에 따라 객체나 문자열로 온다.
function parseJsonColumn(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function listMyInquiries(studentId) {
  const [rows] = await pool.query(
    'SELECT id, title, content, status, created_at, resolved_at, resolution_note, (diagnosis_snapshot IS NOT NULL) AS diagnosis_attached FROM inquiries WHERE student_id = ? ORDER BY created_at DESC',
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
    // 진단 결과를 같이 보냈는지(내용은 학생 화면에 다시 보여 주지 않는다 — 학생은 지금 진단을 언제든 볼 수 있다).
    diagnosisAttached: Boolean(Number(row.diagnosis_attached)),
  }));
}

async function listInquiriesForAdmin(status) {
  const [rows] = await pool.query(
    `SELECT i.id, i.title, i.content, i.status, i.created_at, i.resolved_at, i.resolution_note, s.name AS student_name, s.id AS student_id,
            s.admission_year, d.name AS department_name,
            ss.id AS sanction_id, ss.scope AS sanction_scope, ss.reason AS sanction_reason, ss.ends_at AS sanction_ends_at,
            ss.lifted_at AS sanction_lifted_at, i.ai_result, i.ai_highlights, i.source, i.diagnosis_snapshot
     FROM inquiries i
     JOIN students s ON s.id = i.student_id
     LEFT JOIN departments d ON d.id = s.department_id
     LEFT JOIN student_sanctions ss ON ss.id = i.sanction_id
     WHERE i.status = ?
     ORDER BY i.created_at ASC`,
    [status]
  );
  return Promise.all(rows.map(async (row) => ({
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
    // 어느 화면에서 연 문의인지(GRADUATION_REPORT = 졸업요건 진단의 "결과가 이상해요")와 학생이 같이 보낸 진단 스냅샷(없으면 null).
    source: row.source || null,
    diagnosisSnapshot: parseJsonColumn(row.diagnosis_snapshot),
    // AI 사전 분류(#458) — 심각도에 문의자의 이전 경고·제재 수를 더한 제안 조치와 형광펜 조각. 정지 이의 제기는 분류하지 않아 늘 null.
    aiSuggestion: await moderationLabelService.buildSuggestion('inquiry', row, { studentId: row.student_id, createdAt: row.created_at }),
  })));
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
  INQUIRY_SOURCES,
  createInquiry,
  listMyInquiries,
  listInquiriesForAdmin,
  resolveInquiry,
};
