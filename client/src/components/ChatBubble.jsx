import React, { useState } from 'react';
import MessageText from './MessageText.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import { formatChatTime } from '../utils/chatTime.js';

/**
 * ChatBubble Component
 * Renders individual chat messages (user or assistant).
 *
 * Props:
 * - message: { sender: 'user'|'assistant', text: string, sentAt?: string(ISO), timestamp?: string, citedChunks?: array }
 *   시각은 sentAt을 화면 언어로 바꿔 보여 준다(utils/chatTime.js). timestamp(미리 만든 글자)는 sentAt이 없던 예전 캐시 메시지용.
 */
function ChatBubble({ message }) {
  const { t, lang } = useI18n();
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
          {/* 학생은 근거 문서를 읽으려는 게 아니라 답을 원해서, 출처는 작은 라벨로 접어 두고 펼쳐도 자료 제목만 보인다
              (2026-10-22 피드백 — 발췌문까지 보여주면 피로만 늘었다). 서버는 발췌문(excerpt)을 계속 내려주지만 화면에서는 쓰지 않는다. */}
          {showCitations && (
            <ul>
              {citations.map((c) => (
                <li key={c.chunkId}>{c.documentTitle}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="message-time">{message.sentAt ? formatChatTime(message.sentAt, lang) : message.timestamp}</div>
    </div>
  );
}

export default ChatBubble;
