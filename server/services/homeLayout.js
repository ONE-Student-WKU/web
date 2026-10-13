/**
 * server/services/homeLayout.js
 * 홈 화면 편집 설정(students.home_layout) — 검증·해석(순수 함수).
 *
 * { tabs: [하단 바 4칸], showTabBar: true | false }
 *  - 하단 바는 가운데 챗봇 버튼만 고정이고, 나머지 4칸(왼쪽 2·오른쪽 2)을 TAB_OPTIONS에서 고른다. 홈도 고를 수 있다
 *    (각 화면의 "홈으로" 버튼·챗봇 사이드바로 언제든 홈에 돌아갈 수 있다).
 *  - showTabBar가 false면 챗봇 버튼을 포함한 하단 바 전체를 모든 화면에서 숨긴다(챗봇을 쓰지 않는 사용자를 위한 선택).
 *  - NULL이면 기본 배치(편집하기 전 화면 그대로).
 * 홈 카드(이수학점 진행률·부족 요건·메뉴)는 고정이라 설정에 없다.
 * 화면 설정이라 개인정보 수집 항목이 아니다(동의 버전과 무관).
 * client/src/utils/homeLayout.js의 목록과 같은 이름을 써야 한다(서버는 모르는 이름을 거부한다).
 */

const TAB_OPTIONS = ['home', 'courses', 'graduation', 'career', 'community', 'inquiry'];
const TAB_SLOTS = 4;

const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

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

  const { tabs, showTabBar } = input;
  if (!isStringArray(tabs) || tabs.length !== TAB_SLOTS || new Set(tabs).size !== TAB_SLOTS) return fail;
  if (!tabs.every((t) => TAB_OPTIONS.includes(t))) return fail;
  if (typeof showTabBar !== 'boolean') return fail;

  return { layout: { tabs: [...tabs], showTabBar } };
}

module.exports = { TAB_OPTIONS, TAB_SLOTS, parseHomeLayout, validateHomeLayout };
