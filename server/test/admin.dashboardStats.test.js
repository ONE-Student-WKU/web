const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { getDashboardStats } = require('../services/adminStatsService');
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
      if (sql.includes('INTERVAL 5 MINUTE')) return 1;
      if (sql.includes('FROM student_activity')) return 15;
      throw new Error(`예상 밖 쿼리: ${sql}`);
    })();
    return [[{ count: n }]];
  });

  const stats = await getDashboardStats();
  assert.deepEqual(stats, {
    activeSessions: 1,
    pending: { reports: 4, inquiries: 2, posts: 7 },
    last24h: { signups: 3, chatQuestions: 120, chatNotFound: 9, activeStudents: 15 },
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
