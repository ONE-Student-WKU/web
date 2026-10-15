import { describe, it, expect } from 'vitest';
import { getYearRange, describeSuccessors, transferCohortYear, transferYearOf, formatCohortRange, TRANSFER_GRADES } from './onboardingYears.js';

const NOW = 2026;

// 경영학과: 전공·교양 요건은 2023~2025학번, 졸업인증제 행이 2020~2025라 넓은 범위는 2020부터.
const MANAGEMENT = { minAdmissionYear: 2020, maxAdmissionYear: 2025, coreMinAdmissionYear: 2023, coreMaxAdmissionYear: 2025 };

describe('편입생 적용 학번(교육과정 운영에 관한 규정 제14조③)', () => {
  it('편입 연도 − 편입 학년 + 1 = 같은 학년이던 당초 입학자의 학번', () => {
    expect(transferCohortYear(2026, 3)).toBe(2024);
    expect(transferCohortYear(2026, 2)).toBe(2025);
    expect(transferCohortYear(2026, 4)).toBe(2023);
  });

  it('둘 중 하나라도 없으면 null', () => {
    expect(transferCohortYear(null, 3)).toBeNull();
    expect(transferCohortYear(2026, null)).toBeNull();
  });

  it('저장된 학번 + 학년 − 1로 편입 연도를 되돌리고, 옛 방식(학년 없음)이면 null', () => {
    expect(transferYearOf(2024, 3)).toBe(2026);
    expect(transferYearOf(transferCohortYear(2025, 4), 4)).toBe(2025);
    expect(transferYearOf(2024, null)).toBeNull();
  });

  it('고를 수 있는 편입 학년은 2~4', () => {
    expect(TRANSFER_GRADES).toEqual([2, 3, 4]);
  });
});

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

describe('formatCohortRange(#378 운영 점검)', () => {
  it('한 해뿐이면 "2026~2026"이 아니라 "2026", 여러 해면 "2017~2022", 끝이 없으면 시작만', () => {
    expect(formatCohortRange({ min: 2026, max: 2026 })).toBe('2026');
    expect(formatCohortRange({ min: 2017, max: 2022 })).toBe('2017~2022');
    expect(formatCohortRange({ min: 2024, max: null })).toBe('2024');
    expect(formatCohortRange(null)).toBe('');
  });
});
