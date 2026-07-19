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
      </main>
    </div>
  );
}

export default Chat;
