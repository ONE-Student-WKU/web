const pool = require('../db');

/**
 * server/middleware/activityTracker.js
 * 관리자 대시보드 "현재 접속자"(GET /api/admin/stats)가 쓰는 최근 활동 기록과, 방문자 추이·재방문율이 쓰는 하루 방문 기록.
 */

// 매 요청마다 DB에 쓰면 낭비가 커서(조회성 API 호출이 잦음), 세션에 마지막 기록 시각을
// 들고 있다가 이 시간 이상 지났을 때만 실제로 UPSERT한다 — "최근 5분 내 활동"을 재는 데는
// 1분 해상도면 충분하다.
const WRITE_THROTTLE_MS = 60 * 1000;
const KST_OFFSET_MS = 9 * 3600 * 1000;

// 한국 날짜 'YYYY-MM-DD'. DB 서버 시간대(UTC 등)와 무관하게 학교 기준의 하루로 센다(adminStatsService와 같은 기준).
function kstDate(nowMs) {
  return new Date(nowMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function trackActivity(req, res, next) {
  const userId = req.session && req.session.userId;
  if (userId) {
    const now = Date.now();
    if (!req.session.lastActivityWriteAt || now - req.session.lastActivityWriteAt > WRITE_THROTTLE_MS) {
      req.session.lastActivityWriteAt = now;
      // 통계용 best-effort 기록이라 실패해도 요청 흐름을 막지 않는다.
      pool
        .query(
          'INSERT INTO student_activity (student_id, last_seen_at) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE last_seen_at = NOW()',
          [userId]
        )
        .catch((err) => console.error('[activityTracker] 기록 실패:', err.message));
    }
    // 하루 방문은 세션에 오늘 날짜를 기억해 하루에 한 번만 쓴다(같은 날 다른 기기·세션이면 INSERT IGNORE가 중복을 막는다).
    const today = kstDate(now);
    if (req.session.lastVisitDate !== today) {
      req.session.lastVisitDate = today;
      pool
        .query('INSERT IGNORE INTO student_daily_visits (student_id, visit_date) VALUES (?, ?)', [userId, today])
        .catch((err) => console.error('[activityTracker] 방문 기록 실패:', err.message));
    }
  }
  next();
}

module.exports = { trackActivity, kstDate };
