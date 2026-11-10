const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { getDashboardStats, getTrend, isTrendRange, listAll, getUsageDepth, isUsageScope, buildUsageDepth, rateOf, median } = require('../services/adminStatsService');
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

  const { last14d, ...stats } = await getDashboardStats();
  assert.deepEqual(stats, {
    activeSessions: 1,
    pending: { reports: 4, inquiries: 2, posts: 7 },
    last24h: { signups: 3, chatQuestions: 120, chatNotFound: 9, activeStudents: 15 },
    // 그 전 24시간도 같은 표에서 센다(mock은 SQL 조각으로 골라 같은 값을 준다)
    previous24h: { signups: 3, chatQuestions: 120, chatNotFound: 9 },
    last7d: { visitors: 40, previousVisitors: 10 },
    weeklyReturn: { previous: 10, returned: 4 },
  });
  assert.equal(last14d.daily.length, 14);
  // 신고는 같은 글·신청에 들어온 신고를 한 건으로 세고, 어제 비교는 24~48시간 전 구간이다
  assert.match(calls.find((c) => c.sql.includes('FROM community_reports')).sql, /COUNT\(DISTINCT target_type, target_id\)/);
  assert.ok(calls.some((c) => c.sql.includes("role = 'user'") && /INTERVAL 48 HOUR AND created_at <= NOW\(\) - INTERVAL 24 HOUR/.test(c.sql)));

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
    if (sql.includes('FROM student_activity')) return [[{ count: uniqueVisitors }]];
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
    if (sql.includes('HAVING MIN(visit_date)')) {
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
  // 날마다의 방문자는 최근 14일 기록과 그 전 날짜별 합계를 합치고, 기간 전체 방문자는 마지막 접속 시각으로 센다
  const visitCalls = calls.filter((c) => c.sql.includes('student_daily_visits'));
  for (const c of visitCalls) assert.match(c.sql, /UNION ALL SELECT visit_date, visitors FROM daily_visit_counts/);
  // 지금 기간은 끝 없이, 바로 앞 7일은 지금 기간 첫날 전까지
  assert.deepEqual(visitCalls.map((c) => c.params), [['2026-10-07', '2026-10-07'], ['2026-09-30', '2026-10-07', '2026-09-30', '2026-10-07']]);
  assert.equal(trend.previous.points.length, 7);
  assert.equal(trend.previous.points[0].at, '2026-09-30');
  assert.deepEqual(calls.find((c) => c.sql.includes('FROM student_activity')).params, [Date.UTC(2026, 9, 7) / 1000 - 9 * 3600]);
});

test('학과·학번별 사용자: 인원이 적은 칸도 묶지 않고 모두 보여준다(0명 칸만 뺀다)', () => {
  const listed = listAll([{ name: '경영학부', count: 12 }, { name: '간호학과', count: '5' }, { name: '건축학과', count: 2 }, { name: '음악과', count: 1 }, { name: '빈 학과', count: 0 }]);
  assert.deepEqual(listed.rows, [{ name: '경영학부', count: 12 }, { name: '간호학과', count: 5 }, { name: '건축학과', count: 2 }, { name: '음악과', count: 1 }]);
  assert.equal(listed.total, 20);
  assert.equal('other' in listed, false);
});

test('사용 깊이: 비율은 가입자 대비 정수 %이고, 가입자가 없으면 null이다', () => {
  assert.equal(rateOf(1, 3), 33);
  assert.equal(rateOf(2, 3), 67);
  assert.equal(rateOf(0, 10), 0);
  assert.equal(rateOf(5, 5), 100);
  assert.equal(rateOf(0, 0), null);
});

test('사용 깊이: 과목 수 중앙값은 가운데 값, 짝수 개면 가운데 두 값의 평균이다', () => {
  assert.equal(median([]), null);
  assert.equal(median([7]), 7);
  assert.equal(median([40, 3, 12]), 12);
  assert.equal(median(['10', 2, 30, 4]), 7);
});

test('사용 깊이: 셈한 학생 수를 { count, rate } 모양으로 묶는다(분모는 모두 가입자)', () => {
  const depth = buildUsageDepth({
    signups: 20,
    onboarded: 16,
    withCourses: 10,
    courseCounts: [1, 30, 12, 8],
    pdfImport: 5,
    chat: '9',
    career: { started: 6, answered: 5, talked: 3, recommended: 2, confirmed: 1 },
  });
  assert.equal(depth.signups, 20);
  assert.deepEqual(depth.onboarded, { count: 16, rate: 80 });
  assert.deepEqual(depth.features, { courses: { count: 10, rate: 50 }, chat: { count: 9, rate: 45 }, career: { count: 6, rate: 30 } });
  assert.deepEqual(depth.career.confirmed, { count: 1, rate: 5 });
  assert.deepEqual(depth.depth, { courseMedian: 10, pdfImport: { count: 5, rate: 25 } });

  const empty = buildUsageDepth({ signups: 0 });
  assert.deepEqual(empty.onboarded, { count: 0, rate: null });
  assert.equal(empty.depth.courseMedian, null);
});

test('사용 깊이: 관리자를 빼고 세며, 최근 30일 가입자는 가입 시각으로 거른다', async () => {
  const calls = [];
  mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM student_courses')) return [[{ n: 3 }, { n: '11' }, { n: 20 }]];
    if (sql.includes('FROM career_sessions')) return [[{ started: 4, answered: '4', talked: '2', recommended: 1, confirmed: 0 }]];
    if (sql.includes('FROM pdf_import_logs')) return [[{ count: 2 }]];
    if (sql.includes('FROM chat_conversations')) return [[{ count: 7 }]];
    if (sql.includes('onboarding_completed_at IS NOT NULL')) return [[{ count: 9 }]];
    if (sql.includes('FROM students s')) return [[{ count: 10 }]];
    throw new Error(`예상 밖 쿼리: ${sql}`);
  });

  const all = await getUsageDepth('all');
  assert.equal(all.scope, 'all');
  assert.equal(all.signups, 10);
  assert.deepEqual(all.onboarded, { count: 9, rate: 90 });
  assert.deepEqual(all.features.courses, { count: 3, rate: 30 });
  assert.deepEqual(all.features.chat, { count: 7, rate: 70 });
  assert.deepEqual(all.career.talked, { count: 2, rate: 20 });
  assert.equal(all.depth.courseMedian, 11);
  for (const c of calls) {
    assert.match(c.sql, /s\.role <> 'admin'/);
    assert.doesNotMatch(c.sql, /INTERVAL 30 DAY/);
  }
  // 챗봇은 학생이 보낸 메시지가 있어야 세고, 진로 단계는 고정 질문 수(5)를 기준으로 나눈다
  assert.match(calls.find((c) => c.sql.includes('FROM chat_conversations')).sql, /m\.role = 'user'/);
  assert.deepEqual(calls.find((c) => c.sql.includes('FROM career_sessions')).params, [5, 5]);

  calls.length = 0;
  await getUsageDepth('recent30d');
  assert.equal(calls.length, 6);
  for (const c of calls) assert.match(c.sql, /s\.created_at > NOW\(\) - INTERVAL 30 DAY/);
});

test('사용 깊이: 허용된 scope만 통과한다', () => {
  for (const ok of ['all', 'recent30d']) assert.equal(isUsageScope(ok), true);
  for (const bad of ['30d', '', 'toString', '__proto__', undefined]) assert.equal(isUsageScope(bad), false);
});
