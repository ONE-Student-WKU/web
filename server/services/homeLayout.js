/**
 * server/services/homeLayout.js
 * 홈 화면 편집 설정(students.home_layout) — 검증·해석(순수 함수).
 *
 * { tabs: [하단 바 3칸], cards: { order: [카드 순서], hidden: [숨긴 카드] } }
 *  - 하단 바는 홈(맨 왼쪽)과 챗봇(가운데)이 고정이고, 나머지 3칸만 TAB_OPTIONS에서 고른다.
 *  - NULL이면 기본 배치(편집하기 전 화면 그대로).
 * 화면 설정이라 개인정보 수집 항목이 아니다(동의 버전과 무관).
 * client/src/utils/homeLayout.js의 목록과 같은 이름을 써야 한다(서버는 모르는 이름을 거부한다).
 */

const TAB_OPTIONS = ['courses', 'graduation', 'career', 'community', 'inquiry'];
const TAB_SLOTS = 3;
const CARD_IDS = ['progress', 'shortfall', 'menu'];
// 숨길 수 없는 카드 — 메뉴는 모든 기능을 글자 이름과 함께 보여 주는 곳이라(하단 바는 아이콘만) 위치만 바꿀 수 있다.
const LOCKED_CARDS = ['menu'];

const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const hasDuplicates = (arr) => new Set(arr).size !== arr.length;

/** DB 값(JSON 컬럼은 mysql2가 객체로 주지만 문자열일 수도 있다) → 객체 | null. 깨진 값은 null(기본 배치)로 본다. */
function parseHomeLayout(raw) {
  if (raw == null) return null;
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * PATCH /api/me의 homeLayout 검증. null이면 기본 배치로 되돌린다는 뜻.
 * 성공하면 { layout }(저장할 값, null 가능), 실패하면 { error: 'INVALID_HOME_LAYOUT' }.
 */
function validateHomeLayout(input) {
  if (input === null) return { layout: null };
  const fail = { error: 'INVALID_HOME_LAYOUT' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail;

  const { tabs, cards } = input;
  if (!isStringArray(tabs) || tabs.length !== TAB_SLOTS || hasDuplicates(tabs)) return fail;
  if (!tabs.every((t) => TAB_OPTIONS.includes(t))) return fail;

  if (!cards || typeof cards !== 'object') return fail;
  const { order, hidden } = cards;
  if (!isStringArray(order) || !isStringArray(hidden)) return fail;
  if (hasDuplicates(order) || hasDuplicates(hidden)) return fail;
  if (!order.every((c) => CARD_IDS.includes(c)) || !hidden.every((c) => order.includes(c))) return fail;
  if (hidden.some((c) => LOCKED_CARDS.includes(c))) return fail;

  return { layout: { tabs: [...tabs], cards: { order: [...order], hidden: [...hidden] } } };
}

module.exports = { TAB_OPTIONS, TAB_SLOTS, CARD_IDS, LOCKED_CARDS, parseHomeLayout, validateHomeLayout };
