import React, { useState } from 'react';

/**
 * ChatInput Component
 * Text input and submit button for sending messages.
 * 
 * Props:
 * - onSendMessage: function
 */
function ChatInput({ onSendMessage }) {
  const [text, setText] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSendMessage(text);
    setText('');
  };

  return (
    <form className="chat-input-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="메시지를 입력하세요..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit">전송</button>
    </form>
  );
}

export default ChatInput;
