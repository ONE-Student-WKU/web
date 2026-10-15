import { describe, it, expect } from 'vitest';
import { resolveLayout, isDefaultLayout, DEFAULT_TABS, MENU_VIEWS, isLockedView } from './homeLayout.js';

/**
 * client/src/utils/homeLayout.test.js
 * 홈 화면 편집 설정의 기본값·보정.
 */

describe('resolveLayout', () => {
  it('저장값이 없으면 지금 화면과 같은 기본 배치(홈·졸업요건 | 챗봇 | 진로·커뮤니티, 하단 바 켬)다', () => {
    expect(resolveLayout(null)).toEqual({ tabs: DEFAULT_TABS, showTabBar: true, menu: MENU_VIEWS });
    expect(DEFAULT_TABS).toEqual(['home', 'graduation', 'career', 'community']);
  });

  it('저장값을 그대로 쓴다 — 홈을 뺀 하단 바, 하단 바 끄기도', () => {
    expect(resolveLayout({ tabs: ['courses', 'inquiry', 'career', 'graduation'], showTabBar: false })).toEqual({
      tabs: ['courses', 'inquiry', 'career', 'graduation'],
      showTabBar: false,
      menu: MENU_VIEWS,
    });
  });

  it('빈 자리(null)는 위치 그대로 둔다 — 모두 비운 설정도', () => {
    expect(resolveLayout({ tabs: [null, 'home', null, 'career'], showTabBar: true }).tabs).toEqual([null, 'home', null, 'career']);
    expect(resolveLayout({ tabs: [null, null, null, null], showTabBar: true }).tabs).toEqual([null, null, null, null]);
  });

  it('하단 바가 4자리가 아니거나 중복·모르는 이름이면 기본 하단 바를 쓴다(이전 형식 3칸 값 포함)', () => {
    expect(resolveLayout({ tabs: ['graduation', 'career', 'community'] }).tabs).toEqual(DEFAULT_TABS);
    expect(resolveLayout({ tabs: ['home', 'home', 'career', 'community'] }).tabs).toEqual(DEFAULT_TABS);
    expect(resolveLayout({ tabs: ['chat', 'home', 'career', 'community'] }).tabs).toEqual(DEFAULT_TABS);
    expect(resolveLayout({ tabs: ['home', null, 'home', null] }).tabs).toEqual(DEFAULT_TABS);
  });
});

describe('resolveLayout — 메뉴', () => {
  it('저장된 카드·순서를 쓴다(뺀 카드·빈 메뉴 포함), 없거나 깨진 값이면 기본 메뉴', () => {
    const menu = ['inquiry', 'community', 'career', 'graduation', 'courses'];
    expect(resolveLayout({ tabs: DEFAULT_TABS, showTabBar: true, menu }).menu).toEqual(menu);
    expect(resolveLayout({ tabs: DEFAULT_TABS, showTabBar: true, menu: ['career', 'inquiry'] }).menu).toEqual(['career', 'inquiry']);
    expect(resolveLayout({ tabs: DEFAULT_TABS, showTabBar: true, menu: [] }).menu).toEqual([]);
    expect(resolveLayout({ tabs: DEFAULT_TABS, showTabBar: true }).menu).toEqual(MENU_VIEWS);
    expect(resolveLayout({ tabs: DEFAULT_TABS, showTabBar: true, menu: ['home', 'career'] }).menu).toEqual(MENU_VIEWS);
    expect(resolveLayout({ tabs: DEFAULT_TABS, showTabBar: true, menu: ['career', 'career'] }).menu).toEqual(MENU_VIEWS);
  });

  it('메뉴 순서만 바꿔도 기본 배치가 아니다', () => {
    expect(isDefaultLayout({ tabs: DEFAULT_TABS, showTabBar: true, menu: [...MENU_VIEWS].reverse() })).toBe(false);
  });
});

describe('isDefaultLayout / MENU_VIEWS', () => {
  it('기본 배치와 같은지', () => {
    expect(isDefaultLayout(null)).toBe(true);
    expect(isDefaultLayout(resolveLayout(null))).toBe(true);
    expect(isDefaultLayout({ tabs: DEFAULT_TABS, showTabBar: false })).toBe(false);
  });

  it('메뉴에는 홈을 뺀 기능 5개가 나온다', () => {
    expect(MENU_VIEWS).toEqual(['courses', 'graduation', 'career', 'community', 'inquiry']);
  });
});

describe('isLockedView — 학과가 필요한 기능', () => {
  it('학과를 고르지 않은 계정만 과목 관리·졸업요건 진단·진로 탐색이 잠기고, 나머지는 열린다', () => {
    const noDept = { departmentId: null };
    const withDept = { departmentId: 4 };
    for (const v of ['courses', 'graduation', 'career']) {
      expect(isLockedView(v, noDept)).toBe(true);
      expect(isLockedView(v, withDept)).toBe(false);
    }
    for (const v of ['home', 'community', 'inquiry', 'chat']) expect(isLockedView(v, noDept)).toBe(false);
  });
});
