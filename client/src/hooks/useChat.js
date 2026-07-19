import { useState, useCallback } from 'react';
import { sendChatMessage } from '../api/chatApi';

/**
 * Custom hook for chat operations and state management.
 */
function useChat() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const sendMessage = useCallback(async (text) => {
    // Add user message
    const userMsg = {
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      // Send to server
      const response = await sendChatMessage(text);
      
      // Add assistant response
      const assistantMsg = {
        sender: 'assistant',
        text: response.reply,
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    messages,
    loading,
    sendMessage,
  };
}

export default useChat;
