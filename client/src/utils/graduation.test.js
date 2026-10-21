import { describe, it, expect } from 'vitest';
import { mergeMajorCategories, buildRequirementGroups, summarizeShortfalls, formatShortfallSentence, describeRequirementTrust, getPercent, registrationTermShortage, uncheckedRequirementKeys } from './graduation.js';
import { translate } from '../i18n/I18nContext.jsx';

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

  // GRADUATION_AUDIT_2026-10-12 1절: 기본전공 9/19 + 선택전공 66/56이면 전공 합계(75)는 차지만 기본전공 하한이 모자라
  // 졸업할 수 없다. 예전에는 합치면서 이 부족분이 사라져 "부족 요건 없음"이 나왔다.
  it('전공 합계가 차도 기본전공 하한이 모자라면 기본전공 부족을 남긴다', () => {
    const categories = [
      { category: '전공필수', earnedCredits: 9, requiredCredits: 19 },
      { category: '전공선택', earnedCredits: 66, requiredCredits: 56 },
    ];
    expect(summarizeShortfalls(mergeMajorCategories(categories), [])).toEqual(['기본전공 10학점']);
  });

  it('전공 합계와 기본전공이 둘 다 모자라면 "그중"으로 묶어 한 항목으로 쓴다(두 숫자를 더해 읽지 않게)', () => {
    const categories = [
      { category: '전공필수', earnedCredits: 9, requiredCredits: 19 },
      { category: '전공선택', earnedCredits: 50, requiredCredits: 56 },
    ];
    expect(summarizeShortfalls(mergeMajorCategories(categories), [])).toEqual(['전공 16학점(그중 기본전공 10학점)']);
  });

  it('기본전공을 채웠으면 전공 합계 부족만 쓴다(기존 동작)', () => {
    const categories = [
      { category: '전공필수', earnedCredits: 19, requiredCredits: 19 },
      { category: '전공선택', earnedCredits: 50, requiredCredits: 56 },
    ];
    expect(summarizeShortfalls(mergeMajorCategories(categories), [])).toEqual(['전공 6학점']);
  });

  it('교직기본이수처럼 optional인 인증은 졸업 부족 요건에 넣지 않는다', () => {
    const result = summarizeShortfalls([], [
      { category: '교직기본이수', satisfied: false, optional: true },
      { category: '졸업논문', satisfied: false },
    ]);
    expect(result).toEqual(['졸업논문']);
  });

  it('번역 함수를 넘기면 기본전공 묶음 문구도 번역 사전으로 만든다', () => {
    const dict = { 'grad.shortfallCreditsWithBase': '{category}: {n} credits (including {base}: {m} credits)', 'category.전공': 'Major', 'category.기본전공': 'Major core' };
    const t = (key, params = {}) => (dict[key] || key).replace(/\{(\w+)\}/g, (_, k) => params[k]);
    const categories = [
      { category: '전공필수', earnedCredits: 9, requiredCredits: 19 },
      { category: '전공선택', earnedCredits: 50, requiredCredits: 56 },
    ];
    expect(summarizeShortfalls(mergeMajorCategories(categories), [], t)).toEqual(['Major: 16 credits (including Major core: 10 credits)']);
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

describe('describeRequirementTrust', () => {
  const base = { totalRequiredCredits: 140, totalEarnedCredits: 10, categories: [], certifications: [] };

  it('확정: 배지·사유·추정 표시가 모두 없다(예외만 표시)', () => {
    const t = describeRequirementTrust({ ...base, regulation: { confidence: 'CONFIRMED', confidenceLabel: '확정', flags: [], totalDefinitive: true, schedule4: null } });
    expect(t).toEqual({ noData: false, badge: null, reason: null, totalEstimated: false });
  });

  it('추정: 가장 심각한 플래그 하나를 사유로, 총량은 추정 표기', () => {
    const t = describeRequirementTrust({
      ...base,
      regulation: {
        confidence: 'ESTIMATED', confidenceLabel: '추정', totalDefinitive: true, schedule4: null,
        flags: [{ code: 'A', level: 'INFO', message: '정보' }, { code: 'B', level: 'ESTIMATED', message: '추정 사유' }, { code: 'C', level: 'INSUFFICIENT', message: '자료 불충분 사유' }],
      },
    });
    expect(t.badge).toEqual({ label: '추정', level: 'warn' });
    expect(t.reason).toBe('자료 불충분 사유');
    expect(t.totalEstimated).toBe(true);
  });

  it('학칙 [별표 4] 불일치: 두 값을 사유로 보여 준다(어느 쪽이 맞다고 말하지 않음)', () => {
    const t = describeRequirementTrust({
      ...base,
      regulation: { confidence: 'ESTIMATED', confidenceLabel: '추정', totalDefinitive: true, flags: [{ code: 'SCHEDULE4_CREDIT_MISMATCH', level: 'ESTIMATED', message: '일반 문구' }], schedule4: { schedule4Credits: 130, bookCredits: 140 } },
    });
    expect(t.reason).toBe('학칙 [별표 4]는 130학점, 교육과정 책자는 140학점으로 서로 달라요. 학과 또는 학사지원과 확인이 필요해요.');
  });

  it('편입생 총량 미확정(totalDefinitive=false)은 총량 추정 표기', () => {
    const t = describeRequirementTrust({ ...base, regulation: { confidence: 'ESTIMATED', confidenceLabel: '추정', totalDefinitive: false, flags: [], schedule4: null } });
    expect(t.totalEstimated).toBe(true);
  });

  it('자료 없음: 총 요구학점 0이면 noData(0/0 대신 안내), 배지는 자료 없음', () => {
    const t = describeRequirementTrust({ ...base, totalRequiredCredits: 0, categories: [], regulation: { confidence: 'NO_DATA', confidenceLabel: '자료없음', totalDefinitive: true, flags: [{ code: 'NO_CURRICULUM_ROWS', level: 'NO_DATA', message: '자료가 없어요' }], schedule4: null } });
    expect(t.noData).toBe(true);
    expect(t.badge).toEqual({ label: '자료없음', level: 'none' });
    expect(t.reason).toBe('자료가 없어요');
    expect(t.totalEstimated).toBe(false);
  });

  it('예전 응답(regulation 없음)도 그대로 동작: 배지·사유 없음, 총량 0이면 noData', () => {
    expect(describeRequirementTrust(base)).toEqual({ noData: false, badge: null, reason: null, totalEstimated: false });
    expect(describeRequirementTrust({ ...base, totalRequiredCredits: 0 }).noData).toBe(true);
    expect(describeRequirementTrust(null)).toEqual({ noData: false, badge: null, reason: null, totalEstimated: false });
  });
});

describe('getPercent', () => {
  it('요구학점이 0·없음이면 NaN/Infinity 대신 0을 돌려준다', () => {
    expect(getPercent(10, 0)).toBe(0);
    expect(getPercent(0, 0)).toBe(0);
    expect(getPercent(10, null)).toBe(0);
    expect(getPercent(10, undefined)).toBe(0);
  });

  it('정상 값은 반올림하고 100%를 넘지 않는다', () => {
    expect(getPercent(50, 136)).toBe(37);
    expect(getPercent(150, 100)).toBe(100);
  });
});

describe('교양필수 영역(#378 결정 1-1 A)', () => {
  const areas = [
    { area: '건학이념', courses: ['종교와원불교'], completed: [], missing: ['종교와원불교'], satisfied: false },
    { area: '대학생활', courses: ['대학생활과자기혁신'], completed: ['대학생활과자기혁신'], missing: [], satisfied: true },
  ];
  // 학점은 채웠지만(다른 과목을 교양필수로 넣은 경우 등) 종교와원불교를 듣지 않았다
  const categories = [
    { category: '교양필수', earnedCredits: 5, requiredCredits: 5, areas },
    { category: '교양선택', earnedCredits: 34, requiredCredits: 34 },
  ];

  it('학점을 채워도 영역 과목을 안 들었으면 교양필수 미충족이고, 빠진 영역을 알려 준다', () => {
    const groups = buildRequirementGroups(categories);
    expect(groups.liberalArts.requiredSatisfied).toBe(false);
    expect(groups.liberalArts.missingAreas.map((a) => a.area)).toEqual(['건학이념']);
  });

  it('부족 요건 요약에 "건학이념 영역(종교와원불교)"을 넣고, 영어에서는 영역 이름만 번역한다(과목명은 서버 데이터라 그대로)', () => {
    expect(summarizeShortfalls(categories, [])).toEqual(['건학이념 영역(종교와원불교)']);
    expect(summarizeShortfalls(categories, [], (k, p) => translate('en', k, p))).toEqual(['Founding philosophy area (종교와원불교)']);
  });

  it('영역을 모두 들었거나 영역 판정이 없는 학과면 예전과 같다', () => {
    const done = [{ ...categories[0], areas: areas.map((a) => ({ ...a, satisfied: true, missing: [] })) }, categories[1]];
    expect(buildRequirementGroups(done).liberalArts.requiredSatisfied).toBe(true);
    expect(summarizeShortfalls(done, [])).toEqual([]);
    const noAreas = [{ category: '교양필수', earnedCredits: 5, requiredCredits: 5 }, categories[1]];
    expect(buildRequirementGroups(noAreas).liberalArts.requiredSatisfied).toBe(true);
  });

  it('괄호로 끝나는 마지막 항목은 괄호 앞 글자로 조사를 고른다', () => {
    expect(formatShortfallSentence(['대학생활 영역(대학생활과자기혁신)'])).toBe('대학생활 영역(대학생활과자기혁신)이 부족해요.');
    expect(formatShortfallSentence(['건학이념 영역(종교와원불교)'])).toBe('건학이념 영역(종교와원불교)가 부족해요.');
    expect(formatShortfallSentence(['전공 66학점(그중 기본전공 24학점)'])).toBe('전공 66학점(그중 기본전공 24학점)이 부족해요.');
  });
});

describe('광역 계열전공 이수구분별 학점(#378 E-3)', () => {
  const majorAreaCredits = {
    areas: [
      { area: '기초', required: 12, earned: 12, satisfied: true },
      { area: '심화', required: 15, earned: 9, satisfied: false },
      { area: '응용', required: 9, earned: 0, satisfied: false },
    ],
    unknownCredits: 3,
    satisfied: false,
  };
  // 계열 과목은 모두 전공선택으로 저장돼 전공필수(기본전공) 풀이 0이다
  const categories = [
    { category: '전공', earnedCredits: 21, requiredCredits: 72, baseShortfall: 36 },
  ];

  it('"그중 기본전공 36학점" 대신 모자란 구분을 알린다', () => {
    expect(summarizeShortfalls(categories, [], null, majorAreaCredits)).toEqual(['전공 51학점', '심화전공 6학점', '응용전공 9학점']);
    expect(summarizeShortfalls(categories, [], (k, p) => translate('en', k, p), majorAreaCredits)).toContain('Advanced major: 6 credits');
  });

  it('기본전공 충족 표시는 감추고, 구분별 학점이 없으면 예전과 같다', () => {
    const raw = [{ category: '전공필수', earnedCredits: 0, requiredCredits: 36 }, { category: '전공선택', earnedCredits: 21, requiredCredits: 36 }];
    expect(buildRequirementGroups(raw, majorAreaCredits).major.baseSatisfied).toBeNull();
    expect(buildRequirementGroups(raw).major.baseSatisfied).toBe(false);
  });
});

describe('교양 영역(#378 H-1)', () => {
  const liberal = {
    foundation: [
      { area: '생명존중', required: 4, earned: 4, satisfied: true },
      { area: 'AI와디지털', required: 3, earned: 6, satisfied: true },
      { area: '논리와표현', required: 3, earned: 0, satisfied: false },
      { area: '글로벌의사소통', required: 3, earned: 1, satisfied: false },
      { area: '과학과기술', required: 3, earned: 3, satisfied: true },
    ],
    electives: { requiredAreaCount: 3, areas: [], coveredAreaCount: 1, satisfied: false },
    unknownCredits: 0,
    satisfied: false,
  };

  it('모자란 교양기초 영역은 한 항목으로 묶고, 교양선택은 더 들어야 할 영역 수를 알린다', () => {
    expect(summarizeShortfalls([], [], null, null, liberal)).toEqual(['교양기초 영역(논리와표현 3학점·글로벌의사소통 2학점)', '교양선택 영역 2개']);
    const en = summarizeShortfalls([], [], (k, p) => translate('en', k, p), null, liberal);
    expect(en).toEqual(['Foundation general ed. areas (Logic and expression 3 credits·Global communication 2 credits)', '2 more elective general ed. area(s)']);
  });

  it('홈(compact)은 학점이 모자란 큰 항목의 세부를 빼고, 큰 항목을 채웠을 때만 세부를 보인다', () => {
    const cats = (electiveEarned, majorEarned) => [
      { category: '교양선택', requiredCredits: 28, earnedCredits: electiveEarned },
      { category: '전공', requiredCredits: 36, earnedCredits: majorEarned },
    ];
    const areas = { areas: [{ area: '기초', required: 12, earned: 0 }] };
    expect(summarizeShortfalls(cats(3, 0), [], null, areas, liberal, null, { compact: true })).toEqual(['교양선택 25학점', '전공 36학점']);
    expect(summarizeShortfalls(cats(28, 36), [], null, areas, liberal, null, { compact: true })).toEqual([
      '기초전공 12학점', '교양기초 영역(논리와표현 3학점·글로벌의사소통 2학점)', '교양선택 영역 2개',
    ]);
    // 진단 화면(기본값)은 세부까지 전부 보인다.
    expect(summarizeShortfalls(cats(3, 0), [], null, areas, liberal)).toHaveLength(5);
  });

  it('다 채웠거나 영역 기준이 없으면(2024학번 이하 등) 항목을 넣지 않는다', () => {
    const done = { ...liberal, foundation: liberal.foundation.map((a) => ({ ...a, earned: a.required, satisfied: true })), electives: null, satisfied: true };
    expect(summarizeShortfalls([], [], null, null, done)).toEqual([]);
    expect(summarizeShortfalls([], [], null, null, null)).toEqual([]);
  });
});

describe('등록 학기(#378 H-2)', () => {
  const status = (registered, earned = 130) => ({ totalEarnedCredits: earned, totalRequiredCredits: 130, registrationTerms: { registered, required: 8, earlyGraduation: 6, estimated: false } });

  it('학점·요건을 다 채웠는데 학기가 모자랄 때만 모자란 학기 수를 낸다', () => {
    expect(registrationTermShortage(status(6), [])).toBe(2);
    expect(registrationTermShortage(status(8), [])).toBe(0);
  });

  it('부족 요건이 있거나 학점이 모자라면 강조하지 않는다(정보로만 보여 준다)', () => {
    expect(registrationTermShortage(status(6), ['교양필수 3학점'])).toBe(0);
    expect(registrationTermShortage(status(6, 120), [])).toBe(0);
    expect(registrationTermShortage({ totalEarnedCredits: 130, totalRequiredCredits: 130 }, [])).toBe(0);
  });
});

describe('다전공(#378 G-2)', () => {
  const second = { type: 'DOUBLE', department: '경영학과', required: 51, earned: 9, thesis: { satisfied: false } };

  it('제2전공 학점과 복수전공 졸업논문을 부족 요건에 넣는다', () => {
    expect(summarizeShortfalls([], [], null, null, null, second)).toEqual(['복수전공(경영학과) 42학점', '복수전공 졸업논문']);
    const en = summarizeShortfalls([], [], (k, p) => translate('en', k, p), null, null, second);
    expect(en).toEqual(['Double major (경영학과): 42 credits', 'Double major graduation thesis']);
  });

  it('부전공은 졸업논문이 없고, 기준을 모르면 학점은 넣지 않는다', () => {
    expect(summarizeShortfalls([], [], null, null, null, { type: 'MINOR', department: '국어국문학과', required: 21, earned: 21, thesis: null })).toEqual([]);
    expect(summarizeShortfalls([], [], null, null, null, { ...second, required: null })).toEqual(['복수전공 졸업논문']);
  });
});

describe('판정하지 않는 요건(2026-10-16 규정 대조)', () => {
  it('지정 과목·부전공 지정 교과목·전공융합형 MD를 학생이 직접 확인할 항목으로 모은다(상담은 충족으로 보여줘서 빠진다)', () => {
    expect(uncheckedRequirementKeys(null)).toEqual([]);
    expect(uncheckedRequirementKeys({ counseling: { required: 8 } })).toEqual([]);
    expect(uncheckedRequirementKeys({
      counseling: { required: 8 }, designatedMajorCourses: { courses: [] }, secondMajor: { type: 'MINOR' }, majorTrackType: 'CONVERGENCE',
    })).toEqual(['home.unchecked.designated', 'home.unchecked.minorDesignated', 'home.unchecked.microDegree']);
    expect(uncheckedRequirementKeys({ secondMajor: { type: 'DOUBLE' }, majorTrackType: 'INTENSIVE' })).toEqual([]);
  });
});
