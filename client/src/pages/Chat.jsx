import React, { useEffect, useRef, useState } from 'react';
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
 * - onInputFocusChange: function(boolean) — optional, 입력창 포커스 상태를 상위(App)에 전달해
 *   모바일 키보드가 떠 있는 동안 하단 탭바를 같이 숨길 수 있게 한다.
 */
function Chat({ user, onLogout, onGoHome, onOpenSettings, onOpenOnboarding, onOpenProfile, onInputFocusChange }) {
  const { messages, sendMessage, loading, initialLoading } = useChat();
  const bottomRef = useRef(null);
  // 모바일에서 입력창에 포커스가 가면(키보드가 뜨면) 화면이 좁아지므로, 입력창 자체를
  // 제외한 주변 UI(안내 문구, 하단 탭바)를 잠깐 접어 입력 공간을 확보한다.
  const [inputFocused, setInputFocused] = useState(false);
  const handleInputFocusChange = (focused) => {
    setInputFocused(focused);
    onInputFocusChange?.(focused);
  };

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
        {initialLoading && messages.length === 0 && (
          <div className="chat-bubble assistant">
            <div className="message-sender">ONE Student</div>
            <div className="skeleton skeleton-text skeleton-row" />
          </div>
        )}
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
      <ChatInput onSendMessage={sendMessage} disabled={loading} onFocusChange={handleInputFocusChange} />
      {!inputFocused && (
        <div className="chat-disclaimer">
          본 답변은 비공식 참고용입니다. 정확한 사항은 웹정보서비스 또는 학사지원과(063-850-6788)에서 확인하세요.
        </div>
      )}
    </div>
  );
}

export default Chat;
