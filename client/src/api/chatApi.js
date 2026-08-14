/**
 * chatApi.js
 * API service layer helper to communicate with backend routes.
 */

const BASE = '/api';

async function apiRequest(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json();

  if (!res.ok) {
    const err = new Error(body.code || 'REQUEST_FAILED');
    err.code = body.code;
    err.status = res.status;
    throw err;
  }
  return body.data;
}

export const signup = (email, password, name) =>
  apiRequest('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) });

export const login = (email, password) =>
  apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });

export const logout = () => apiRequest('/auth/logout', { method: 'POST' });

export const getCurrentConversation = () => apiRequest('/chat/conversations/current');

export const sendChatMessage = (conversationId, message) =>
  apiRequest('/chat/messages', { method: 'POST', body: JSON.stringify({ conversationId, message }) });
