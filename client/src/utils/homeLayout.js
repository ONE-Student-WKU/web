/**
 * client/src/utils/homeLayout.js
 * 홈 화면 편집 설정(user.homeLayout) — 기본값, 저장값 보정(순수 함수).
 *
 * 하단 바는 가운데 챗봇 버튼만 고정이고, 나머지 4자리(왼쪽 2·오른쪽 2)를 TAB_OPTIONS에서 고른다(홈도 고를 수 있다 —
 * 각 화면의 "홈으로" 버튼·챗봇 사이드바로 언제든 홈에 돌아갈 수 있다). 다 채우지 않아도 되며 빈 자리는 null로 위치를 지킨다
 * (모두 비우면 바 없이 챗봇 버튼만 남는다). showTabBar가 false면 챗봇 버튼을 포함한 하단 바 전체를 숨긴다.
 * menu는 홈 메뉴에 보일 카드와 그 순서(MENU_VIEWS 중 0~5개 — 빈 배열이면 홈에 메뉴가 없다). 이수학점 진행률·부족 요건 카드는 고정이라 설정에 없다.
 * 이름 목록은 server/services/homeLayout.js와 같아야 한다(서버가 모르는 이름을 거부한다).
 */

// 하단 바에 고를 수 있는 기능(= App.jsx의 view 이름).
export const TAB_OPTIONS = ['home', 'courses', 'graduation', 'career', 'community', 'inquiry'];
export const TAB_SLOTS = 4;
export const DEFAULT_TABS = ['home', 'graduation', 'career', 'community'];

// 홈 메뉴 카드에 나오는 기능(기본 순서) — 홈 화면 자신은 빼고 나머지를 글자 이름과 함께 보여 준다(하단 바는 아이콘만이라 뜻을 여기서 알게 된다).
export const MENU_VIEWS = TAB_OPTIONS.filter((v) => v !== 'home');

// 학과·학번이 있어야 쓸 수 있는 기능 — 졸업요건 진단·진로 탐색은 서버가 거절하고, 과목 관리는 학번이 없으면 지난 학기 탭이 안 생긴다.
// 학과를 고르지 않은 계정에서는 홈 메뉴·하단 바에서 흐리게 보이고, 누르면 학과 선택으로 간다(App.jsx openView).
export const NEEDS_DEPARTMENT = ['courses', 'graduation', 'career'];

export function isLockedView(view, user) {
  return NEEDS_DEPARTMENT.includes(view) && !user?.departmentId;
}

// 기능별 화면 이름 사전 키(하단 바 접근성 이름·편집 화면·메뉴 카드에서 같이 쓴다).
export const TAB_LABEL_KEYS = {
  home: 'nav.home',
  courses: 'home.courses',
  graduation: 'nav.graduation',
  career: 'nav.career',
  community: 'nav.community',
  inquiry: 'inquiry.title',
};

/** 하단 바 자리 배열이 올바른지 — 4자리, 각 자리는 기능 이름 또는 null, 같은 기능은 한 번만(서버 validateHomeLayout과 같은 규칙). */
function isValidTabs(tabs) {
  if (!Array.isArray(tabs) || tabs.length !== TAB_SLOTS) return false;
  if (!tabs.every((t) => t === null || TAB_OPTIONS.includes(t))) return false;
  const filled = tabs.filter((t) => t !== null);
  return new Set(filled).size === filled.length;
}

/** 메뉴가 올바른지 — 메뉴 기능 중 0~5개, 중복 없이(서버 validateHomeLayout과 같은 규칙). */
function isValidMenu(menu) {
  return Array.isArray(menu) && menu.every((v) => MENU_VIEWS.includes(v)) && new Set(menu).size === menu.length;
}

/** 저장값(null 가능) → 화면에 쓸 설정. 하단 바·메뉴가 없거나 형식에 안 맞으면(편집 전·옛 값·깨진 값) 그 부분만 기본값을 쓴다. */
export function resolveLayout(saved) {
  const tabs = isValidTabs(saved?.tabs) ? saved.tabs : DEFAULT_TABS;
  const menu = isValidMenu(saved?.menu) ? saved.menu : MENU_VIEWS;
  return { tabs: [...tabs], showTabBar: saved?.showTabBar !== false, menu: [...menu] };
}

/** 기본 배치와 같으면 true — 저장할 때 null로 보내 "편집한 적 없음"과 같게 둔다(이후 기본값이 바뀌어도 따라가게). */
export function isDefaultLayout(layout) {
  return JSON.stringify(resolveLayout(layout)) === JSON.stringify(resolveLayout(null));
}
