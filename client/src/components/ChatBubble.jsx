import React, { useState } from 'react';
import MessageText from './MessageText.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * ChatBubble Component
 * Renders individual chat messages (user or assistant).
 *
 * Props:
 * - message: { sender: 'user'|'assistant', text: string, timestamp: string, citedChunks?: array }
 */
function ChatBubble({ message }) {
  const { t } = useI18n();
  const [showCitations, setShowCitations] = useState(false);
  const citations = message.citedChunks || [];

  return (
    <div className={`chat-bubble ${message.sender}`}>
      {message.sender !== 'user' && <div className="message-sender">ONE Student</div>}
      {message.sender === 'user' ? (
        <div className="message-text">{message.text}</div>
      ) : (
        <MessageText text={message.text} />
      )}
      {citations.length > 0 && (
        <div className="message-citations">
          <button type="button" className="citations-toggle" onClick={() => setShowCitations((v) => !v)}>
            {showCitations ? t('chat.citationsHide') : t('chat.citationsMore', { count: citations.length })}
          </button>
          {showCitations && (
            <ul>
              {citations.map((c) => (
                <li key={c.chunkId}>
                  <strong>{c.documentTitle}</strong>
                  {/* 발췌문은 마크다운 원문을 줄 단위로 자른 것이라 답변과 같은 렌더러로 그린다(표·제목, server/services/citationExcerpt.js).
                      서버가 계산해 만든 근거는 발췌문이 없다(null) — 제목만 보인다. */}
                  {c.excerpt && <MessageText text={c.excerpt} />}
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
