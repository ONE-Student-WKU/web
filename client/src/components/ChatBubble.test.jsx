import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('참고한 자료는 작은 라벨로 접어 두고, 펼치면 자료 제목만 보인다(발췌문은 보여주지 않는다)', () => {
    const excerpt = ['### 개설 과목', '| 학수번호 | 교과목 |', '|---|---|', '| L00302 | 인적자원개발론 |'].join('\n');
    const { container } = render(<ChatBubble message={{ sender: 'assistant', text: '답변', citedChunks: [{ chunkId: 1, documentTitle: '교양 개설현황', excerpt }, { chunkId: 2, documentTitle: '학칙 전문' }] }} />);
    const toggle = container.querySelector('.citations-toggle');
    expect(toggle.textContent).toBe('참고한 자료 2');
    expect(container.querySelector('.message-citations li')).toBeNull();
    fireEvent.click(toggle);
    const items = [...container.querySelectorAll('.message-citations li')].map((li) => li.textContent);
    expect(items).toEqual(['교양 개설현황', '학칙 전문']);
    expect(container.querySelector('.message-citations table')).toBeNull();
  });
});
