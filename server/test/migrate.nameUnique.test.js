const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { ensureNameUniqueConstraint } = require('../../db/migrate');

/**
 * server/test/migrate.nameUnique.test.js
 * 닉네임 UNIQUE 제약 가드가 중복 닉네임 값을 로그에 남기지 않는지 확인한다(#378).
 * 이 로그는 재시딩 크론을 거쳐 공개 저장소의 GitHub Actions 로그에 남는다. DB 없이 가짜 연결로 돈다.
 */

// 쿼리 순서대로 결과를 돌려주는 가짜 연결. ALTER가 실행됐는지도 기록한다.
function fakeConnection(results) {
  const queries = [];
  return {
    queries,
    query: async (sql) => {
      queries.push(sql);
      return [results.shift() || []];
    },
  };
}

test('중복 닉네임이 있으면 제약을 건너뛰고, 로그에는 개수만 남기고 닉네임 값은 남기지 않는다', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    const conn = fakeConnection([[], [{ name: '홍길동', count: 2 }, { name: 'dup2', count: 3 }]]);
    await ensureNameUniqueConstraint(conn);
    const logged = warn.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
    assert.match(logged, /중복이 2개/);
    assert.doesNotMatch(logged, /홍길동|dup2/);
    assert.ok(!conn.queries.some((q) => /ALTER TABLE/.test(q)), '중복이 있으면 제약을 추가하지 않는다');
  } finally {
    warn.mock.restore();
  }
});

test('중복이 없으면 제약을 추가하고, 이미 있으면 아무것도 하지 않는다', async () => {
  const log = mock.method(console, 'log', () => {});
  try {
    const noDupes = fakeConnection([[], []]);
    await ensureNameUniqueConstraint(noDupes);
    assert.ok(noDupes.queries.some((q) => /ADD CONSTRAINT uq_students_name/.test(q)));

    const already = fakeConnection([[{ 1: 1 }]]);
    await ensureNameUniqueConstraint(already);
    assert.equal(already.queries.length, 1, '제약이 이미 있으면 중복 조회도 하지 않는다');
  } finally {
    log.mock.restore();
  }
});
