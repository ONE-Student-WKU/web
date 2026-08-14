import React from 'react';

/**
 * ChatBubble Component
 * Renders individual chat messages (user or assistant).
 * 
 * Props:
 * - message: { sender: 'user'|'assistant', text: string, timestamp: string }
 */
function ChatBubble({ message }) {
  return (
    <div className={`chat-bubble ${message.sender}`}>
      <div className="message-sender">{message.sender === 'user' ? '나' : 'WKU AI'}</div>
      <div className="message-text">{message.text}</div>
      {message.citedChunks?.length > 0 && (
        <div className="message-citations">
          <div className="message-citations-label">출처</div>
          <ul>
            {message.citedChunks.map((c) => (
              <li key={c.chunkId}>
                <strong>{c.documentTitle}</strong> — {c.excerpt}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="message-time">{message.timestamp}</div>
    </div>
  );
}

export default ChatBubble;
