const pool = require('../db');
const { NOT_FOUND_MESSAGE, NOT_FOUND_MESSAGE_EN } = require('./chatConstants');

/**
 * server/services/adminStatsService.js
 * 관리자 대시보드(GET /api/admin/stats) 집계.
 *
 * - pending*: 관리자가 처리해야 할 대기열 건수 — 대시보드 타일의 빨간 뱃지로 쓴다(목록 전체를 불러오지 않고 COUNT만 센다).
 * - last24h: 운영·유지보수 지표. "오늘"(자정 기준) 대신 "최근 24시간"으로 센다 — DB 서버의 시간대(UTC 등)와 한국 날짜가
 *   달라 자정 경계가 오전 9시로 밀리는 문제를 피하고, 언제 보더라도 같은 길이의 구간이라 비교하기 쉽다.
 *   · chatQuestions: 챗봇 질문 수 — Claude·Voyage 호출 비용의 가장 직접적인 신호(크레딧 소진 같은 일을 미리 보게 한다).
 *   · chatNotFound: 근거 문서를 못 찾아 고정 안내로만 답한 횟수 — 규정 문서가 모자란 곳을 찾는 신호.
 *   · activeStudents: 최근 24시간 안에 요청이 있었던 계정 수(student_activity).
 *   · signups: 최근 24시간 신규 가입 수.
 */
async function count(sql, params = []) {
  const [[row]] = await pool.query(sql, params);
  return Number(row.count);
}

async function getDashboardStats() {
  const [
    activeSessions,
    pendingReports,
    pendingInquiries,
    pendingPosts,
    signups,
    chatQuestions,
    chatNotFound,
    activeStudents,
  ] = await Promise.all([
    count('SELECT COUNT(*) AS count FROM student_activity WHERE last_seen_at > NOW() - INTERVAL 5 MINUTE'),
    count("SELECT COUNT(*) AS count FROM community_reports WHERE status = 'pending'"),
    count("SELECT COUNT(*) AS count FROM inquiries WHERE status = 'open'"),
    count("SELECT COUNT(*) AS count FROM community_posts WHERE status = 'pending'"),
    count('SELECT COUNT(*) AS count FROM students WHERE created_at > NOW() - INTERVAL 24 HOUR'),
    count("SELECT COUNT(*) AS count FROM chat_messages WHERE role = 'user' AND created_at > NOW() - INTERVAL 24 HOUR"),
    count(
      "SELECT COUNT(*) AS count FROM chat_messages WHERE role = 'assistant' AND content IN (?, ?) AND created_at > NOW() - INTERVAL 24 HOUR",
      [NOT_FOUND_MESSAGE, NOT_FOUND_MESSAGE_EN]
    ),
    count('SELECT COUNT(*) AS count FROM student_activity WHERE last_seen_at > NOW() - INTERVAL 24 HOUR'),
  ]);

  return {
    activeSessions,
    pending: { reports: pendingReports, inquiries: pendingInquiries, posts: pendingPosts },
    last24h: { signups, chatQuestions, chatNotFound, activeStudents },
  };
}

module.exports = { getDashboardStats };
