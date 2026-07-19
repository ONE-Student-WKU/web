import React from 'react';

/**
 * ChatBubble Component
 * Renders individual chat messages (user or assistant).
 * 
 * Props:
 * - message: { sender: 'user'|'assistant', text: string, timestamp: string }
 */
function ChatBubble({ message }) {
  // TODO: Add visual layout and styling depending on message.sender
  return (
    <div className={`chat-bubble ${message.sender}`}>
      <div className="message-sender">{message.sender === 'user' ? '나' : 'WKU AI'}</div>
      <div className="message-text">{message.text}</div>
      <div className="message-time">{message.timestamp}</div>
    </div>
  );
}

export default ChatBubble;
