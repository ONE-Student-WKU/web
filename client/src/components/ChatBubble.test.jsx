import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatBubble from './ChatBubble.jsx';

// ChatBubble은 useI18n()을 쓰지만 Provider 없이도 기본값(한국어)으로 동작한다(번역 사전 폴백).
describe('ChatBubble', () => {
  it('내 메시지에는 보낸 사람 라벨(나/Me)을 달지 않는다', () => {
    const { container } = render(<ChatBubble message={{ sender: 'user', text: '졸업요건 알려줘' }} />);
    expect(screen.getByText('졸업요건 알려줘')).toBeInTheDocument();
    expect(container.querySelector('.message-sender')).toBeNull();
    expect(container.textContent).not.toMatch(/^(나|Me)/);
  });

  it('AI 답변에는 ONE Student 라벨을 단다', () => {
    const { container } = render(<ChatBubble message={{ sender: 'assistant', text: '안녕하세요' }} />);
    expect(container.querySelector('.message-sender').textContent).toBe('ONE Student');
  });
});
