/**
 * client/src/utils/homeLayout.js
 * 홈 화면 편집 설정(user.homeLayout) — 기본값, 저장값 보정(순수 함수).
 *
 * 하단 바는 가운데 챗봇 버튼만 고정이고, 나머지 4칸(왼쪽 2·오른쪽 2)을 TAB_OPTIONS에서 고른다(홈도 고를 수 있다 —
 * 각 화면의 "홈으로" 버튼·챗봇 사이드바로 언제든 홈에 돌아갈 수 있다). showTabBar가 false면 챗봇 버튼을 포함한
 * 하단 바 전체를 숨긴다. 홈 카드(진행률·부족 요건·메뉴)는 고정이라 설정에 없다.
 * 이름 목록은 server/services/homeLayout.js와 같아야 한다(서버가 모르는 이름을 거부한다).
 */

// 하단 바에 고를 수 있는 기능(= App.jsx의 view 이름).
export const TAB_OPTIONS = ['home', 'courses', 'graduation', 'career', 'community', 'inquiry'];
export const TAB_SLOTS = 4;
export const DEFAULT_TABS = ['home', 'graduation', 'career', 'community'];

// 홈 메뉴 카드에 나오는 기능 — 홈 화면 자신은 빼고 나머지를 글자 이름과 함께 보여 준다(하단 바는 아이콘만이라 뜻을 여기서 알게 된다).
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

/** 저장값(null 가능) → 화면에 쓸 설정. 하단 바가 4칸이 아니거나 모르는 이름이 섞이면(옛 값·깨진 값) 기본 하단 바를 쓴다. */
export function resolveLayout(saved) {
  const tabs = Array.isArray(saved?.tabs) ? saved.tabs.filter((t) => TAB_OPTIONS.includes(t)) : [];
  const validTabs = tabs.length === TAB_SLOTS && new Set(tabs).size === TAB_SLOTS ? tabs : DEFAULT_TABS;
  return { tabs: [...validTabs], showTabBar: saved?.showTabBar !== false };
}

/** 기본 배치와 같으면 true — 저장할 때 null로 보내 "편집한 적 없음"과 같게 둔다(이후 기본값이 바뀌어도 따라가게). */
export function isDefaultLayout(layout) {
  return JSON.stringify(resolveLayout(layout)) === JSON.stringify(resolveLayout(null));
}
