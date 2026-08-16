import { useState, useEffect, useCallback } from 'react';
import { getCurrentConversation, sendChatMessage } from '../api/chatApi';

// Home.jsx와 동일한 이유(재진입 시 빈 화면 깜빡임 방지)로 모듈 스코프에 마지막 대화를 캐시해둔다.
const chatCache = { conversationId: null, messages: null };

/**
 * Custom hook for chat operations and state management.
 */
function useChat() {
  const [conversationId, setConversationId] = useState(chatCache.conversationId);
  const [messages, setMessages] = useState(chatCache.messages || []);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(chatCache.messages === null);

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
        chatCache.conversationId = data.conversationId;
      })
      .catch((error) => console.error('Failed to load conversation:', error))
      .finally(() => setInitialLoading(false));
  }, []);

  // 대화 화면을 나갔다가 돌아왔을 때 직전 메시지를 바로 보여줄 수 있도록, 메시지가
  // 바뀔 때마다(전송/응답 도착 포함) 캐시도 같이 갱신해둔다.
  useEffect(() => {
    chatCache.messages = messages;
  }, [messages]);

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
    initialLoading,
    sendMessage,
  };
}

export default useChat;
