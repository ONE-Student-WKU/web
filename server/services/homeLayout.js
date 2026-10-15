/**
 * server/services/homeLayout.js
 * 홈 화면 편집 설정(students.home_layout) — 검증·해석(순수 함수).
 *
 * { tabs: [하단 바 4자리 — 기능 이름 또는 null(빈 자리)], showTabBar: true | false, menu?: [홈 메뉴 카드 5개의 순서] }
 *  - 하단 바는 가운데 챗봇 버튼만 고정이고, 나머지 4자리(왼쪽 2·오른쪽 2)를 TAB_OPTIONS에서 고른다. 홈도 고를 수 있다
 *    (각 화면의 "홈으로" 버튼·챗봇 사이드바로 언제든 홈에 돌아갈 수 있다).
 *  - 4자리를 다 채우지 않아도 된다. 빈 자리는 null로 두어 자리(위치)를 그대로 지킨다. 모두 null이면 바 없이 챗봇 버튼만 남는다.
 *  - showTabBar가 false면 챗봇 버튼을 포함한 하단 바 전체를 모든 화면에서 숨긴다(챗봇을 쓰지 않는 사용자를 위한 선택).
 *  - NULL이면 기본 배치(편집하기 전 화면 그대로).
 *  - menu는 홈 메뉴에 보일 카드와 그 순서다(MENU_OPTIONS 중 0~5개, 중복 없음). 빈 배열이면 홈에 메뉴가 보이지 않는다.
 *    menu가 없으면(편집 전·이전 형식) 기본 메뉴(5개 전부, 기본 순서).
 * 이수학점 진행률·부족 요건 카드는 고정이라 설정에 없다.
 * 화면 설정이라 개인정보 수집 항목이 아니다(동의 버전과 무관).
 * client/src/utils/homeLayout.js의 목록과 같은 이름을 써야 한다(서버는 모르는 이름을 거부한다).
 */

const TAB_OPTIONS = ['home', 'courses', 'graduation', 'career', 'community', 'inquiry'];
const TAB_SLOTS = 4;
// 홈 메뉴 카드 — 홈 화면 자신을 뺀 기능 전부.
const MENU_OPTIONS = TAB_OPTIONS.filter((v) => v !== 'home');


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

  const { tabs, showTabBar, menu } = input;
  if (!Array.isArray(tabs) || tabs.length !== TAB_SLOTS) return fail;
  if (!tabs.every((t) => t === null || TAB_OPTIONS.includes(t))) return fail;
  const filled = tabs.filter((t) => t !== null);
  if (new Set(filled).size !== filled.length) return fail;
  if (typeof showTabBar !== 'boolean') return fail;
  if (menu !== undefined) {
    if (!Array.isArray(menu) || !menu.every((v) => MENU_OPTIONS.includes(v))) return fail;
    if (new Set(menu).size !== menu.length) return fail;
  }

  const layout = { tabs: [...tabs], showTabBar };
  if (menu !== undefined) layout.menu = [...menu];
  return { layout };
}

module.exports = { TAB_OPTIONS, TAB_SLOTS, MENU_OPTIONS, parseHomeLayout, validateHomeLayout };
