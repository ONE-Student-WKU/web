import { describe, it, expect } from 'vitest';
import { mergeMajorCategories, buildRequirementGroups, summarizeShortfalls, formatShortfallSentence } from './graduation.js';

describe('mergeMajorCategories', () => {
  it('전공필수/전공선택을 합쳐서 초과 이수분이 서로 상쇄되게 한다', () => {
    // 실사용 피드백으로 고쳤던 버그 재현: 기본전공(전공필수)을 요건보다 많이 들었으면
    // 그 초과분이 전공선택 부족분을 상쇄해야 한다 — 두 카테고리를 따로 보면 안 됨.
    const categories = [
      { category: '전공필수', earnedCredits: 40, requiredCredits: 30 }, // 10학점 초과
      { category: '전공선택', earnedCredits: 5, requiredCredits: 10 }, // 5학점 부족
      { category: '교양필수', earnedCredits: 10, requiredCredits: 10 },
    ];

    const merged = mergeMajorCategories(categories);
    const majorRow = merged.find((c) => c.category === '전공');

    expect(majorRow.earnedCredits).toBe(45);
    expect(majorRow.requiredCredits).toBe(40);
    expect(majorRow.earnedCredits).toBeGreaterThanOrEqual(majorRow.requiredCredits); // 합치면 충족
    expect(merged.find((c) => c.category === '전공선택')).toBeUndefined(); // 전공선택 단독 행은 사라짐
  });

  it('전공필수/전공선택 중 하나라도 없으면(전과생 완화 요건 등) 그대로 반환한다', () => {
    const categories = [{ category: '전공', earnedCredits: 48, requiredCredits: 48 }];
    expect(mergeMajorCategories(categories)).toBe(categories);
  });
});

describe('buildRequirementGroups', () => {
  it('일반 재학생: 전공필수+전공선택을 합쳐 major 카드를 만든다', () => {
    const categories = [
      { category: '전공필수', earnedCredits: 30, requiredCredits: 30 },
      { category: '전공선택', earnedCredits: 20, requiredCredits: 25 },
      { category: '교양필수', earnedCredits: 10, requiredCredits: 15 },
      { category: '교양선택', earnedCredits: 5, requiredCredits: 10 },
    ];

    const { major, liberalArts } = buildRequirementGroups(categories);

    expect(major.earnedCredits).toBe(50);
    expect(major.requiredCredits).toBe(55);
    expect(major.baseSatisfied).toBe(true); // 전공필수(기본전공)는 충족
    expect(liberalArts.requiredSatisfied).toBe(false); // 교양필수 10/15는 미충족
  });

  it('전과·편입생: 완화된 통합 "전공" 행 하나만 있어도 major 카드가 null이 되지 않는다', () => {
    // 실사용으로 확인된 버그: 전공필수/전공선택이 아예 없어서(완화 요건이라 "전공" 행 하나로만
    // 내려옴) find()가 둘 다 못 찾아 major가 null이 되던 문제.
    const categories = [
      { category: '전공', earnedCredits: 30, requiredCredits: 48 },
      { category: '교양필수', earnedCredits: 10, requiredCredits: 10 },
      { category: '교양선택', earnedCredits: 5, requiredCredits: 5 },
    ];

    const { major } = buildRequirementGroups(categories);

    expect(major).not.toBeNull();
    expect(major.earnedCredits).toBe(30);
    expect(major.requiredCredits).toBe(48);
    expect(major.baseSatisfied).toBeNull(); // 완화 요건은 구분이 없어 충족 배지를 안 둠
  });

  it('categories가 없으면 null을 반환한다', () => {
    expect(buildRequirementGroups(null)).toBeNull();
  });
});

describe('summarizeShortfalls', () => {
  it('일반선택은 자동으로 채워지는 항목이라 부족 목록에서 제외한다', () => {
    // 실사용 확인된 버그: "일반선택 22학점 부족해요"처럼 학생이 직접 채워야 하는 것처럼
    // 오해를 주는 문구가 나오면 안 됨 — 일반선택은 전공/교양 초과분으로 자동 충족된다.
    const categories = [
      { category: '일반선택', earnedCredits: 0, requiredCredits: 22 },
      { category: '교양필수', earnedCredits: 5, requiredCredits: 10 },
    ];

    const result = summarizeShortfalls(categories, []);

    expect(result).toEqual(['교양필수 5학점']);
    expect(result.join()).not.toContain('일반선택');
  });

  it('충족 못 한 인증제/논문도 목록에 포함한다', () => {
    const result = summarizeShortfalls([], [{ category: '졸업인증제', satisfied: false }, { category: '졸업논문', satisfied: true }]);
    expect(result).toEqual(['졸업인증제']);
  });

  it('전부 충족했으면 빈 배열을 반환한다', () => {
    const categories = [{ category: '교양필수', earnedCredits: 10, requiredCredits: 10 }];
    expect(summarizeShortfalls(categories, [{ category: '졸업논문', satisfied: true }])).toEqual([]);
  });
});

describe('formatShortfallSentence', () => {
  it('받침 있는 마지막 항목엔 "이"를 붙인다', () => {
    expect(formatShortfallSentence(['기본전공 3학점'])).toBe('기본전공 3학점이 부족해요.');
  });

  it('받침 없는 마지막 항목엔 "가"를 붙인다', () => {
    expect(formatShortfallSentence(['졸업인증제'])).toBe('졸업인증제가 부족해요.');
  });

  it('빈 배열이면 null을 반환한다', () => {
    expect(formatShortfallSentence([])).toBeNull();
  });
});
