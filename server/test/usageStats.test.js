const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const uiEventsRouter = require('../routes/uiEvents');
const { rollupOldVisits, retentionStart } = require('../services/visitStatsService');
const { normalizeEvents, isValidEventName, getUsage } = require('../services/uiEventService');
const { kstDate } = require('../middleware/activityTracker');

/**
 * server/test/usageStats.test.js
 * 사용 통계의 개인정보 원칙: 하루 방문 기록은 학생과 연결된 채로 14일만 남고 그 뒤로는 날짜별 합계만 남는다.
 * 기능 사용 횟수에는 학생 번호가 어디에도 저장되지 않고, 규칙에 맞는 이름만 하루 합계로 더해진다.
 * 오래된 날짜(2001년)·임시 학생을 쓰고 끝나면 지운다. 로컬 DB 전용.
 */

const run = Date.now();
const NOW = Date.UTC(2001, 4, 20, 3, 0); // 한국 2001-05-20 12:00
const OLD_DATES = ['2001-05-01', '2001-05-06']; // 14일 넘게 지난 날
const RECENT_DATE = '2001-05-07'; // 남겨 두는 가장 오래된 날(오늘 포함 14일)
let studentIds = [];
let server;
let baseUrl;
let sessionUserId;

before(async () => {
  for (const tag of ['a', 'b']) {
    const [r] = await pool.query('INSERT INTO students (email, name) VALUES (?, ?)', [`us-${tag}-${run}@example.test`, `us${tag}${run}`]);
    studentIds.push(r.insertId);
  }
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: sessionUserId };
    next();
  });
  app.use('/api/ui-events', uiEventsRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.query("DELETE FROM daily_visit_counts WHERE visit_date < '2002-01-01'");
    await pool.query("DELETE FROM ui_event_daily WHERE event LIKE 'home.test_%'");
    for (const id of studentIds) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  } finally {
    await pool.end();
  }
});

test('보관 시작일: 오늘을 포함해 14일(한국 날짜)', () => {
  assert.equal(retentionStart(NOW), RECENT_DATE);
});

test('14일이 지난 방문 기록은 날짜별 합계로 옮겨지고 학생별 기록은 지워지며, 최근 기록은 그대로 남는다', async () => {
  const [a, b] = studentIds;
  await pool.query('INSERT INTO student_daily_visits (student_id, visit_date) VALUES ?', [
    [
      [a, OLD_DATES[0]],
      [b, OLD_DATES[0]],
      [a, OLD_DATES[1]],
      [a, RECENT_DATE],
    ],
  ]);
  await pool.query('INSERT INTO daily_visit_counts (visit_date, visitors) VALUES (?, 3)', [OLD_DATES[1]]); // 이미 합계가 있던 날은 더해진다

  const moved = await rollupOldVisits(NOW);
  assert.ok(moved >= 3);
  const [left] = await pool.query("SELECT DATE_FORMAT(visit_date, '%Y-%m-%d') AS d FROM student_daily_visits WHERE student_id IN (?)", [studentIds]);
  assert.deepEqual(left.map((r) => r.d), [RECENT_DATE]);
  const [counts] = await pool.query("SELECT DATE_FORMAT(visit_date, '%Y-%m-%d') AS d, visitors FROM daily_visit_counts WHERE visit_date IN (?) ORDER BY visit_date", [OLD_DATES]);
  assert.deepEqual(counts, [{ d: OLD_DATES[0], visitors: 2 }, { d: OLD_DATES[1], visitors: 4 }]);

  // 다시 돌려도 두 번 세지지 않는다
  await rollupOldVisits(NOW);
  const [[again]] = await pool.query('SELECT visitors FROM daily_visit_counts WHERE visit_date = ?', [OLD_DATES[0]]);
  assert.equal(again.visitors, 2);
  await pool.query('DELETE FROM student_daily_visits WHERE student_id IN (?)', [studentIds]);
});

test('기능 이름: 정해진 화면으로 시작하는 화면.요소[.값]만 받는다', () => {
  for (const ok of ['home.menu.courses', 'view.home', 'career.recommend.turn_3', 'tabbar.career']) assert.equal(isValidEventName(ok), true, ok);
  for (const bad of ['home', 'unknown.button', 'Home.menu', 'home.메뉴', 'home..x', 'home.a.b.c.d', `home.${'x'.repeat(64)}`, 42, null]) assert.equal(isValidEventName(bad), false, String(bad));
});

test('요청 정리: 이상한 이름·횟수는 버리고, 횟수는 100에서 자르고, 기기 수는 오늘 처음 쓴 이름만 1', () => {
  const events = normalizeEvents({
    counts: { 'home.menu.courses': 2, 'tabbar.career': 500, 'evil.x': 3, 'home.zero': 0, 'home.text': 'abc', 'home.float': 2.7 },
    devices: ['home.menu.courses', 'not.sent'],
  });
  assert.deepEqual(events, [
    { event: 'home.menu.courses', count: 2, device: 1 },
    { event: 'tabbar.career', count: 100, device: 0 },
    { event: 'home.float', count: 2, device: 0 },
  ]);
  assert.deepEqual(normalizeEvents(null), []);
  assert.deepEqual(normalizeEvents({ counts: ['home.a'] }), []);
  const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`home.test_${i}`, 1]));
  assert.equal(normalizeEvents({ counts: many }).length, 50);
});

test('POST /api/ui-events: 로그인해야 받고, 오늘 합계에 더하며 학생 번호는 저장하지 않는다', async () => {
  const send = (body, userId = studentIds[0]) => {
    sessionUserId = userId;
    return fetch(`${baseUrl}/api/ui-events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  };
  assert.equal((await send({ counts: { 'home.test_a': 1 } }, null)).status, 401);

  assert.equal((await send({ counts: { 'home.test_a': 2, 'home.test_b': 1 }, devices: ['home.test_a'] })).status, 204);
  assert.equal((await send({ counts: { 'home.test_a': 1 }, devices: ['home.test_a'] }, studentIds[1])).status, 204);
  const [rows] = await pool.query("SELECT * FROM ui_event_daily WHERE event LIKE 'home.test_%' ORDER BY event");
  assert.deepEqual(
    rows.map((r) => ({ event: r.event, count: r.count, devices: r.devices })),
    [
      { event: 'home.test_a', count: 3, devices: 2 },
      { event: 'home.test_b', count: 1, devices: 0 },
    ]
  );
  // 표에는 날짜·이름·횟수·기기 수만 있다
  assert.deepEqual(Object.keys(rows[0]).sort(), ['count', 'devices', 'event', 'event_date']);
  assert.equal(kstDate(Date.now()), (await getUsage('7d')).to);

  const usage = await getUsage('7d');
  assert.deepEqual(
    usage.events.filter((e) => e.event.startsWith('home.test_')),
    [
      { event: 'home.test_a', count: 3, devices: 2 },
      { event: 'home.test_b', count: 1, devices: 0 },
    ]
  );
});
