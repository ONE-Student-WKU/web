const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { getDashboardStats, getTrend, isTrendRange, groupSmall } = require('../services/adminStatsService');
const { NOT_FOUND_MESSAGE, NOT_FOUND_MESSAGE_EN } = require('../services/chatConstants');

/**
 * server/test/admin.dashboardStats.test.js
 * 관리자 대시보드 집계(adminStatsService): 처리 대기 건수(뱃지)와 최근 24시간 운영 지표가 올바른 조건으로 세어지고,
 * "근거 못 찾은 답변"이 챗봇이 실제로 저장하는 고정 문구(chatConstants)와 같은 값으로 집계되는지 본다. DB는 mock.
 */

afterEach(() => mock.restoreAll());

test('각 지표를 알맞은 조건으로 세어 묶어서 돌려준다', async () => {
  const calls = [];
  mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    const n = (() => {
      if (sql.includes('FROM community_reports')) return 4;
      if (sql.includes('FROM inquiries')) return 2;
      if (sql.includes('FROM community_posts')) return 7;
      if (sql.includes('FROM students')) return 3;
      if (sql.includes("role = 'user'")) return 120;
      if (sql.includes("role = 'assistant'")) return 9;
      if (sql.includes('student_daily_visits')) return null;
      if (sql.includes('INTERVAL 5 MINUTE')) return 1;
      if (sql.includes('INTERVAL 7 DAY')) return 40;
      if (sql.includes('FROM student_activity')) return 15;
      throw new Error(`예상 밖 쿼리: ${sql}`);
    })();
    if (n === null) return [[{ previous: 10, returned: '4' }]];
    return [[{ count: n }]];
  });

  const stats = await getDashboardStats();
  assert.deepEqual(stats, {
    activeSessions: 1,
    pending: { reports: 4, inquiries: 2, posts: 7 },
    last24h: { signups: 3, chatQuestions: 120, chatNotFound: 9, activeStudents: 15 },
    last7d: { visitors: 40 },
    weeklyReturn: { previous: 10, returned: 4 },
  });

  // 처리 대기는 상태 값으로, 운영 지표는 24시간 구간으로 센다
  const sqlOf = (frag) => calls.find((c) => c.sql.includes(frag)).sql;
  assert.match(sqlOf('FROM community_reports'), /status = 'pending'/);
  assert.match(sqlOf('FROM inquiries'), /status = 'open'/);
  assert.match(sqlOf('FROM community_posts'), /status = 'pending'/);
  assert.match(sqlOf("role = 'user'"), /INTERVAL 24 HOUR/);
});

test('근거 못 찾은 답변은 챗봇이 저장하는 한국어·영어 고정 문구로 센다', async () => {
  let notFoundParams;
  mock.method(pool, 'query', async (sql, params) => {
    if (sql.includes('content IN')) notFoundParams = params;
    return [[{ count: 0 }]];
  });
  await getDashboardStats();
  assert.deepEqual(notFoundParams, [NOT_FOUND_MESSAGE, NOT_FOUND_MESSAGE_EN]);
});

test('COUNT 결과가 문자열로 와도 숫자로 돌려준다', async () => {
  mock.method(pool, 'query', async () => [[{ count: '5' }]]);
  const stats = await getDashboardStats();
  assert.equal(stats.pending.reports, 5);
  assert.equal(typeof stats.last24h.chatQuestions, 'number');
});

// 쿼리 mock: 구간별 결과를 SQL 조각으로 골라 준다.
function mockTrendQueries({ students = [], user = [], notFound = [], visits = [], uniqueVisitors = 0, firstStudent = null, firstMessage = null } = {}) {
  const calls = [];
  mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('MIN(created_at)')) return [[{ first: sql.includes('FROM students') ? firstStudent : firstMessage }]];
    if (sql.includes('COUNT(DISTINCT student_id)')) return [[{ count: uniqueVisitors }]];
    if (sql.includes('FROM student_daily_visits')) return [visits];
    if (sql.includes('FROM students')) return [students];
    if (sql.includes("role = 'user'")) return [user];
    if (sql.includes("role = 'assistant'")) return [notFound];
    throw new Error(`예상 밖 쿼리: ${sql}`);
  });
  return calls;
}

