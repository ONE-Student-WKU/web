import React, { useEffect, useRef } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import ChatBubble from '../components/ChatBubble.jsx';
import ChatInput from '../components/ChatInput.jsx';
import useChat from '../hooks/useChat.js';

/**
 * Chat Page Component
 * Connects top bar, message history list, and ChatInput.
 *
 * Props:
 * - user: object
 * - onLogout: function
 * - onGoHome: function
 * - onOpenSettings: function
 * - onOpenOnboarding: function
 * - onOpenProfile: function
 */
function Chat({ user, onLogout, onGoHome, onOpenSettings, onOpenOnboarding, onOpenProfile }) {
  const { messages, sendMessage, loading } = useChat();
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, loading]);

  return (
    <div className="chat-page">
      <Sidebar
        user={user}
        onLogout={onLogout}
        onGoHome={onGoHome}
        onOpenSettings={onOpenSettings}
        onOpenOnboarding={onOpenOnboarding}
        onOpenProfile={onOpenProfile}
      />
      <div className="chat-messages-container">
        {messages.map((msg, index) => (
          <ChatBubble key={index} message={msg} />
        ))}
        {loading && (
          <div className="chat-bubble assistant">
            <div className="message-sender">ONE Student</div>
            <div className="typing-dots" aria-label="답변을 준비하고 있어요">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <ChatInput onSendMessage={sendMessage} disabled={loading} />
      <div className="chat-disclaimer">
        본 답변은 비공식 참고용입니다. 정확한 사항은 웹정보서비스 또는 학사지원과(063-850-6788)에서 확인하세요.
      </div>
    </div>
  );
}

export default Chat;
