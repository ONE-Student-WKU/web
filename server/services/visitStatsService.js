const pool = require('../db');
const { kstDateOffset } = require('./adminStatsService');

/**
 * server/services/visitStatsService.js
 * 하루 방문 기록(student_daily_visits)의 보관 기간 정리. 학생과 연결된 기록은 최근 14일(오늘 포함)만 두고,
 * 그보다 오래된 날은 날짜별 방문자 수(daily_visit_counts)로 옮긴 뒤 지운다(개인정보처리방침의 보관 기간).
 * 14일이면 재방문율(지난주 8~14일 전 방문자 중 이번 주에도 온 비율)을 계산하는 데 충분하다.
 */

const RETENTION_DAYS = 14;
const ROLLUP_INTERVAL_MS = 6 * 3600 * 1000;

// 학생별로 남겨 두는 가장 오래된 날짜(한국 날짜). 이 날짜보다 앞선 기록이 합계로 옮겨진다.
function retentionStart(now = Date.now()) {
  return kstDateOffset(now, -(RETENTION_DAYS - 1));
}

/**
 * 오래된 방문 기록을 날짜별 합계로 옮기고 지운다. 옮기기와 지우기를 한 트랜잭션으로 묶어, 중간에 실패해도 두 번 세지거나
 * 사라지지 않는다. FOR UPDATE로 먼저 잠가 서버가 여러 대여도 같은 기록을 동시에 옮기지 않는다. 옮긴 줄 수를 돌려준다.
 */
async function rollupOldVisits(now = Date.now()) {
  const cutoff = retentionStart(now);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[locked]] = await conn.query('SELECT COUNT(*) AS count FROM student_daily_visits WHERE visit_date < ? FOR UPDATE', [cutoff]);
    if (!Number(locked.count)) {
      await conn.commit();
      return 0;
    }
    await conn.query(
      `INSERT INTO daily_visit_counts (visit_date, visitors)
       SELECT visit_date, COUNT(*) FROM student_daily_visits WHERE visit_date < ? GROUP BY visit_date
       ON DUPLICATE KEY UPDATE visitors = visitors + VALUES(visitors)`,
      [cutoff]
    );
    const [deleted] = await conn.query('DELETE FROM student_daily_visits WHERE visit_date < ?', [cutoff]);
    await conn.commit();
    return deleted.affectedRows;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// 서버가 켜질 때 한 번, 그 뒤로 6시간마다 정리한다(하루가 바뀐 뒤 늦어도 6시간 안에 옮겨진다). 통계용이라 실패해도 서버를 멈추지 않는다.
function startVisitRollup() {
  const run = () => rollupOldVisits().catch((err) => console.error('[visitStats] 방문 기록 정리 실패:', err.message));
  run();
  setInterval(run, ROLLUP_INTERVAL_MS).unref();
}

module.exports = { RETENTION_DAYS, retentionStart, rollupOldVisits, startVisitRollup };
