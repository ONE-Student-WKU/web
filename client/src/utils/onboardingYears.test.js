import { describe, it, expect } from 'vitest';
import { getYearRange, describeSuccessors } from './onboardingYears.js';

const NOW = 2026;

// 경영학과: 전공·교양 요건은 2023~2025학번, 졸업인증제 행이 2020~2025라 넓은 범위는 2020부터.
const MANAGEMENT = { minAdmissionYear: 2020, maxAdmissionYear: 2025, coreMinAdmissionYear: 2023, coreMaxAdmissionYear: 2025 };

describe('getYearRange', () => {
  it('일반 재학생은 교양·전공 요건이 있는 학번 범위만 고른다', () => {
    expect(getYearRange(MANAGEMENT, 'GENERAL', NOW)).toEqual({ min: 2023, max: 2025 });
  });

  it('학생 유형을 아직 안 골랐을 때도 요건이 있는 범위를 쓴다', () => {
    expect(getYearRange(MANAGEMENT, null, NOW)).toEqual({ min: 2023, max: 2025 });
  });

  it('전과생은 넓은 범위를 쓴다 — 옛 학번이 새 학과로 전과할 수 있다', () => {
    expect(getYearRange(MANAGEMENT, 'MAJOR_CHANGE', NOW)).toEqual({ min: 2020, max: 2025 });
  });

  it('편입생은 요건 범위에서 올해 학번을 뺀다', () => {
    const dept = { minAdmissionYear: 2020, maxAdmissionYear: 2026, coreMinAdmissionYear: 2024, coreMaxAdmissionYear: 2026 };
    expect(getYearRange(dept, 'TRANSFER_ADMISSION', NOW)).toEqual({ min: 2024, max: 2025 });
  });

  it('core 값이 없으면 넓은 범위로, 그것도 없으면 올해 기준 15년으로 되돌린다', () => {
    const noCore = { minAdmissionYear: 2019, maxAdmissionYear: 2024, coreMinAdmissionYear: null, coreMaxAdmissionYear: null };
    expect(getYearRange(noCore, 'GENERAL', NOW)).toEqual({ min: 2019, max: 2024 });
    const none = { minAdmissionYear: null, maxAdmissionYear: null };
    expect(getYearRange(none, 'GENERAL', NOW)).toEqual({ min: NOW - 15, max: NOW });
  });
});

describe('describeSuccessors', () => {
  it('후속 학과가 없으면 안내를 붙이지 않는다', () => {
    expect(describeSuccessors({ successors: [] })).toBeNull();
    expect(describeSuccessors({})).toBeNull();
    expect(describeSuccessors(null)).toBeNull();
  });

  it('개편 이력이 이름 유사 추정이면 (추정)을 붙인다', () => {
    expect(describeSuccessors({ successors: [{ name: '경영학과', confirmed: false }] })).toBe('이후 학과(추정): 경영학과');
  });

  it('전부 문서로 확인된 이력이면 (추정)을 붙이지 않는다', () => {
    expect(describeSuccessors({ successors: [{ name: '기계공학부', confirmed: true }] })).toBe('이후 학과: 기계공학부');
  });

  it('후속 학과가 여럿이면 모두 나열한다(분리)', () => {
    const d = { successors: [{ name: '사회복지학과', confirmed: false }, { name: '보건행정학과', confirmed: false }] };
    expect(describeSuccessors(d)).toBe('이후 학과(추정): 사회복지학과, 보건행정학과');
  });
});
