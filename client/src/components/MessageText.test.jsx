import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageText from './MessageText.jsx';
import { parseBlocks } from '../utils/messageMarkdown.js';

describe('MessageText', () => {
  it('제목·굵게·목록 기호를 화면 요소로 바꾼다', () => {
    const { container } = render(
      <MessageText text={'# 졸업인증제\n\n다음 중 **1개 과목**을 이수:\n- 캡스톤디자인\n- 사회봉사\n---\n끝'} />,
    );
    expect(screen.getByText('졸업인증제')).toBeInTheDocument();
    expect(screen.getByText('1개 과목').tagName).toBe('STRONG');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('hr')).not.toBeNull();
    expect(container.textContent).not.toMatch(/[#*]|---/);
  });

  it('HTML은 글자 그대로 보여 주고 요소로 만들지 않는다', () => {
    const { container } = render(<MessageText text={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img');
  });

  it('표를 표로 그린다 — 운영에서 본 답처럼 행 사이에 빈 줄이 있어도 한 표로 묶고, 칸 안의 굵게도 처리한다(#378)', () => {
    const text = '초과학기 등록금\n\n| 신청학점 | 납부금액 |\n\n|---|---|\n\n| 1~3학점 | 수업료의 1/6 |\n\n| 4~6학점 | **수업료의 1/3** |\n\n참고: 공고 확인';
    const { container } = render(<MessageText text={text} />);
    const tables = container.querySelectorAll('table');
    expect(tables).toHaveLength(1);
    expect([...tables[0].querySelectorAll('th')].map((th) => th.textContent)).toEqual(['신청학점', '납부금액']);
    expect(tables[0].querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByText('수업료의 1/3').tagName).toBe('STRONG');
    expect(container.textContent).not.toMatch(/\||---/);
    expect(screen.getByText('참고: 공고 확인')).toBeInTheDocument();
  });

  it('구분선 줄이 없으면 표로 보지 않고 글자 그대로 둔다', () => {
    expect(parseBlocks('| a | b |\n| c | d |').map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('칸이 모자란 행은 빈칸으로 채우고, 표 안의 HTML은 요소로 만들지 않는다', () => {
    const { container } = render(<MessageText text={'| 항목 | 값 | 비고 |\n|---|---|---|\n| <img src=x onerror=alert(1)> | 1 |'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('tbody td')).toHaveLength(3);
  });

  it('빈 값이어도 오류 없이 빈 영역을 그린다', () => {
    expect(parseBlocks(undefined)).toEqual([]);
    expect(parseBlocks('')).toEqual([]);
  });
});
