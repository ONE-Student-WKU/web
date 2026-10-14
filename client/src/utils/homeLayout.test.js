import { describe, it, expect } from 'vitest';
import { resolveLayout, isDefaultLayout, DEFAULT_TABS, MENU_VIEWS } from './homeLayout.js';

/**
 * client/src/utils/homeLayout.test.js
 * 홈 화면 편집 설정의 기본값·보정.
 */

describe('resolveLayout', () => {
  it('저장값이 없으면 지금 화면과 같은 기본 배치(홈·졸업요건 | 챗봇 | 진로·커뮤니티, 하단 바 켬)다', () => {
    expect(resolveLayout(null)).toEqual({ tabs: DEFAULT_TABS, showTabBar: true });
    expect(DEFAULT_TABS).toEqual(['home', 'graduation', 'career', 'community']);
  });

  it('저장값을 그대로 쓴다 — 홈을 뺀 하단 바, 하단 바 끄기도', () => {
    expect(resolveLayout({ tabs: ['courses', 'inquiry', 'career', 'graduation'], showTabBar: false })).toEqual({
      tabs: ['courses', 'inquiry', 'career', 'graduation'],
      showTabBar: false,
    });
  });

  it('하단 바가 4칸이 아니거나 중복·모르는 이름이면 기본 하단 바를 쓴다(이전 형식 3칸 값 포함)', () => {
    expect(resolveLayout({ tabs: ['graduation', 'career', 'community'] }).tabs).toEqual(DEFAULT_TABS);
    expect(resolveLayout({ tabs: ['home', 'home', 'career', 'community'] }).tabs).toEqual(DEFAULT_TABS);
    expect(resolveLayout({ tabs: ['chat', 'home', 'career', 'community'] }).tabs).toEqual(DEFAULT_TABS);
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
