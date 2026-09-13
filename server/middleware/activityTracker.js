const pool = require('../db');

/**
 * server/middleware/activityTracker.js
 * 관리자 대시보드 "현재 접속자"(GET /api/admin/stats)가 쓰는 최근 활동 기록.
 */

// 매 요청마다 DB에 쓰면 낭비가 커서(조회성 API 호출이 잦음), 세션에 마지막 기록 시각을
// 들고 있다가 이 시간 이상 지났을 때만 실제로 UPSERT한다 — "최근 5분 내 활동"을 재는 데는
// 1분 해상도면 충분하다.
const WRITE_THROTTLE_MS = 60 * 1000;

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
  }
  next();
}

module.exports = { trackActivity };
