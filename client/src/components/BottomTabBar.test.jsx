import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BottomTabBar from './BottomTabBar.jsx';

/**
 * client/src/components/BottomTabBar.test.jsx
 * 빈 자리(null)는 자리만 지키고, 4자리가 모두 비면 챗봇 버튼만 남는다.
 */

const labels = () => screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));

describe('BottomTabBar', () => {
  it('빈 자리는 버튼 없이 자리만 차지한다', () => {
    const { container } = render(<BottomTabBar tabs={['home', null, 'career', null]} active="home" onOpen={() => {}} />);
    expect(labels()).toHaveLength(3);
    expect(container.querySelectorAll('.bottom-tab-empty')).toHaveLength(2);
    expect(container.querySelector('nav')).not.toHaveClass('chat-only');
  });

  it('4자리가 모두 비면 바 없이 챗봇 버튼만 그린다', () => {
    const { container } = render(<BottomTabBar tabs={[null, null, null, null]} active={null} onOpen={() => {}} />);
    expect(labels()).toHaveLength(1);
    expect(container.querySelector('.bottom-tab-chat')).toBeInTheDocument();
    expect(container.querySelector('nav')).toHaveClass('chat-only');
    expect(container.querySelectorAll('.bottom-tab-empty')).toHaveLength(0);
  });
});
