import React, { useRef, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import ChatBubble from '../components/ChatBubble.jsx';
import ChatInput from '../components/ChatInput.jsx';
import LoadError from '../components/LoadError.jsx';
import useChat from '../hooks/useChat.js';
import useChatAutoScroll from '../hooks/useChatAutoScroll.js';
import { useI18n } from '../i18n/I18nContext.jsx';

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
  const { t } = useI18n();
  const { messages, sendMessage, loading, initialLoading, canSend, loadFailed, reload } = useChat();
  const listRef = useRef(null);
  // 모바일에서 입력창에 포커스가 가면(키보드가 뜨면) 화면이 좁아지므로, 입력창 자체를
  // 제외한 주변 UI(안내 문구)를 잠깐 접어 입력 공간을 확보한다. 하단 탭바는 App.jsx가
  // 입력 칸 포커스를 보고 알아서 접는다(useTextInputFocused).
  const [inputFocused, setInputFocused] = useState(false);

  // 기다리는 동안은 맨 아래, 답이 오면 답의 첫 줄로 스크롤한다. 키보드가 뜨거나 안내 문구가 다시 나타나 목록 높이가
  // 바뀌는 것도 훅이 따라간다 — 예전처럼 입력창 포커스 때 맨 아래로 보내면, 답이 온 뒤 입력창이 저절로 다시 포커스를
  // 받는 순간(ChatInput) 답의 첫 줄에서 끝으로 튀었다.
  useChatAutoScroll(listRef, {
    count: messages.length,
    lastSender: messages[messages.length - 1]?.sender,
    waiting: loading,
  });

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
      <div className="chat-messages-container" ref={listRef}>
        {initialLoading && messages.length === 0 && (
          <div className="chat-bubble assistant">
            <div className="message-sender">ONE Student</div>
            <div className="skeleton skeleton-text skeleton-row" />
          </div>
        )}
        {loadFailed && !canSend && <LoadError message={t('chat.err.load')} onRetry={reload} />}
        {messages.map((msg, index) => (
          <ChatBubble key={index} message={msg} />
        ))}
        {loading && (
          <div className="chat-bubble assistant">
            <div className="message-sender">ONE Student</div>
            <div className="typing-dots" aria-label={t('chat.typing')}>
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
      </div>
      <ChatInput onSendMessage={sendMessage} disabled={loading} sendBlocked={!canSend} onFocusChange={setInputFocused} />
      {!inputFocused && (
        <div className="chat-disclaimer">
          {t('chat.disclaimer')}
        </div>
      )}
    </div>
  );
}

export default Chat;
