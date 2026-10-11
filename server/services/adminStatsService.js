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

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86400;
// 일 단위 구간의 날짜는 한국 날짜(KST, 서머타임 없음)로 센다 — 학교 서비스라 "하루"는 한국의 하루이고, DB 서버가 UTC여도 같은 결과가 나온다.
const KST_OFFSET_SECONDS = 9 * HOUR_SECONDS;
const ALL_MIN_DAYS = 7; // "전체"가 막 시작한 서비스라도 그래프가 한두 칸으로 쪼그라들지 않게
const ALL_MAX_DAYS = 1825; // 5년 — 응답 크기와 쿼리 범위의 상한

// range → 구간 단위와 칸 수. all은 가장 오래된 기록부터 오늘까지(칸 수는 기록을 보고 정한다).
const TREND_RANGES = {
  '24h': { unit: 'hour', count: 24 },
  '30d': { unit: 'day', count: 30 },
  '1y': { unit: 'day', count: 365 },
  all: { unit: 'day', count: null },
};

function isTrendRange(range) {
  return Object.prototype.hasOwnProperty.call(TREND_RANGES, range);
}

// 신규 가입·챗봇 기록 중 가장 오래된 것의 시각(에포크 초). 기록이 하나도 없으면 null.
async function firstRecordEpoch() {
  const [[students]] = await pool.query('SELECT UNIX_TIMESTAMP(MIN(created_at)) AS first FROM students');
  const [[messages]] = await pool.query('SELECT UNIX_TIMESTAMP(MIN(created_at)) AS first FROM chat_messages');
  const firsts = [students.first, messages.first].filter((v) => v !== null && v !== undefined).map(Number);
  return firsts.length ? Math.min(...firsts) : null;
}

/**
 * 대시보드 지표의 추이(GET /api/admin/stats/trend?range=) — 신규 가입·챗봇 질문·근거 못 찾은 답변을 구간별로 센다.
 * - 24h: 1시간 단위 24칸(현재 시각이 든 시가 마지막). 30d·1y: 하루 단위 30·365칸(오늘이 마지막). all: 가장 오래된 기록부터 오늘까지 하루 단위.
 * - 모두 오래된 순이고, 기록이 없는 구간은 0이다. 구간 경계는 에포크 초를 단위로 나눠 구해서 DB 서버의 시간대와 무관하다(일 단위는 KST 기준).
 * - 점의 at: 시간 단위면 구간 시작 시각(ISO), 일 단위면 한국 날짜 'YYYY-MM-DD'.
 * - 한계: 탈퇴한 계정의 가입·챗봇 기록은 계정과 함께 지워지므로 과거 값에서 빠진다.
 * - 활성 사용자는 시간대별로 남아 있는 기록이 없어(student_activity는 마지막 접속 시각 하나뿐) 여기서 다루지 않는다.
 * now는 테스트에서 시각을 고정하려고 받는다(밀리초).
 */
async function getTrend(range, now = Date.now()) {
  const { unit, count } = TREND_RANGES[range];
  const unitSeconds = unit === 'hour' ? HOUR_SECONDS : DAY_SECONDS;
  const offset = unit === 'hour' ? 0 : KST_OFFSET_SECONDS;
  const nowSeconds = Math.floor(now / 1000);
  const endIndex = Math.floor((nowSeconds + offset) / unitSeconds);

  let bucketCount = count;
  if (bucketCount === null) {
    const first = await firstRecordEpoch();
    const spanDays = first === null ? ALL_MIN_DAYS : endIndex - Math.floor((first + offset) / unitSeconds) + 1;
    bucketCount = Math.min(Math.max(spanDays, ALL_MIN_DAYS), ALL_MAX_DAYS);
  }
  const startIndex = endIndex - (bucketCount - 1);
  const startEpoch = startIndex * unitSeconds - offset;

  const byBucket = async (sql, params = []) => {
    const [rows] = await pool.query(sql, [...params, startEpoch]);
    return new Map(rows.map((row) => [Number(row.bucket), Number(row.count)]));
  };
  const bucketed = (table, column, extraWhere = '') =>
    `SELECT (UNIX_TIMESTAMP(${column}) + ${offset}) DIV ${unitSeconds} AS bucket, COUNT(*) AS count
     FROM ${table} WHERE ${extraWhere}${column} >= FROM_UNIXTIME(?) GROUP BY bucket`;

  const [signups, chatQuestions, chatNotFound] = await Promise.all([
    byBucket(bucketed('students', 'created_at')),
    byBucket(bucketed('chat_messages', 'created_at', "role = 'user' AND ")),
    byBucket(bucketed('chat_messages', 'created_at', "role = 'assistant' AND content IN (?, ?) AND "), [NOT_FOUND_MESSAGE, NOT_FOUND_MESSAGE_EN]),
  ]);

  const points = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    // 일 단위 인덱스는 KST로 민 에포크라, UTC로 읽으면 그대로 한국 날짜가 된다.
    const at = unit === 'hour' ? new Date(index * unitSeconds * 1000).toISOString() : new Date(index * unitSeconds * 1000).toISOString().slice(0, 10);
    points.push({
      at,
      signups: signups.get(index) ?? 0,
      chatQuestions: chatQuestions.get(index) ?? 0,
      chatNotFound: chatNotFound.get(index) ?? 0,
    });
  }
  return { range, unit, generatedAt: new Date(now).toISOString(), points };
}

module.exports = { getDashboardStats, getTrend, isTrendRange };
