import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CareerRoadmapList from './CareerRoadmapList.jsx';

// Provider 없이 렌더하면 기본값(한국어) 사전을 쓴다.
const URL = 'https://intra.wku.ac.kr/SWupis/V005/Service/Emplo/LecPlan/searchLecPlanInfo.jsp?year=2026&term=2&gubun=3&gubunvalue=169020';

describe('CareerRoadmapList — 수업계획서 링크', () => {
  it('syllabusUrl이 있는 과목에만 새 창으로 여는 수업계획서 링크를 단다', () => {
    render(
      <CareerRoadmapList
        roadmap={[
          { grade: 3, semester: 2, courseName: '경영정보', reason: '데이터 기반 의사결정에 도움', syllabusUrl: URL },
          { grade: 3, semester: 2, courseName: '학수번호없는과목', reason: '이유', syllabusUrl: null },
        ]}
      />
    );
    const links = screen.getAllByRole('link', { name: '수업계획서 보기' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', URL);
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('추천 이유가 과목명만 보고 쓴 설명이라는 안내를 목록 맨 위(첫 과목 위)에 한 번만 보여 준다(빈 목록에는 없음)', () => {
    const { container, rerender } = render(
      <CareerRoadmapList roadmap={[{ grade: 1, semester: 1, courseName: 'a', reason: 'b', syllabusUrl: null }, { grade: 2, semester: 1, courseName: 'c', reason: 'd', syllabusUrl: null }]} />
    );
    const notes = container.querySelectorAll('.career-roadmap-note');
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toMatch(/수업계획서/);
    expect(container.firstElementChild).toBe(notes[0]);
    rerender(<CareerRoadmapList roadmap={[]} />);
    expect(container.querySelector('.career-roadmap-note')).toBeNull();
  });
});
