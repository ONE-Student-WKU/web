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

export const getMe = () => apiRequest('/me');

export const updateProfile = (payload) => apiRequest('/me', { method: 'PATCH', body: JSON.stringify(payload) });

export const getDepartments = () => apiRequest('/onboarding/departments');

export const getTracks = (departmentId) => apiRequest(`/onboarding/tracks?departmentId=${departmentId}`);

export const submitOnboarding = (payload) =>
  apiRequest('/onboarding', { method: 'POST', body: JSON.stringify(payload) });

export const getCourseSummary = () => apiRequest('/my-courses/summary');

export const getGraduationStatus = () => apiRequest('/graduation/status');

export const getSemesters = () => apiRequest('/my-courses/semesters');

export const searchCatalog = (keyword) => apiRequest(`/courses/catalog?keyword=${encodeURIComponent(keyword)}`);

export const getMyCourses = (year, semester) => apiRequest(`/my-courses?year=${year}&semester=${semester}`);

export const getTimetable = (year, semester) => apiRequest(`/my-courses/timetable?year=${year}&semester=${semester}`);

export const addMyCourse = (payload) => apiRequest('/my-courses', { method: 'POST', body: JSON.stringify(payload) });

export const updateMyCourse = (id, payload) =>
  apiRequest(`/my-courses/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

export const deleteMyCourse = (id) => apiRequest(`/my-courses/${id}`, { method: 'DELETE' });

export const getCurrentConversation = () => apiRequest('/chat/conversations/current');

export const sendChatMessage = (conversationId, message) =>
  apiRequest('/chat/messages', { method: 'POST', body: JSON.stringify({ conversationId, message }) });
