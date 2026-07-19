/**
 * chatApi.js
 * API service layer helper to communicate with backend routes.
 */

export const login = async (studentId, password) => {
  // TODO: Call POST /api/auth/login
  return { success: true, user: { studentId, name: '홍길동' } };
};

export const logout = async () => {
  // TODO: Call POST /api/auth/logout
  return { success: true };
};

export const sendChatMessage = async (messageText) => {
  // TODO: Call POST /api/chat
  return {
    reply: `이것은 AI 답변의 뼈대입니다. 입력하신 메시지: "${messageText}"`,
  };
};

export const fetchAcademicInfo = async () => {
  // TODO: Call GET /api/mockInfo
  return [];
};