test('24시간 추이: 현재 시를 마지막으로 하는 24개 구간을 오래된 순으로 만들고, 빈 시간은 0으로 채운다', async () => {
  const now = Date.UTC(2026, 9, 12, 5, 30); // 05:30 UTC → 마지막 구간은 05:00
  const hourIndex = (h) => Math.floor(Date.UTC(2026, 9, 12, h) / 1000 / 3600);
  const calls = mockTrendQueries({
    students: [{ bucket: hourIndex(5), count: 2 }],
    user: [{ bucket: String(hourIndex(4)), count: '7' }, { bucket: hourIndex(5), count: 3 }], // 문자열 결과도 숫자로
    notFound: [{ bucket: hourIndex(0) - 5, count: 1 }],
  });

  const trend = await getTrend('24h', now);
  assert.equal(trend.range, '24h');
  assert.equal(trend.unit, 'hour');
  assert.equal(trend.generatedAt, new Date(now).toISOString());
  assert.equal(trend.points.length, 24);
  assert.equal(trend.points[0].at, '2026-10-11T06:00:00.000Z');
  // 방문자는 시간대별 기록이 없어 24시간에서는 null이고, 방문 기록 쿼리도 하지 않는다
  assert.deepEqual(trend.points[23], { at: '2026-10-12T05:00:00.000Z', signups: 2, chatQuestions: 3, chatNotFound: 0, visitors: null });
  assert.deepEqual(trend.points[22], { at: '2026-10-12T04:00:00.000Z', signups: 0, chatQuestions: 7, chatNotFound: 0, visitors: null });
  assert.equal(trend.uniqueVisitors, null);
  assert.ok(!calls.some((c) => c.sql.includes('student_daily_visits')));
  assert.equal(trend.points.find((p) => p.at === '2026-10-11T19:00:00.000Z').chatNotFound, 1);

  // 모든 쿼리가 같은 시작 시각(에포크 초)을 마지막 인자로 받는다
  const startEpoch = Math.floor(Date.UTC(2026, 9, 11, 6) / 1000);
  for (const c of calls) assert.equal(c.params[c.params.length - 1], startEpoch);
});

test('30일 추이: 오늘을 마지막으로 하는 30일을 한국 날짜로 만든다(UTC 오후는 한국의 다음 날)', async () => {
  // 2026-10-12 16:00 UTC = 한국 2026-10-13 01:00 → 오늘은 10/13
  const now = Date.UTC(2026, 9, 12, 16, 0);
  const kstDayIndex = (y, m, d) => Math.floor(Date.UTC(y, m, d) / 1000 / 86400);
  const calls = mockTrendQueries({
    students: [{ bucket: kstDayIndex(2026, 9, 13), count: 4 }],
    user: [{ bucket: kstDayIndex(2026, 9, 12), count: 9 }],
  });

  const trend = await getTrend('30d', now);
  assert.equal(trend.unit, 'day');
  assert.equal(trend.points.length, 30);
  assert.equal(trend.points[29].at, '2026-10-13');
  assert.equal(trend.points[0].at, '2026-09-14');
  assert.equal(trend.points[29].signups, 4);
  assert.equal(trend.points[28].chatQuestions, 9);
  assert.equal(trend.points[28].at, '2026-10-12');

  // 일 단위 버킷은 KST(+9h)로 밀어서 나누고, 시작 시각은 30일 전 한국 자정이다
  assert.match(calls[0].sql, /\+ 32400\) DIV 86400/);
  const startEpoch = Date.UTC(2026, 8, 14) / 1000 - 9 * 3600;
  for (const c of calls.filter((c) => !c.sql.includes('student_daily_visits'))) assert.equal(c.params[c.params.length - 1], startEpoch);
});

test('1년 추이는 365일이다', async () => {
  mockTrendQueries();
  const trend = await getTrend('1y', Date.UTC(2026, 9, 12, 5, 30));
  assert.equal(trend.points.length, 365);
  assert.equal(trend.points[364].at, '2026-10-12');
  assert.equal(trend.points[0].at, '2025-10-13');
  assert.ok(trend.points.every((p) => p.signups === 0 && p.chatQuestions === 0 && p.chatNotFound === 0));
});

test('전체 추이: 가장 오래된 기록의 날(KST)부터 오늘까지다', async () => {
  const now = Date.UTC(2026, 9, 12, 5, 30);
  // 가입은 2026-09-20 00:30 UTC(한국 09:30), 챗봇은 2026-10-01 → 더 오래된 가입일부터
  mockTrendQueries({ firstStudent: Date.UTC(2026, 8, 20, 0, 30) / 1000, firstMessage: Date.UTC(2026, 9, 1) / 1000 });
  const trend = await getTrend('all', now);
  assert.equal(trend.points[0].at, '2026-09-20');
  assert.equal(trend.points[trend.points.length - 1].at, '2026-10-12');
  assert.equal(trend.points.length, 23);
});

