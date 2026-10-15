const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * server/test/scrapeTimetable.blocked.test.js
 * 학교가 학교 사이트 자동 접근을 허락하지 않았으므로(교육혁신과 답변 2026-10-14, C-4) 시간표 수집 스크립트는
 * 실행해도 요청을 보내지 않고 멈춰야 한다. 가드가 빠져도 실제 학교 서버로 요청이 나가거나 원본 JSON이 덮어써지지 않도록,
 * fetch를 "호출되면 표시를 남기고 프로세스를 바로 끝내는" 가짜로 바꾼 채 실행한다.
 */

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'scrapeTimetable.js');
const STUB_FETCH = "globalThis.fetch = () => { process.stderr.write('FETCH_CALLED'); process.exit(2); };";

test('scrape:timetable은 학교 서버에 요청하지 않고 실패 코드로 멈춘다', () => {
  const result = spawnSync(process.execPath, ['-e', `${STUB_FETCH} require(${JSON.stringify(SCRIPT)});`], { encoding: 'utf8', timeout: 10000 });
  assert.ok(!result.stderr.includes('FETCH_CALLED'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /실행하지 않습니다/);
});
