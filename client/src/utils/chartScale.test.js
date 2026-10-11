import { describe, it, expect } from 'vitest';
import { niceMax } from './chartScale.js';

describe('niceMax', () => {
  it('값이 적어도 최소 4까지 보여 준다', () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(1)).toBe(4);
    expect(niceMax(4)).toBe(4);
  });

  it('1·2·5 × 10^n 중 최댓값 이상인 가장 작은 값으로 올린다', () => {
    expect(niceMax(5)).toBe(5);
    expect(niceMax(6)).toBe(10);
    expect(niceMax(11)).toBe(20);
    expect(niceMax(21)).toBe(50);
    expect(niceMax(51)).toBe(100);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(1000)).toBe(1000);
  });
});