test('전체 추이: 기록이 없거나 아주 짧으면 최소 7일, 아주 길면 5년(1825일)까지만 돌려준다', async () => {
  const now = Date.UTC(2026, 9, 12, 5, 30);
  mock.method(pool, 'query', async (sql) => {
    if (sql.includes('MIN(created_at)')) return [[{ first: null }]];
    return [[]];
  });
  assert.equal((await getTrend('all', now)).points.length, 7);
  mock.restoreAll();

  mockTrendQueries({ firstStudent: Date.UTC(2020, 0, 1) / 1000 });
  assert.equal((await getTrend('all', now)).points.length, 1825);
  mock.restoreAll();

  mockTrendQueries({ firstMessage: Date.UTC(2026, 9, 12, 1) / 1000 }); // 오늘 처음 생김
  assert.equal((await getTrend('all', now)).points.length, 7);
});

test('추이: 근거 못 찾은 답변은 한국어·영어 고정 문구로 센다', async () => {
  const calls = mockTrendQueries();
  await getTrend('24h', Date.UTC(2026, 9, 12, 5, 30));
  const notFoundCall = calls.find((c) => c.sql.includes('content IN'));
  assert.deepEqual(notFoundCall.params.slice(0, 2), [NOT_FOUND_MESSAGE, NOT_FOUND_MESSAGE_EN]);
});

test('허용된 range만 통과한다', () => {
  for (const ok of ['24h', '7d', '30d', '1y', 'all']) assert.equal(isTrendRange(ok), true);
  for (const bad of ['14d', '', 'toString', '__proto__', undefined]) assert.equal(isTrendRange(bad), false);
});

test('주간 재방문: 지난주(8~14일 전) 방문자 중 이번 주(최근 7일)에도 온 사람을 한국 날짜로 센다', async () => {
  let call;
  mock.method(pool, 'query', async (sql, params) => {
    if (sql.includes('student_daily_visits')) {
      call = { sql, params };
      return [[{ previous: '12', returned: null }]];
    }
    return [[{ count: 0 }]];
  });
  // 2026-10-12 16:00 UTC = 한국 2026-10-13 → 이번 주 10/07~10/13, 지난주 09/30~10/06
  const stats = await getDashboardStats(Date.UTC(2026, 9, 12, 16, 0));
  assert.deepEqual(call.params, ['2026-10-07', '2026-09-30', '2026-10-07']);
  assert.deepEqual(stats.weeklyReturn, { previous: 12, returned: 0 });
});

test('7일 추이: 오늘까지 7일이고, 방문자는 하루 방문 기록으로 날마다 세며 기간 전체 방문자는 따로 센다', async () => {
  const now = Date.UTC(2026, 9, 12, 16, 0); // 한국 10/13
  const dayIndex = (y, m, d) => Math.floor(Date.UTC(y, m, d) / 1000 / 86400);
  const calls = mockTrendQueries({ visits: [{ bucket: dayIndex(2026, 9, 13), count: 5 }, { bucket: String(dayIndex(2026, 9, 10)), count: '3' }], uniqueVisitors: '6' });
  const trend = await getTrend('7d', now);
  assert.equal(trend.points.length, 7);
  assert.equal(trend.points[0].at, '2026-10-07');
  assert.equal(trend.points[6].visitors, 5);
  assert.equal(trend.points.find((p) => p.at === '2026-10-10').visitors, 3);
  assert.equal(trend.points[1].visitors, 0);
  assert.equal(trend.uniqueVisitors, 6);
  for (const c of calls.filter((c) => c.sql.includes('student_daily_visits'))) assert.deepEqual(c.params, ['2026-10-07']);
});

test('학과·학번별 사용자: 5명 미만인 칸은 이름 없이 기타로 묶는다', () => {
  const grouped = groupSmall([{ name: '경영학부', count: 12 }, { name: '간호학과', count: '5' }, { name: '건축학과', count: 2 }, { name: '음악과', count: 1 }, { name: '빈 학과', count: 0 }]);
  assert.deepEqual(grouped.rows, [{ name: '경영학부', count: 12 }, { name: '간호학과', count: 5 }]);
  assert.deepEqual(grouped.other, { groups: 2, count: 3 });
  assert.equal(grouped.total, 20);
  assert.equal(groupSmall([{ name: 'A', count: 9 }]).other, null);
});
