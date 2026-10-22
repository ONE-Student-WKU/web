/**
 * client/src/utils/track.js
 * 기능 사용 횟수 — 화면·버튼이 몇 번 쓰였는지만 모아 15초마다 한 번에 보낸다(POST /api/ui-events). 누가 눌렀는지는 서버가
 * 저장하지 않고, 여기서도 입력한 글이나 시각은 보내지 않는다(server/services/uiEventService.js).
 *
 * - 버튼에는 data-track="화면.요소[.값]"만 붙이면 된다. App이 installTracking()으로 문서 전체에 클릭 감지기를 하나 걸어,
 *   눌린 곳에서 가장 가까운 data-track을 센다.
 * - 클릭이 아닌 것(화면 열림, 등록 성공)은 track('...')을 직접 부른다.
 * - 로그인한 학생일 때만 센다(setTrackingEnabled). 관리자는 빼서 운영하며 누른 것이 섞이지 않게 한다.
 * - 기기 수(대략): 같은 브라우저에서 그날 처음 쓴 이름이면 devices에 넣는다. 오늘 쓴 이름 목록만 브라우저에 하루 동안 둔다.
 */

const FLUSH_MS = 15000;
const SEEN_KEY = 'uiEventsSeen';
const NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$/;

let enabled = false;
let pending = new Map();
let firsts = new Set();
let timer = null;

function kstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 오늘 이 브라우저에서 처음 쓴 이름이면 true. 저장소가 막혀 있으면 기기 수만 빠지고 횟수는 그대로 센다.
function markFirstToday(name) {
  try {
    const today = kstToday();
    const saved = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null');
    const names = saved && saved.date === today && Array.isArray(saved.names) ? saved.names : [];
    if (names.includes(name)) return false;
    localStorage.setItem(SEEN_KEY, JSON.stringify({ date: today, names: [...names, name] }));
    return true;
  } catch {
    return false;
  }
}

export function track(name) {
  if (!enabled || !NAME_PATTERN.test(name) || name.length > 64) return;
  pending.set(name, (pending.get(name) || 0) + 1);
  if (markFirstToday(name)) firsts.add(name);
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

export function flush() {
  clearTimeout(timer);
  timer = null;
  if (!pending.size) return;
  const body = JSON.stringify({ counts: Object.fromEntries(pending), devices: [...firsts] });
  pending = new Map();
  firsts = new Set();
  // keepalive: 화면을 닫는 중에도 브라우저가 요청을 끝까지 보낸다. 통계라 실패해도 다시 보내지 않는다.
  fetch('/api/ui-events', { method: 'POST', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
}

export function setTrackingEnabled(next) {
  if (enabled && !next) flush();
  enabled = Boolean(next);
}

function handleClick(event) {
  const target = event.target instanceof Element ? event.target.closest('[data-track]') : null;
  if (target) track(target.getAttribute('data-track'));
}

function handleHidden() {
  if (document.visibilityState === 'hidden') flush();
}

// 앱에서 한 번만 부른다. 돌려주는 함수로 해제한다(테스트·핫 리로드).
export function installTracking() {
  document.addEventListener('click', handleClick, true);
  document.addEventListener('visibilitychange', handleHidden);
  window.addEventListener('pagehide', flush);
  return () => {
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('visibilitychange', handleHidden);
    window.removeEventListener('pagehide', flush);
  };
}
