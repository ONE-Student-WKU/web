import { describe, it, expect } from 'vitest';
import { resolveLayout, visibleCards, isDefaultLayout, DEFAULT_TABS, CARD_IDS } from './homeLayout.js';

/**
 * client/src/utils/homeLayout.test.js
 * 홈 화면 편집 설정의 기본값·보정·보일 카드 계산.
 */

describe('resolveLayout', () => {
  it('저장값이 없으면 지금 화면과 같은 기본 배치다', () => {
    expect(resolveLayout(null)).toEqual({
      tabs: DEFAULT_TABS,
      cards: { order: CARD_IDS, hidden: [] },
    });
  });

  it('저장값을 그대로 쓰되, 모르는 카드는 버리고 저장 뒤에 생긴 카드는 맨 뒤에 보이게 붙인다', () => {
    const saved = {
      tabs: ['courses', 'career', 'inquiry'],
      cards: { order: ['menu', 'old-card', 'progress'], hidden: ['progress'] },
    };
    expect(resolveLayout(saved)).toEqual({
      tabs: ['courses', 'career', 'inquiry'],
      cards: { order: ['menu', 'progress', 'shortfall'], hidden: ['progress'] },
    });
  });

  it('하단 바가 3칸이 아니거나 중복이면 기본 하단 바를 쓴다', () => {
    expect(resolveLayout({ tabs: ['courses'] }).tabs).toEqual(DEFAULT_TABS);
    expect(resolveLayout({ tabs: ['courses', 'courses', 'career'] }).tabs).toEqual(DEFAULT_TABS);
  });
});

describe('visibleCards / isDefaultLayout', () => {
  it('메뉴는 저장값에 숨김으로 들어 있어도 보인다(숨길 수 없는 카드)', () => {
    expect(
      resolveLayout({
        tabs: DEFAULT_TABS,
        cards: { order: CARD_IDS, hidden: ['menu', 'progress'] },
      }).cards.hidden,
    ).toEqual(['progress']);
  });

  it('숨긴 카드는 빼고 순서대로', () => {
    expect(
      visibleCards({
        cards: {
          order: ['menu', 'progress', 'shortfall'],
          hidden: ['progress'],
        },
      }),
    ).toEqual(['menu', 'shortfall']);
  });

  it('기본 배치와 같은지', () => {
    expect(isDefaultLayout(null)).toBe(true);
    expect(isDefaultLayout(resolveLayout(null))).toBe(true);
    expect(
      isDefaultLayout({
        tabs: ['courses', 'career', 'community'],
        cards: { order: CARD_IDS, hidden: [] },
      }),
    ).toBe(false);
  });
});
