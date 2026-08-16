import React, { useEffect, useRef, useState } from 'react';
import { IconArrowUp } from './icons.jsx';

const MAX_TEXTAREA_HEIGHT = 120;

/**
 * ChatInput Component
 * Multi-line growable textarea + submit button. Enter sends, Shift+Enter adds a line break.
 * Shares the .prompt-bar look with Home's chat entry button so the two feel like one control.
 *
 * Props:
 * - onSendMessage: function
 * - disabled: boolean
 */
function ChatInput({ onSendMessage, disabled }) {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [text]);

  // disabled인 동안 브라우저가 강제로 포커스를 뺏어가서(disabled 엘리먼트는 포커스를 가질 수
  // 없음), 응답이 오고 다시 입력 가능해져도 커서가 안 돌아와 매번 다시 클릭해야 하는 문제가
  // 있었다(진로 탐색/학칙 챗봇 공통 — 둘 다 이 컴포넌트를 씀). 다시 활성화되는 시점에 명시적으로
  // 포커스를 돌려준다.
  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [disabled]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (disabled || !text.trim()) return;
    onSendMessage(text);
    setText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form className="prompt-bar" onSubmit={handleSubmit}>
      <div className="prompt-bar-pill">
        <textarea
          ref={textareaRef}
          className="prompt-bar-input"
          placeholder="무엇이든 물어보세요"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
      </div>
      <button type="submit" className="prompt-send-btn" aria-label="전송" disabled={disabled}>
        <IconArrowUp />
      </button>
    </form>
  );
}

export default ChatInput;
