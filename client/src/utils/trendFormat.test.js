import { describe, it, expect } from 'vitest';
import { pointLabel, axisTicks, MAX_BAR_POINTS } from './trendFormat.js';

const days = (count, last = '2026-10-12') => {
  const [y, m, d] = last.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => ({ at: new Date(Date.UTC(y, m - 1, d - (count - 1 - i))).toISOString().slice(0, 10) }));
};

describe('pointLabel', () => {
  it('일 단위는 한국 날짜 그대로 요일을 붙이고, 마지막 날은 (오늘)을 붙인다', () => {
    expect(pointLabel({ at: '2026-10-12' }, 'day', false)).toBe('2026.10.12 (월)');
    expect(pointLabel({ at: '2026-10-12' }, 'day', true)).toBe('2026.10.12 (월) (오늘)');
    expect(pointLabel({ at: '2026-01-05' }, 'day', false)).toBe('2026.01.05 (월)');
  });

  it('시간 단위는 보는 사람의 시계로 시~다음 시를 쓰고, 마지막은 (진행 중)', () => {
    const at = new Date(2026, 9, 12, 23).toISOString();
    expect(pointLabel({ at }, 'hour', false)).toBe('23시~0시');
    expect(pointLabel({ at }, 'hour', true)).toBe('23시~0시 (진행 중)');
  });
});

describe('axisTicks', () => {
  it('24시간은 6시간마다 + 마지막', () => {
    const points = Array.from({ length: 24 }, (_, i) => ({ at: new Date(2026, 9, 11, 6 + i).toISOString() }));
    const ticks = axisTicks(points, 'hour');
    expect(ticks.map((t) => t.index)).toEqual([0, 6, 12, 18, 23]);
    expect(ticks[0].label).toBe('6시');
  });

  it('30일은 마지막 날에서 거꾸로 7일마다 M/D', () => {
    const ticks = axisTicks(days(30), 'day');
    expect(ticks.map((t) => t.index)).toEqual([1, 8, 15, 22, 29]);
    expect(ticks[ticks.length - 1].label).toBe('10/12');
    expect(ticks[0].label).toBe('9/14');
  });

  it('2주 이하로 짧으면 2일마다', () => {
    expect(axisTicks(days(7), 'day').map((t) => t.index)).toEqual([0, 2, 4, 6]);
  });

  it('긴 기간(막대 한계 초과)은 매달 1일에 YY.M, 6개를 넘으면 건너뛰며 줄인다', () => {
    const year = axisTicks(days(365), 'day');
    expect(year.length).toBeLessThanOrEqual(6);
    expect(year.length).toBeGreaterThanOrEqual(3);
    expect(year[0].label).toMatch(/^\d\d\.\d{1,2}$/);
    const indices = year.map((t) => t.index);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('막대 한계(62점) 이하면 7일 간격 눈금, 넘으면 월 눈금', () => {
    expect(MAX_BAR_POINTS).toBe(62);
    expect(axisTicks(days(62), 'day')[0].label).toMatch(/^\d{1,2}\/\d{1,2}$/);
    expect(axisTicks(days(63), 'day')[0].label).toMatch(/^\d\d\.\d{1,2}$/);
  });
});
