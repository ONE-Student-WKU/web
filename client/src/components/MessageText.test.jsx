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

  it('빈 값이어도 오류 없이 빈 영역을 그린다', () => {
    expect(parseBlocks(undefined)).toEqual([]);
    expect(parseBlocks('')).toEqual([]);
  });
});
