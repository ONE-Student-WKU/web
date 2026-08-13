import { useState, useEffect, useCallback } from 'react';
import { getCurrentConversation, sendChatMessage } from '../api/chatApi';

/**
 * Custom hook for chat operations and state management.
 */
function useChat() {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getCurrentConversation()
      .then((data) => {
        setConversationId(data.conversationId);
        setMessages(
          data.messages.map((m) => ({
            sender: m.role,
            text: m.content,
            timestamp: new Date(m.createdAt).toLocaleTimeString(),
          }))
        );
      })
      .catch((error) => console.error('Failed to load conversation:', error));
  }, []);

  const sendMessage = useCallback(
    async (text) => {
      if (!conversationId) return;

      const userMsg = { sender: 'user', text, timestamp: new Date().toLocaleTimeString() };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        const response = await sendChatMessage(conversationId, text);
        const assistantMsg = {
          sender: 'assistant',
          text: response.content,
          timestamp: new Date().toLocaleTimeString(),
          citedChunks: response.citedChunks,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (error) {
        console.error('Failed to send message:', error);
        setMessages((prev) => [
          ...prev,
          { sender: 'assistant', text: '오류가 발생했어요. 잠시 후 다시 시도해주세요.', timestamp: new Date().toLocaleTimeString() },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [conversationId]
  );

  return {
    messages,
    loading,
    sendMessage,
  };
}

export default useChat;
