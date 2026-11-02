const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkReleaseDataUpdates, todayKst } = require('../../scripts/ci/check-release-data-updates');

/**
 * server/test/ci.releaseDataUpdates.test.js
 * main 릴리스 PR의 갱신 기록 검사(scripts/ci/check-release-data-updates.js). develop에서 미리 적은 날짜가 릴리스 때 이미 지나 있으면
 * 실패하고(#485: 10-29로 적고 11-03 반영), 진단 결과를 바꿀 수 있는 파일이 바뀌었는데 새 기록이 없으면 경고만 한다.
 */

const OLD = { date: '2026-10-28', note: '이미 운영에 있는 기록' };

test('이번 릴리스로 새로 들어가는 기록의 날짜가 오늘보다 앞서면 실패한다', () => {
  const r = checkReleaseDataUpdates({ base: [OLD], head: [OLD, { date: '2026-10-29', note: '모델링 점검' }], today: '2026-11-02' });
  assert.equal(r.added.length, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /이미 지난 날짜예요: 2026-10-29 < 오늘 2026-11-02/);
});

test('오늘이나 앞으로의 반영일이면 통과하고, 이미 운영에 있는 옛 기록은 보지 않는다', () => {
  for (const date of ['2026-11-02', '2026-11-03']) {
    const r = checkReleaseDataUpdates({ base: [OLD], head: [OLD, { date, note: '모델링 점검' }], today: '2026-11-02' });
    assert.deepEqual(r.errors, [], date);
  }
});

test('날짜만 고친 기록도 새 기록으로 보고 다시 검사한다', () => {
  const r = checkReleaseDataUpdates({ base: [OLD], head: [{ ...OLD, date: '2026-10-30' }], today: '2026-11-02' });
  assert.equal(r.errors.length, 1);
});

test('날짜 형식이 틀리면 실패한다', () => {
  const r = checkReleaseDataUpdates({ base: [], head: [{ date: '2026-11-3', note: '형식' }], today: '2026-11-02' });
  assert.match(r.errors[0], /형식/);
});

test('진단 결과를 바꿀 수 있는 파일이 바뀌었는데 새 기록이 없으면 경고만 한다', () => {
  const changedFiles = ['server/services/regulationEngine/evaluate.js', 'client/src/App.css'];
  const r = checkReleaseDataUpdates({ base: [OLD], head: [OLD], today: '2026-11-02', changedFiles });
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /regulationEngine\/evaluate\.js/);
  // 화면 파일만 바뀌면 경고하지 않는다
  assert.deepEqual(checkReleaseDataUpdates({ base: [OLD], head: [OLD], today: '2026-11-02', changedFiles: ['client/src/App.css'] }).warnings, []);
});

test('오늘은 한국 시간으로 계산한다', () => {
  assert.equal(todayKst(new Date('2026-11-02T15:30:00Z')), '2026-11-03'); // KST 00:30
  assert.equal(todayKst(new Date('2026-11-02T14:59:00Z')), '2026-11-02'); // KST 23:59
});
