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
 * - previous24h: 그 전 24시간(24~48시간 전)의 같은 지표 — 첫 화면에서 "어제"와 비교한다.
 * - last14d: 최근 14일(오늘 포함) 날마다의 방문자 수와 방문 기록이 시작된 날 — 첫 화면의 작은 막대와 "지난주보다" 비교에 쓴다.
 */
async function count(sql, params = []) {
  const [[row]] = await pool.query(sql, params);
  return Number(row.count);
}

// 한국 날짜 'YYYY-MM-DD'에 days를 더한 날짜(일 단위 인덱스로 계산해 서버 시간대와 무관하다).
function kstDateOffset(nowMs, days) {
  const dayIndex = Math.floor((Math.floor(nowMs / 1000) + KST_OFFSET_SECONDS) / DAY_SECONDS) + days;
  return new Date(dayIndex * DAY_SECONDS * 1000).toISOString().slice(0, 10);
}

/**
 * 주간 재방문 — 지난주(8~14일 전, 한국 날짜) 방문자 중 이번 주(최근 7일)에도 온 사람 수(student_daily_visits).
 * 방문 기록을 쌓기 시작한 지 2주가 안 됐으면 previous가 0이라 화면은 비율 대신 "—"를 보여준다.
 */
async function getWeeklyReturn(now = Date.now()) {
  const thisWeekStart = kstDateOffset(now, -6);
  const lastWeekStart = kstDateOffset(now, -13);
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS previous, COALESCE(SUM(t.returned), 0) AS returned
     FROM (SELECT student_id, MAX(visit_date >= ?) AS returned
           FROM student_daily_visits WHERE visit_date >= ?
           GROUP BY student_id HAVING MIN(visit_date) < ?) t`,
    [thisWeekStart, lastWeekStart, thisWeekStart]
  );
  return { previous: Number(row.previous), returned: Number(row.returned) };
}

/**
 * 처리할 일 건수 — 대시보드 뱃지와 계정 메뉴의 빨간 점(GET /api/admin/pending). 신고는 같은 글·신청에 들어온 신고를 한 건으로 센다
 * (관리자 신고함이 대상별로 묶어 보여주고 한 번에 처리한다).
 */
async function getPendingCounts() {
  const [reports, inquiries, posts] = await Promise.all([
    count("SELECT COUNT(DISTINCT target_type, target_id) AS count FROM community_reports WHERE status = 'pending'"),
    count("SELECT COUNT(*) AS count FROM inquiries WHERE status = 'open'"),
    count("SELECT COUNT(*) AS count FROM community_posts WHERE status = 'pending'"),
  ]);
  return { reports, inquiries, posts, total: reports + inquiries + posts };
}

// 날마다의 방문자 수(한국 날짜 → 명) — 최근 14일은 학생별 기록을 세고, 그 전은 날짜별 합계를 더한다(visitStatsService.js).
// endDate(제외)를 주면 그 전날까지만 센다. 열쇠는 1970-01-01부터 센 날 수(일 단위 구간 인덱스)다.
async function dailyVisitors(startDate, endDate = null) {
  const upper = endDate ? ' AND visit_date < ?' : '';
  const [rows] = await pool.query(
    `SELECT DATEDIFF(visit_date, '1970-01-01') AS bucket, SUM(visitors) AS count
     FROM (SELECT visit_date, COUNT(*) AS visitors FROM student_daily_visits WHERE visit_date >= ?${upper} GROUP BY visit_date
           UNION ALL SELECT visit_date, visitors FROM daily_visit_counts WHERE visit_date >= ?${upper}) v
     GROUP BY bucket`,
    endDate ? [startDate, endDate, startDate, endDate] : [startDate, startDate]
  );
  return new Map(rows.map((row) => [Number(row.bucket), Number(row.count)]));
}

// 방문 기록이 시작된 날(한국 날짜, 기록이 없으면 null) — "지난주보다" 비교는 지난주가 다 기록된 뒤에만 보여준다.
async function firstVisitDate() {
  const [[row]] = await pool.query(
    `SELECT DATE_FORMAT(LEAST(COALESCE((SELECT MIN(visit_date) FROM student_daily_visits), '9999-12-31'),
                              COALESCE((SELECT MIN(visit_date) FROM daily_visit_counts), '9999-12-31')), '%Y-%m-%d') AS first`
  );
  return row?.first && row.first !== '9999-12-31' ? row.first : null;
}

const PREVIOUS_24H = 'created_at > NOW() - INTERVAL 48 HOUR AND created_at <= NOW() - INTERVAL 24 HOUR';

async function getDashboardStats(now = Date.now()) {
  const last14Start = kstDateOffset(now, -13);
  const [
    activeSessions,
    pending,
    signups,
    chatQuestions,
    chatNotFound,
    activeStudents,
    visitors7d,
    weeklyReturn,
    prevSignups,
    prevChatQuestions,
    prevChatNotFound,
    visitsByDay,
    visitsSince,
  ] = await Promise.all([
    count('SELECT COUNT(*) AS count FROM student_activity WHERE last_seen_at > NOW() - INTERVAL 5 MINUTE'),
    getPendingCounts(),
    count('SELECT COUNT(*) AS count FROM students WHERE created_at > NOW() - INTERVAL 24 HOUR'),
    count("SELECT COUNT(*) AS count FROM chat_messages WHERE role = 'user' AND created_at > NOW() - INTERVAL 24 HOUR"),
    count(
      "SELECT COUNT(*) AS count FROM chat_messages WHERE role = 'assistant' AND content IN (?, ?) AND created_at > NOW() - INTERVAL 24 HOUR",
      [NOT_FOUND_MESSAGE, NOT_FOUND_MESSAGE_EN]
    ),
    count('SELECT COUNT(*) AS count FROM student_activity WHERE last_seen_at > NOW() - INTERVAL 24 HOUR'),
    // 최근 7일 방문자는 마지막 접속 시각으로도 셀 수 있어(7일 안에 한 번이라도 왔으면 마지막 접속도 7일 안이다) 방문 기록 표가 없던 기간도 맞다.
    count('SELECT COUNT(*) AS count FROM student_activity WHERE last_seen_at > NOW() - INTERVAL 7 DAY'),
    getWeeklyReturn(now),
    count(`SELECT COUNT(*) AS count FROM students WHERE ${PREVIOUS_24H}`),
    count(`SELECT COUNT(*) AS count FROM chat_messages WHERE role = 'user' AND ${PREVIOUS_24H}`),
    count(`SELECT COUNT(*) AS count FROM chat_messages WHERE role = 'assistant' AND content IN (?, ?) AND ${PREVIOUS_24H}`, [NOT_FOUND_MESSAGE, NOT_FOUND_MESSAGE_EN]),
    dailyVisitors(last14Start),
    firstVisitDate(),
  ]);

  const startIndex = Math.floor((Math.floor(now / 1000) + KST_OFFSET_SECONDS) / DAY_SECONDS) - 13;
  const daily = Array.from({ length: 14 }, (_, i) => ({
    at: new Date((startIndex + i) * DAY_SECONDS * 1000).toISOString().slice(0, 10),
    visitors: visitsByDay.get(startIndex + i) ?? 0,
  }));

  return {
    activeSessions,
    pending: { reports: pending.reports, inquiries: pending.inquiries, posts: pending.posts },
    last24h: { signups, chatQuestions, chatNotFound, activeStudents },
    previous24h: { signups: prevSignups, chatQuestions: prevChatQuestions, chatNotFound: prevChatNotFound },
    // previousVisitors: 지난주(8~14일 전) 한 번 이상 온 사람 수(재방문율의 분모와 같다). 방문 기록이 지난주를 다 덮을 때만 의미가 있다.
    last7d: { visitors: visitors7d, previousVisitors: weeklyReturn.previous },
    last14d: { daily, since: visitsSince },
    weeklyReturn,
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
  '7d': { unit: 'day', count: 7 },
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
 * - 방문자(visitors)는 하루 방문 기록으로 일 단위 구간에서만 센다 — 최근 14일은 student_daily_visits, 그 전은 날짜별 합계
 *   daily_visit_counts(services/visitStatsService.js). 시간대별 기록은 없어 24h는 null이다.
 * - previous: 바로 앞 같은 길이 기간의 points(전체는 null) — 화면이 옅은 선과 "그 전 기간보다" 비교로 쓴다.
 *   uniqueVisitors는 기간 동안 한 번 이상 온 사람 수(날마다의 방문자를 더하면 같은 사람이 여러 번 세진다) — 마지막 접속 시각(student_activity)으로 센다.
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

  const daily = unit === 'day';
  const epochOf = (index) => index * unitSeconds - offset;
  // 하루 방문은 한국 날짜로 저장돼 있어, 날짜를 1970-01-01부터 센 날 수가 곧 일 단위 구간 인덱스다.
  const dateOf = (index) => new Date(index * DAY_SECONDS * 1000).toISOString().slice(0, 10);

  // fromIndex부터(포함) toIndex 전까지(제외, null이면 끝 없음) 구간별 값. 지금 기간과 바로 앞 기간을 같은 쿼리로 센다.
  const collect = async (fromIndex, toIndex = null) => {
    const bounds = toIndex === null ? [epochOf(fromIndex)] : [epochOf(fromIndex), epochOf(toIndex)];
    const byBucket = async (sql, params = []) => {
      const [rows] = await pool.query(sql, [...params, ...bounds]);
      return new Map(rows.map((row) => [Number(row.bucket), Number(row.count)]));
    };
    const bucketed = (table, column, extraWhere = '') =>
      `SELECT (UNIX_TIMESTAMP(${column}) + ${offset}) DIV ${unitSeconds} AS bucket, COUNT(*) AS count
       FROM ${table} WHERE ${extraWhere}${column} >= FROM_UNIXTIME(?)${toIndex === null ? '' : ` AND ${column} < FROM_UNIXTIME(?)`} GROUP BY bucket`;
    const [signups, chatQuestions, chatNotFound, visitors] = await Promise.all([
      byBucket(bucketed('students', 'created_at')),
      byBucket(bucketed('chat_messages', 'created_at', "role = 'user' AND ")),
      byBucket(bucketed('chat_messages', 'created_at', "role = 'assistant' AND content IN (?, ?) AND "), [NOT_FOUND_MESSAGE, NOT_FOUND_MESSAGE_EN]),
      daily ? dailyVisitors(dateOf(fromIndex), toIndex === null ? null : dateOf(toIndex)) : null,
    ]);
    const points = [];
    for (let index = fromIndex; index < fromIndex + bucketCount; index += 1) {
      // 일 단위 인덱스는 KST로 민 에포크라, UTC로 읽으면 그대로 한국 날짜가 된다.
      const at = unit === 'hour' ? new Date(index * unitSeconds * 1000).toISOString() : dateOf(index);
      points.push({
        at,
        signups: signups.get(index) ?? 0,
        chatQuestions: chatQuestions.get(index) ?? 0,
        chatNotFound: chatNotFound.get(index) ?? 0,
        visitors: visitors ? visitors.get(index) ?? 0 : null,
      });
    }
    return points;
  };

  // 바로 앞 기간(같은 길이)은 "그 전 30일보다" 비교와 옅은 선에 쓴다. 전체(all)는 앞 기간이 없다.
  const [points, previousPoints, uniqueVisitors] = await Promise.all([
    collect(startIndex),
    range === 'all' ? null : collect(startIndex - bucketCount, startIndex),
    // 기간 동안 한 번 이상 온 사람 = 마지막 접속이 기간 시작 뒤인 사람(학생별 방문 기록은 14일만 남아 긴 기간은 이걸로 센다).
    daily
      ? pool.query('SELECT COUNT(*) AS count FROM student_activity WHERE last_seen_at >= FROM_UNIXTIME(?)', [startEpoch]).then(([[row]]) => Number(row?.count ?? 0))
      : null,
  ]);
  return { range, unit, generatedAt: new Date(now).toISOString(), points, previous: previousPoints ? { points: previousPoints } : null, uniqueVisitors };
}

// 학과·학번별 사용자에서 이 인원보다 적은 칸은 "기타"로 묶는다 — 학과·학번만으로 누가 쓰는지 짐작되지 않게(서버에서 묶어 작은 숫자를 내려보내지 않는다).
const MIN_GROUP_SIZE = 5;

/** [{ name, count }] → 인원이 MIN_GROUP_SIZE 이상인 칸과, 나머지를 합친 기타({ groups, count }). 순수 함수. */
function groupSmall(rows) {
  const counted = rows.map((r) => ({ name: r.name, count: Number(r.count) })).filter((r) => r.count > 0);
  const shown = counted.filter((r) => r.count >= MIN_GROUP_SIZE);
  const small = counted.filter((r) => r.count < MIN_GROUP_SIZE);
  return {
    rows: shown,
    other: small.length ? { groups: small.length, count: small.reduce((s, r) => s + r.count, 0) } : null,
    total: counted.reduce((s, r) => s + r.count, 0),
  };
}

/**
 * 학과·학번별 사용자(GET /api/admin/stats/composition) — 학교에 보여줄 이용 현황. 관리자 계정은 뺀다.
 * members: 가입자 수, visitors7d: 최근 7일 방문자 수(student_activity). 학과는 많은 순, 학번은 최근 학번부터.
 * 한계: 학과를 고르지 않은 계정은 noDepartment로 따로 세고, 옛 테스트 계정(studentService.LEGACY_TEST_ACCOUNT_COUNT)은 구분할 수 없어 섞여 있을 수 있다.
 */
async function getComposition() {
  const recent = 'JOIN student_activity a ON a.student_id = s.id AND a.last_seen_at > NOW() - INTERVAL 7 DAY';
  const byDepartment = (join = '') =>
    `SELECT d.name AS name, COUNT(*) AS count FROM students s JOIN departments d ON d.id = s.department_id ${join}
     WHERE s.role <> 'admin' GROUP BY d.id, d.name ORDER BY count DESC, d.name`;
  const byCohort = (join = '') =>
    `SELECT s.admission_year AS name, COUNT(*) AS count FROM students s ${join}
     WHERE s.role <> 'admin' AND s.admission_year IS NOT NULL GROUP BY s.admission_year ORDER BY s.admission_year DESC`;
  const [[deptMembers], [deptVisitors], [cohortMembers], [cohortVisitors], noDepartment] = await Promise.all([
    pool.query(byDepartment()),
    pool.query(byDepartment(recent)),
    pool.query(byCohort()),
    pool.query(byCohort(recent)),
    count("SELECT COUNT(*) AS count FROM students WHERE role <> 'admin' AND department_id IS NULL"),
  ]);
  return {
    minGroupSize: MIN_GROUP_SIZE,
    noDepartment,
    department: { members: groupSmall(deptMembers), visitors7d: groupSmall(deptVisitors) },
    cohort: { members: groupSmall(cohortMembers), visitors7d: groupSmall(cohortVisitors) },
  };
}

module.exports = { getDashboardStats, getPendingCounts, getTrend, isTrendRange, getComposition, groupSmall, kstDateOffset };
