import { describe, it, expect } from 'vitest';
import { findMyMicroDegreeGroup, searchMicroDegrees, groupByProgram } from './microDegreeSearch.js';

/**
 * client/src/utils/microDegreeSearch.test.js
 * 마이크로디그리 고르기의 "내 계열" 묶음 찾기와 검색 — 검색 기준은 학과 검색(departmentTree.js)과 같아야 한다(2026-10-28 피드백).
 * 과정 이름은 db/seed/micro_degrees.json의 실제 이름 모양을 따른다.
 */
const OPTIONS = [
  { name: 'JST 에너지신산업학부 이차전지 기초', programGroup: 'JST공유대학' },
  { name: '게임콘텐츠학전공 - 게임기획가', programGroup: '학과·전공별 MD · 공학3계열' },
  { name: '컴퓨터·소프트웨어공학전공 - 웹프로그래밍', programGroup: '학과·전공별 MD · 공학3계열' },
  { name: '경영학전공 - 디지털마케팅', programGroup: '학과·전공별 MD · 경영계열' },
];

describe('findMyMicroDegreeGroup', () => {
  it('개편 전 학과 이름("…학과")이 과정 이름 앞부분("…전공")과 같으면 그 묶음', () => {
    expect(findMyMicroDegreeGroup(OPTIONS, ['컴퓨터·소프트웨어공학과'])).toBe('학과·전공별 MD · 공학3계열');
    expect(findMyMicroDegreeGroup(OPTIONS, ['게임콘텐츠학과'])).toBe('학과·전공별 MD · 공학3계열');
  });

  it('광역 계열 학생은 계열 이름으로, 개편 전 학과는 이후 학과(계열) 이름으로 찾는다', () => {
    expect(findMyMicroDegreeGroup(OPTIONS, ['공학3계열', '컴퓨터·소프트웨어공학전공'])).toBe('학과·전공별 MD · 공학3계열');
    expect(findMyMicroDegreeGroup(OPTIONS, ['경영학부', '경영계열'])).toBe('학과·전공별 MD · 경영계열');
  });

  it('맞는 묶음이 없거나 학과를 모르면 null(모든 묶음을 접는다)', () => {
    expect(findMyMicroDegreeGroup(OPTIONS, ['국어교육과'])).toBeNull();
    expect(findMyMicroDegreeGroup(OPTIONS, [null, undefined])).toBeNull();
  });
});

describe('searchMicroDegrees', () => {
  it('띄어쓰기·가운뎃점을 무시하고, 학과 검색과 같은 줄임말("컴소")을 받는다', () => {
    expect(searchMicroDegrees(OPTIONS, '컴퓨터 소프트').map((m) => m.name)).toEqual(['컴퓨터·소프트웨어공학전공 - 웹프로그래밍']);
    expect(searchMicroDegrees(OPTIONS, '컴소').map((m) => m.name)).toEqual(['컴퓨터·소프트웨어공학전공 - 웹프로그래밍']);
    expect(searchMicroDegrees(OPTIONS, '이차 전지').map((m) => m.name)).toEqual(['JST 에너지신산업학부 이차전지 기초']);
  });

  it('이름이 검색어로 시작 → 이름에 포함 → 묶음 이름에 포함 순', () => {
    expect(searchMicroDegrees(OPTIONS, '공학').map((m) => m.name)).toEqual([
      '컴퓨터·소프트웨어공학전공 - 웹프로그래밍',
      '게임콘텐츠학전공 - 게임기획가',
    ]);
  });

  it('빈 검색어는 결과가 없다', () => {
    expect(searchMicroDegrees(OPTIONS, '  ')).toEqual([]);
  });
});

describe('groupByProgram', () => {
  it('묶음 순서와 묶음 안 순서를 그대로 지킨다', () => {
    expect(groupByProgram(OPTIONS).map(([g, items]) => [g, items.length])).toEqual([
      ['JST공유대학', 1],
      ['학과·전공별 MD · 공학3계열', 2],
      ['학과·전공별 MD · 경영계열', 1],
    ]);
  });
});
