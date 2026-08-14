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
      <button type="submit" className="prompt-send-btn" aria-label="전송" disabled={disabled}>
        <IconArrowUp />
      </button>
    </form>
  );
}

export default ChatInput;
