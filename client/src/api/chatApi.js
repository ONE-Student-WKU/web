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
    err.data = body.data;
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

export const changePassword = (currentPassword, newPassword) =>
  apiRequest('/me/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) });

export const deleteAccount = (password) =>
  apiRequest('/me', { method: 'DELETE', body: JSON.stringify({ password }) });

export const getDepartments = () => apiRequest('/onboarding/departments');

export const getTracks = (departmentId) => apiRequest(`/onboarding/tracks?departmentId=${departmentId}`);

export const submitOnboarding = (payload) =>
  apiRequest('/onboarding', { method: 'POST', body: JSON.stringify(payload) });

export const getCourseSummary = () => apiRequest('/my-courses/summary');

export const getGraduationStatus = () => apiRequest('/graduation/status');

export const getSemesters = () => apiRequest('/my-courses/semesters');

export const searchCatalog = (keyword, year, semester) =>
  apiRequest(`/courses/catalog?keyword=${encodeURIComponent(keyword)}&year=${year}&semester=${semester}`);

export const getMyCourses = (year, semester) => apiRequest(`/my-courses?year=${year}&semester=${semester}`);

export const getTimetable = (year, semester) => apiRequest(`/my-courses/timetable?year=${year}&semester=${semester}`);

export const addMyCourse = (payload) => apiRequest('/my-courses', { method: 'POST', body: JSON.stringify(payload) });

export const updateMyCourse = (id, payload) =>
  apiRequest(`/my-courses/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

export const deleteMyCourse = (id) => apiRequest(`/my-courses/${id}`, { method: 'DELETE' });

// multipart라 apiRequest의 JSON Content-Type을 못 쓴다 — fetch가 FormData를 보낼 때
// boundary가 포함된 Content-Type을 알아서 설정하므로 직접 지정하면 안 됨.
export const importCoursesFromPdf = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE}/my-courses/import/pdf`, {
    credentials: 'include',
    method: 'POST',
    body: formData,
  });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body.code || 'REQUEST_FAILED');
    err.code = body.code;
    err.status = res.status;
    throw err;
  }
  return body.data;
};

export const confirmImportedCourses = (rows) =>
  apiRequest('/my-courses/import/confirm', { method: 'POST', body: JSON.stringify({ rows }) });

export const getCurrentConversation = () => apiRequest('/chat/conversations/current');

export const sendChatMessage = (conversationId, message) =>
  apiRequest('/chat/messages', { method: 'POST', body: JSON.stringify({ conversationId, message }) });
