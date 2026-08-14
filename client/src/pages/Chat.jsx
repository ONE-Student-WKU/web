import React from 'react';
import Sidebar from '../components/Sidebar.jsx';
import ChatBubble from '../components/ChatBubble.jsx';
import ChatInput from '../components/ChatInput.jsx';
import useChat from '../hooks/useChat.js';

/**
 * Chat Page Component
 * Connects Sidebar, message history list, and ChatInput.
 * 
 * Props:
 * - user: object
 * - onLogout: function
 */
function Chat({ user, onLogout }) {
  const { messages, sendMessage } = useChat();

  return (
    <div className="chat-page-container">
      <Sidebar user={user} onLogout={onLogout} />
      <main className="chat-main-area">
        <div className="chat-messages-container">
          {messages.map((msg, index) => (
            <ChatBubble key={index} message={msg} />
          ))}
        </div>
        <ChatInput onSendMessage={sendMessage} />
        <div className="chat-disclaimer">본 답변은 비공식 참고용입니다. 정확한 사항은 학사지원과(063-850-6788)에 확인하세요.</div>
      </main>
    </div>
  );
}

export default Chat;
