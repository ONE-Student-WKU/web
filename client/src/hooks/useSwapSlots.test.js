import { describe, it, expect } from 'vitest';
import { dropSlot } from './useSwapSlots.js';

/**
 * client/src/hooks/useSwapSlots.test.js
 * 끌어 놓을 자리 판정 — 끌고 있는 것의 가운데가 어느 자리에 들어가는지(끌기·누르기 동작은 pages/HomeEdit.test.jsx에서 화면으로 확인).
 */

describe('dropSlot', () => {
  const bar = [0, 1, 2, 3].map((i) => ({ left: i * 50, top: 0, width: 40, height: 40 })); // 가운데 x 20, 70, 120, 170 / y 20

  it('가로·세로 모두 자리 크기 안인 자리 중 가장 가까운 자리', () => {
    expect(dropSlot(0, 20, bar)).toBe(0);
    expect(dropSlot(118, 30, bar)).toBe(2);
    expect(dropSlot(210, 20, bar)).toBe(3);
  });

  it('어느 자리에도 가깝지 않으면 null(제자리로)', () => {
    expect(dropSlot(211, 20, bar)).toBe(null);
    expect(dropSlot(-30, 20, bar)).toBe(null);
    expect(dropSlot(70, 61, bar)).toBe(null);
  });

  it('2열 격자에서는 세로 위치로 줄을 가린다', () => {
    const grid = [0, 1, 2, 3, 4].map((i) => ({ left: (i % 2) * 100, top: Math.floor(i / 2) * 60, width: 90, height: 50 }));
    expect(dropSlot(145, 85, grid)).toBe(3);
    expect(dropSlot(45, 145, grid)).toBe(4);
  });

  it('자리 위치를 모르면 null', () => {
    expect(dropSlot(10, 10, [{ left: 0, top: 0, width: 0, height: 0 }])).toBe(null);
  });
});
