const pool = require('../db');
const { kstDate } = require('../middleware/activityTracker');

/**
 * server/services/uiEventService.js
 * 기능 사용 횟수(ui_event_daily) — 화면·버튼이 하루에 몇 번 쓰였는지의 합계만 남긴다. 누가 썼는지(학생 번호), 몇 시에 썼는지,
 * 입력한 글은 받지도 저장하지도 않는다(개인정보처리방침 "기능 사용 횟수").
 *
 * 기능 이름은 '화면.요소[.값]'(영어 소문자·숫자·_). 앞부분(화면)은 아래 목록만 받는다 — 아무 이름이나 받으면 로그인한 누구나
 * 표를 끝없이 늘릴 수 있어서다. 같은 이유로 하루에 새로 생길 수 있는 이름 수도 제한한다.
 */

const SCREENS = ['view', 'home', 'tabbar', 'chat', 'courses', 'graduation', 'career', 'community', 'inquiry', 'settings', 'profile', 'onboarding', 'menu'];
const EVENT_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$/;
const MAX_EVENT_LENGTH = 64;
const MAX_EVENTS_PER_REQUEST = 50;
const MAX_COUNT_PER_EVENT = 100;
const MAX_EVENTS_PER_DAY = 1000;

function isValidEventName(name) {
  return typeof name === 'string' && name.length <= MAX_EVENT_LENGTH && EVENT_PATTERN.test(name) && SCREENS.includes(name.split('.')[0]);
}

/**
 * 요청 본문 { counts: { 이름: 횟수 }, devices: [그 기기에서 오늘 처음 쓴 이름] } → [{ event, count, device }].
 * 규칙에 맞지 않는 이름·횟수는 조용히 버린다(통계라 일부가 빠져도 괜찮고, 화면이 오류를 볼 필요도 없다). 순수 함수.
 */
function normalizeEvents(body) {
  const counts = body && typeof body.counts === 'object' && !Array.isArray(body.counts) ? body.counts : {};
  const devices = new Set(Array.isArray(body?.devices) ? body.devices : []);
  const events = [];
  for (const [event, raw] of Object.entries(counts)) {
    if (events.length >= MAX_EVENTS_PER_REQUEST) break;
    const count = Math.floor(Number(raw));
    if (!isValidEventName(event) || !Number.isFinite(count) || count < 1) continue;
    events.push({ event, count: Math.min(count, MAX_COUNT_PER_EVENT), device: devices.has(event) ? 1 : 0 });
  }
  return events;
}

/** 오늘(한국 날짜) 합계에 더한다. 하루 이름 수가 상한에 닿으면 이미 있는 이름만 더하고 새 이름은 버린다. */
async function recordEvents(events, now = Date.now()) {
  if (!events.length) return;
  const today = kstDate(now);
  const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM ui_event_daily WHERE event_date = ?', [today]);
  if (Number(count) < MAX_EVENTS_PER_DAY) {
    const rows = events.map((e) => [today, e.event, e.count, e.device]);
    await pool.query(
      'INSERT INTO ui_event_daily (event_date, event, count, devices) VALUES ? ON DUPLICATE KEY UPDATE count = count + VALUES(count), devices = devices + VALUES(devices)',
      [rows]
    );
    return;
  }
  for (const e of events) {
    await pool.query('UPDATE ui_event_daily SET count = count + ?, devices = devices + ? WHERE event_date = ? AND event = ?', [e.count, e.device, today, e.event]);
  }
}

const USAGE_RANGES = { '7d': 7, '30d': 30, all: null };

function isUsageRange(range) {
  return Object.prototype.hasOwnProperty.call(USAGE_RANGES, range);
}

/**
 * 관리자 "기능 사용"(GET /api/admin/stats/features?range=7d|30d|all) — 기간 동안의 기능별 합계, 많이 쓴 순.
 * devices는 날마다의 기기 수를 더한 값이라 같은 기기가 여러 날 쓰면 그만큼 세진다(기간 전체의 서로 다른 기기 수가 아니다).
 */
async function getUsage(range, now = Date.now()) {
  const days = USAGE_RANGES[range];
  const today = kstDate(now);
  const from = days ? kstDate(now - (days - 1) * 86400 * 1000) : null;
  const [rows] = await pool.query(
    `SELECT event, SUM(count) AS count, SUM(devices) AS devices FROM ui_event_daily
     ${from ? 'WHERE event_date >= ?' : ''} GROUP BY event ORDER BY count DESC, event`,
    from ? [from] : []
  );
  // DATE를 JS Date로 받으면 서버 시간대에 따라 하루가 밀릴 수 있어 문자열로 받는다.
  const [[first]] = await pool.query("SELECT DATE_FORMAT(MIN(event_date), '%Y-%m-%d') AS first FROM ui_event_daily");
  return {
    range,
    from,
    to: today,
    firstDate: first?.first ?? null,
    events: rows.map((r) => ({ event: r.event, count: Number(r.count), devices: Number(r.devices) })),
  };
}

module.exports = { SCREENS, isValidEventName, normalizeEvents, recordEvents, isUsageRange, getUsage, MAX_EVENTS_PER_REQUEST, MAX_COUNT_PER_EVENT };
