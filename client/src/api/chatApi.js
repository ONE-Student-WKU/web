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

// Google 로그인/재인증은 풀 페이지 브라우저 리다이렉트가 필요해서(fetch로는 Google의
// 동의 화면 리다이렉트 체인을 탈 수 없음) apiRequest가 아니라 직접 네비게이션한다.
// consent: 로그인 폼에서 동의한 이용약관·개인정보 수집·이용의 버전(utils/consent.js) — 서버가 현재 버전과 같을 때만 로그인을 시작한다.
export const startGoogleLogin = (remember = true, consent = '') => {
  window.location.href = `/api/auth/google?remember=${remember ? '1' : '0'}&consent=${encodeURIComponent(consent)}`;
};

export const startGoogleReauth = () => {
  window.location.href = '/api/auth/google/reauth';
};

// 이메일 인증코드(OTP) 로그인 — 구글과 달리 fetch 응답으로 바로 끝나므로(풀 페이지
// 리다이렉트 없음) apiRequest로 처리한다.
export const requestEmailCode = (email, consent) =>
  apiRequest('/auth/email/request', { method: 'POST', body: JSON.stringify({ email, consent }) });

export const verifyEmailCode = (email, code, remember = true, consent) =>
  apiRequest('/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code, remember, consent }) });

// 로그인 직후 동의 화면(ConsentGate)에서 이용약관·개인정보 수집·이용에 동의한다.
export const acceptConsent = (version) => apiRequest('/me/consent', { method: 'POST', body: JSON.stringify({ version }) });

// 이메일 OTP로만 가입한 계정(oauth_id 없음)의 계정 삭제 재인증 — Google 계정은
// startGoogleReauth를 그대로 쓴다. 대상 이메일은 서버가 세션의 본인 계정 것으로 고정하므로
// 여기서 이메일을 따로 안 보낸다.
export const requestDeleteReauthCode = () => apiRequest('/auth/email/delete-reauth/request', { method: 'POST' });

export const verifyDeleteReauthCode = (code) =>
  apiRequest('/auth/email/delete-reauth/verify', { method: 'POST', body: JSON.stringify({ code }) });

export const logout = () => apiRequest('/auth/logout', { method: 'POST' });

export const getMe = () => apiRequest('/me');

export const updateProfile = (payload) => apiRequest('/me', { method: 'PATCH', body: JSON.stringify(payload) });

export const deleteAccount = () => apiRequest('/me', { method: 'DELETE' });

export const getDepartments = () => apiRequest('/onboarding/departments');

export const getTracks = (departmentId) => apiRequest(`/onboarding/tracks?departmentId=${departmentId}`);

export const submitOnboarding = (payload) =>
  apiRequest('/onboarding', { method: 'POST', body: JSON.stringify(payload) });

export const getCourseSummary = () => apiRequest('/my-courses/summary');

export const getGraduationStatus = () => apiRequest('/graduation/status');

export const getSemesters = () => apiRequest('/my-courses/semesters');

export const getRetakeEligibleCourses = () => apiRequest('/my-courses/retake-eligible');

export const searchCatalog = (keyword, year, semester) =>
  apiRequest(`/courses/catalog?keyword=${encodeURIComponent(keyword)}&year=${year}&semester=${semester}`);

export const getMyCourses = (year, semester) => apiRequest(`/my-courses?year=${year}&semester=${semester}`);

export const getTimetable = (year, semester) => apiRequest(`/my-courses/timetable?year=${year}&semester=${semester}`);

export const addMyCourse = (payload) => apiRequest('/my-courses', { method: 'POST', body: JSON.stringify(payload) });

export const updateMyCourse = (id, payload) =>
  apiRequest(`/my-courses/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

export const deleteMyCourse = (id) => apiRequest(`/my-courses/${id}`, { method: 'DELETE' });

export const deleteAllMyCourses = () => apiRequest('/my-courses', { method: 'DELETE' });

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

export const importCoursesFromText = (text) =>
  apiRequest('/my-courses/import/text', { method: 'POST', body: JSON.stringify({ text }) });

export const confirmImportedCourses = (rows) =>
  apiRequest('/my-courses/import/confirm', { method: 'POST', body: JSON.stringify({ rows }) });

export const getCurrentConversation = () => apiRequest('/chat/conversations/current');

// language: 챗봇 답변 언어('ko' | 'en') — 화면 언어와 같은 값을 보낸다(서버가 허용 목록으로 검증).
export const sendChatMessage = (conversationId, message, language) =>
  apiRequest('/chat/messages', { method: 'POST', body: JSON.stringify({ conversationId, message, language }) });

export const getLatestCareerSession = () => apiRequest('/career/sessions/latest');

export const getLatestConfirmedRoadmap = () => apiRequest('/career/roadmap/latest');

export const createCareerSession = () => apiRequest('/career/sessions', { method: 'POST' });

export const submitCareerFixedAnswers = (sessionId, fixedAnswers, language) =>
  apiRequest(`/career/sessions/${sessionId}/fixed-answers`, { method: 'POST', body: JSON.stringify({ fixedAnswers, language }) });

export const updateCareerFixedAnswers = (sessionId, fixedAnswers) =>
  apiRequest(`/career/sessions/${sessionId}/fixed-answers`, { method: 'PATCH', body: JSON.stringify({ fixedAnswers }) });

export const sendCareerMessage = (sessionId, content, language) =>
  apiRequest(`/career/sessions/${sessionId}/messages`, { method: 'POST', body: JSON.stringify({ content, language }) });

export const generateCareerCandidates = (sessionId, language) =>
  apiRequest(`/career/sessions/${sessionId}/candidates`, { method: 'POST', body: JSON.stringify({ language }) });

export const confirmCareer = (sessionId, careerName, language) =>
  apiRequest(`/career/sessions/${sessionId}/confirm`, { method: 'POST', body: JSON.stringify({ careerName, language }) });

export const getCommunityPosts = () => apiRequest('/community');

export const getMyCommunityPosts = () => apiRequest('/community/mine');

export const getCommunityPost = (id) => apiRequest(`/community/${id}`);

export const createCommunityPost = (payload) =>
  apiRequest('/community', { method: 'POST', body: JSON.stringify(payload) });

export const editCommunityPost = (id, payload) =>
  apiRequest(`/community/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

export const deleteCommunityPost = (id) => apiRequest(`/community/${id}`, { method: 'DELETE' });

export const closeCommunityPost = (id) => apiRequest(`/community/${id}/close`, { method: 'POST' });

export const applyToCommunityPost = (id, message) =>
  apiRequest(`/community/${id}/apply`, { method: 'POST', body: JSON.stringify({ message }) });

export const getMyCommunityApplications = () => apiRequest('/community/applications/mine');

export const getCommunityApplicants = (id) => apiRequest(`/community/${id}/applications`);

export const acceptCommunityApplication = (id) =>
  apiRequest(`/community/applications/${id}/accept`, { method: 'POST' });

export const rejectCommunityApplication = (id, reason) =>
  apiRequest(`/community/applications/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });

export const reportCommunityPost = (id, reason) =>
  apiRequest(`/community/${id}/report`, { method: 'POST', body: JSON.stringify({ reason }) });

export const reportCommunityApplication = (id, reason) =>
  apiRequest(`/community/applications/${id}/report`, { method: 'POST', body: JSON.stringify({ reason }) });

export const getAdminCommunityPosts = (status) => apiRequest(`/admin/community/posts?status=${status}`);

export const approveAdminPost = (id) => apiRequest(`/admin/community/posts/${id}/approve`, { method: 'POST' });

export const rejectAdminPost = (id, reason) =>
  apiRequest(`/admin/community/posts/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });

export const deleteAdminPost = (id) => apiRequest(`/admin/community/posts/${id}`, { method: 'DELETE' });

export const deleteAdminApplication = (id) => apiRequest(`/admin/community/applications/${id}`, { method: 'DELETE' });

export const getAdminReports = (status) => apiRequest(`/admin/community/reports?status=${status}`);

// note(선택): 신고자에게 보이는 처리 안내. 비우면 서버가 NULL로 저장하고 신고자 화면이 기본 문구를 보여준다.
export const resolveAdminReport = (id, note) =>
  apiRequest(`/admin/community/reports/${id}/resolve`, { method: 'POST', body: JSON.stringify({ note: note ?? null }) });

// reason은 제재받는 사용자에게, resolutionNote(선택)는 신고자에게 보이는 별개의 문구다.
export const sanctionReport = (id, { scope, duration, reason, resolutionNote }) =>
  apiRequest(`/admin/community/reports/${id}/sanction`, {
    method: 'POST',
    body: JSON.stringify({ scope, duration, reason, resolutionNote: resolutionNote ?? null }),
  });

// 신고자 본인의 신고 내역(처리 상태 + 관리자 처리 안내) / 읽지 않은 처리 결과 수 / 확인 처리.
export const getMyReports = () => apiRequest('/community/reports/mine');
export const getUnseenReportCount = () => apiRequest('/community/reports/unseen-count').then((d) => d.count);
export const markMyReportsSeen = () => apiRequest('/community/reports/seen', { method: 'POST' });

// 신고 대상자 요약(읽기 전용, 관리자 전용). 서버가 아직 이 엔드포인트가 없는 배포 순서면 404 → 화면이 에러 안내만 보여준다.
export const getReportedStudentSummary = (studentId) => apiRequest(`/admin/community/students/${studentId}/summary`);

export const getAdminSanctions = () => apiRequest('/admin/sanctions');

export const liftSanction = (id) => apiRequest(`/admin/sanctions/${id}/lift`, { method: 'POST' });

export const getMySanction = () => apiRequest('/community/my-sanction');

export const createInquiry = (title, content) =>
  apiRequest('/inquiries', { method: 'POST', body: JSON.stringify({ title, content }) });

export const getMyInquiries = () => apiRequest('/inquiries/mine');

export const getAdminInquiries = (status) => apiRequest(`/admin/inquiries?status=${status}`);

export const resolveAdminInquiry = (id) => apiRequest(`/admin/inquiries/${id}/resolve`, { method: 'POST' });

export const getAdminStats = () => apiRequest('/admin/stats');
