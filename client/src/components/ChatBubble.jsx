import React, { useState } from 'react';

/**
 * ChatBubble Component
 * Renders individual chat messages (user or assistant).
 *
 * Props:
 * - message: { sender: 'user'|'assistant', text: string, timestamp: string, citedChunks?: array }
 */
function ChatBubble({ message }) {
  const [showCitations, setShowCitations] = useState(false);
  const citations = message.citedChunks || [];

  return (
    <div className={`chat-bubble ${message.sender}`}>
      <div className="message-sender">{message.sender === 'user' ? '나' : 'ONE Student'}</div>
      <div className="message-text">{message.text}</div>
      {citations.length > 0 && (
        <div className="message-citations">
          <button type="button" className="citations-toggle" onClick={() => setShowCitations((v) => !v)}>
            {showCitations ? '출처 접기' : `출처 더 보기 (${citations.length})`}
          </button>
          {showCitations && (
            <ul>
              {citations.map((c) => (
                <li key={c.chunkId}>
                  <strong>{c.documentTitle}</strong> — {c.excerpt}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="message-time">{message.timestamp}</div>
    </div>
  );
}

export default ChatBubble;
