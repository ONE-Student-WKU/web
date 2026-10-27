import { useState, useEffect, useCallback } from 'react';
import { getCurrentConversation, sendChatMessage } from '../api/chatApi';
import { readCache, writeCache, clearCache } from '../utils/sessionCache.js';
import { useI18n } from '../i18n/I18nContext.jsx';

// Home.jsx와 동일한 이유(재진입 시 빈 화면 깜빡임 방지)로 모듈 스코프에 마지막 대화를 캐시해둔다.
// sessionStorage에서 초기값을 복원해서, 탭이 살아있는 채로 페이지가 다시 로드되는 경우
// (utils/sessionCache.js 참고)에도 즉시 보여줄 수 있다.
const chatCache = {
  conversationId: readCache('chat_conversationId'),
  messages: readCache('chat_messages'),
};

// pages/Home.jsx의 resetHomeCache와 동일한 이유 — 로그아웃/계정 삭제 시 App.jsx가 호출.
export function resetChatCache() {
  chatCache.conversationId = null;
  chatCache.messages = null;
  clearCache('chat_conversationId');
  clearCache('chat_messages');
}

/**
 * Custom hook for chat operations and state management.
 */
function useChat() {
  const { t, lang } = useI18n();
  const [conversationId, setConversationId] = useState(chatCache.conversationId);
  const [messages, setMessages] = useState(chatCache.messages || []);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(chatCache.messages === null);
  const [loadFailed, setLoadFailed] = useState(false);

  // 대화를 못 불러오면 예전에는 콘솔에만 남겨, 질문을 보내도 입력 칸만 비워지고 아무 반응이 없었다(2026-10-27 화면 점검).
  // 이제 실패를 화면에 알리고(loadFailed) 다시 시도할 수 있게 한다.
  const loadConversation = useCallback(() => {
    setLoadFailed(false);
    setInitialLoading(chatCache.messages === null);
    getCurrentConversation()
      .then((data) => {
        setConversationId(data.conversationId);
        setMessages(
          data.messages.map((m) => ({
            sender: m.role,
            text: m.content,
            sentAt: m.createdAt,
          }))
        );
        chatCache.conversationId = data.conversationId;
        writeCache('chat_conversationId', data.conversationId);
      })
      .catch((error) => {
        console.error('Failed to load conversation:', error);
        setLoadFailed(true);
      })
      .finally(() => setInitialLoading(false));
  }, []);

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  // 대화 화면을 나갔다가 돌아왔을 때 직전 메시지를 바로 보여줄 수 있도록, 메시지가
  // 바뀔 때마다(전송/응답 도착 포함) 캐시도 같이 갱신해둔다.
  useEffect(() => {
    chatCache.messages = messages;
    writeCache('chat_messages', messages);
  }, [messages]);

  const sendMessage = useCallback(
    async (text) => {
      if (!conversationId) return;

      const userMsg = { sender: 'user', text, sentAt: new Date().toISOString() };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        const response = await sendChatMessage(conversationId, text, lang);
        const assistantMsg = {
          sender: 'assistant',
          text: response.content,
          sentAt: new Date().toISOString(),
          citedChunks: response.citedChunks,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (error) {
        console.error('Failed to send message:', error);
        const text =
          error.code === 'CHAT_DAILY_LIMIT_EXCEEDED'
            ? t('chat.dailyLimit', { limit: error.data?.limit ?? 20 })
            : t('chat.error');
        setMessages((prev) => [...prev, { sender: 'assistant', text, sentAt: new Date().toISOString() }]);
      } finally {
        setLoading(false);
      }
    },
    [conversationId, t, lang]
  );

  return {
    messages,
    loading,
    initialLoading,
    sendMessage,
    // 대화 번호가 있어야 보낼 수 있다(이전에 받아 둔 번호가 있으면 새로 받기에 실패해도 보낼 수 있다).
    canSend: Boolean(conversationId),
    loadFailed,
    reload: loadConversation,
  };
}

export default useChat;
