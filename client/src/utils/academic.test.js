import { describe, it, expect } from 'vitest';
import { getGradeLevel } from './academic.js';

describe('getGradeLevel', () => {
  it('입학년도가 없으면 null을 반환한다', () => {
    expect(getGradeLevel(null)).toBeNull();
    expect(getGradeLevel(undefined)).toBeNull();
  });

  it('휴학 학기 수만큼(2학기당 1년) 학년을 낮춘다', () => {
    const currentYear = new Date().getFullYear();
    // 3년 전 입학 + 휴학 없음 = 4학년(캡 걸리기 전 기준으로 계산)
    const withoutLeave = getGradeLevel(currentYear - 3, 0);
    // 같은 입학년도인데 2학기(=1년) 휴학하면 1학년 낮아져야 한다.
    const withLeave = getGradeLevel(currentYear - 3, 2);
    expect(withLeave).toBe(withoutLeave - 1);
  });

  it('계산상 4학년을 넘어도 4로 고정된다', () => {
    const currentYear = new Date().getFullYear();
    expect(getGradeLevel(currentYear - 10, 0)).toBe(4);
  });

  it('계산상 1학년보다 낮아져도(신입생 등) 1로 고정된다', () => {
    const currentYear = new Date().getFullYear();
    expect(getGradeLevel(currentYear + 1, 0)).toBe(1);
  });
});
