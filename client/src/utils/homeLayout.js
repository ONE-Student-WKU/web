/**
 * client/src/utils/homeLayout.js
 * 홈 화면 편집 설정(user.homeLayout) — 기본값, 저장값 보정, 보일 카드 계산(순수 함수).
 *
 * 하단 바는 홈(맨 왼쪽)·챗봇(가운데)이 고정이고 나머지 3칸을 TAB_OPTIONS에서 고른다. 홈의 "메뉴" 카드는
 * 모든 기능을 글자 이름과 함께 보여 주고(하단 바는 아이콘만이라 뜻을 여기서 알게 된다) 숨길 수 없어서, 어떤 기능도 사라지지 않는다.
 * 이름 목록은 server/services/homeLayout.js와 같아야 한다(서버가 모르는 이름을 거부한다).
 */

// 하단 바에 고를 수 있는 기능(= App.jsx의 view 이름). 순서는 메뉴 카드에 나오는 순서다.
export const TAB_OPTIONS = ['courses', 'graduation', 'career', 'community', 'inquiry'];
export const TAB_SLOTS = 3;
export const DEFAULT_TABS = ['graduation', 'career', 'community'];

// 홈 카드. 새 카드를 추가하면 여기(와 서버 CARD_IDS)에 넣는다 — 이미 편집한 사용자에게는 맨 뒤에 보이는 상태로 붙는다.
export const CARD_IDS = ['progress', 'shortfall', 'menu'];
// 숨길 수 없는 카드(위치만 바꿀 수 있다). 서버 LOCKED_CARDS와 같다.
export const LOCKED_CARDS = ['menu'];
export const DEFAULT_LAYOUT = {
  tabs: DEFAULT_TABS,
  cards: { order: CARD_IDS, hidden: [] },
};

// 기능별 화면 이름 사전 키(하단 바 접근성 이름·편집 화면·메뉴 카드에서 같이 쓴다).
export const TAB_LABEL_KEYS = {
  courses: 'home.courses',
  graduation: 'nav.graduation',
  career: 'nav.career',
  community: 'nav.community',
  inquiry: 'inquiry.title',
};

export const CARD_LABEL_KEYS = {
  progress: 'home.creditProgress',
  shortfall: 'home.shortfall',
  menu: 'home.menu',
};

/**
 * 저장값(null 가능) → 화면에 쓸 설정. 모르는 이름은 버리고, 저장 뒤에 새로 생긴 카드는 맨 뒤에 보이게 붙인다.
 * 하단 바가 3칸이 안 되면(옛 값·깨진 값) 기본 하단 바를 쓴다.
 */
export function resolveLayout(saved) {
  const tabs = Array.isArray(saved?.tabs) ? saved.tabs.filter((t) => TAB_OPTIONS.includes(t)) : [];
  const validTabs = tabs.length === TAB_SLOTS && new Set(tabs).size === TAB_SLOTS ? tabs : DEFAULT_TABS;

  const savedOrder = Array.isArray(saved?.cards?.order) ? saved.cards.order.filter((c) => CARD_IDS.includes(c)) : [];
  const order = [...new Set(savedOrder), ...CARD_IDS.filter((c) => !savedOrder.includes(c))];
  const hidden = Array.isArray(saved?.cards?.hidden)
    ? saved.cards.hidden.filter((c) => order.includes(c) && !LOCKED_CARDS.includes(c))
    : [];

  return {
    tabs: [...validTabs],
    cards: { order, hidden: [...new Set(hidden)] },
  };
}

/** 홈에 보일 카드 순서. */
export function visibleCards(layout) {
  return layout.cards.order.filter((c) => !layout.cards.hidden.includes(c));
}

/** 기본 배치와 같으면 true — 저장할 때 null로 보내 "편집한 적 없음"과 같게 둔다(이후 기본값이 바뀌어도 따라가게). */
export function isDefaultLayout(layout) {
  const resolved = resolveLayout(layout);
  return JSON.stringify(resolved) === JSON.stringify(resolveLayout(null));
}
