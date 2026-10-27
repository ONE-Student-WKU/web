import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('./api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getMe: vi.fn(),
  logout: vi.fn(),
  updateProfile: vi.fn(),
  getUnseenReportCount: vi.fn(),
  getUnseenNoticeCount: vi.fn(),
}));

// 화면은 가벼운 스텁으로 — 이 테스트는 "정지 화면으로 바뀌고 요청이 멈추는가"만 본다.
vi.mock('./pages/Login.jsx', () => ({ default: () => <div>LOGIN</div> }));
vi.mock('./pages/Home.jsx', () => ({ default: () => <div>HOME</div>, resetHomeCache: () => {} }));
vi.mock('./pages/Chat.jsx', () => ({ default: () => <div>CHAT</div> }));
vi.mock('./pages/CourseManagement.jsx', () => ({ default: () => <div>COURSES</div>, resetCourseMgmtCache: () => {} }));
vi.mock('./pages/GraduationStatus.jsx', () => ({ default: () => <div>GRAD</div>, resetGraduationCache: () => {} }));
vi.mock('./pages/CareerExploration.jsx', () => ({ default: () => <div>CAREER</div> }));
vi.mock('./pages/Onboarding.jsx', () => ({ default: () => <div>ONBOARDING</div> }));
vi.mock('./pages/Profile.jsx', () => ({ default: () => <div>PROFILE</div>, resetProfileCache: () => {} }));
vi.mock('./pages/Community.jsx', () => ({ default: () => <div>COMMUNITY</div>, resetCommunityCache: () => {} }));
vi.mock('./pages/Admin.jsx', () => ({ default: () => <div>ADMIN</div> }));
vi.mock('./pages/Inquiry.jsx', () => ({ default: () => <div>INQUIRY</div> }));
vi.mock('./pages/PrivacyPolicy.jsx', () => ({ default: () => <div>PRIVACY</div> }));
vi.mock('./pages/TermsOfService.jsx', () => ({ default: () => <div>TERMS</div> }));
vi.mock('./components/BottomTabBar.jsx', () => ({ default: () => <nav>TABBAR</nav> }));

import * as api from './api/chatApi.js';
import App from './App.jsx';
import { LanguageProvider } from './i18n/I18nContext.jsx';

/**
 * client/src/App.suspension.test.jsx
 * 서비스 전체 이용 정지(#457)의 화면 전환(App.jsx): 정지된 계정은 정지 화면만 보고, 정지 뒤에는 요청이 반복되지 않는다.
 * 403 ACCOUNT_SUSPENDED를 받을 때마다 user를 새 객체로 바꾸면 user에 기대는 이펙트가 다시 요청을 보내 끝없이 돌았다.
 */

const suspension = { reason: '문의하기에서 욕설 반복', endsAt: null };
const student = (extra = {}) => ({ id: 2, name: '학생', role: 'student', onboardingCompleted: true, language: 'ko', ...extra });

// chatApi.js의 apiRequest가 403 ACCOUNT_SUSPENDED를 받았을 때 하는 일을 흉내 낸다.
function rejectAsSuspended() {
  window.dispatchEvent(new CustomEvent('account-suspended', { detail: suspension }));
  return Promise.reject(Object.assign(new Error('suspended'), { code: 'ACCOUNT_SUSPENDED' }));
}

function renderApp() {
  return render(
    <LanguageProvider>
      <App />
    </LanguageProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  api.updateProfile.mockResolvedValue({});
});

describe('서비스 전체 이용 정지 화면', () => {
  it('로그인할 때 이미 정지돼 있으면 정지 화면만 보이고, 막힐 요청(안 읽은 수)은 보내지 않는다', async () => {
    api.getMe.mockResolvedValue(student({ suspension }));
    api.getUnseenReportCount.mockImplementation(rejectAsSuspended);
    api.getUnseenNoticeCount.mockImplementation(rejectAsSuspended);
    renderApp();

    expect(await screen.findByRole('heading', { name: '이용이 정지됐어요' })).toBeInTheDocument();
    expect(screen.queryByText('TABBAR')).not.toBeInTheDocument();
    expect(api.getUnseenReportCount).not.toHaveBeenCalled();
    expect(api.getUnseenNoticeCount).not.toHaveBeenCalled();
  });

  it('쓰는 도중에 정지되면 다음 요청의 403으로 정지 화면으로 바뀌고, 요청이 반복되지 않는다', async () => {
    api.getMe.mockResolvedValue(student());
    api.getUnseenReportCount.mockImplementation(rejectAsSuspended);
    api.getUnseenNoticeCount.mockImplementation(rejectAsSuspended);
    renderApp();

    expect(await screen.findByRole('heading', { name: '이용이 정지됐어요' })).toBeInTheDocument();
    // 정지 화면이 뜬 뒤 이벤트가 또 와도(다른 요청의 403) 화면을 다시 그리지 않아 이펙트가 다시 돌지 않는다.
    window.dispatchEvent(new CustomEvent('account-suspended', { detail: suspension }));
    await new Promise((r) => setTimeout(r, 50));
    await waitFor(() => expect(api.getUnseenReportCount).toHaveBeenCalledTimes(1));
    expect(api.getUnseenNoticeCount).toHaveBeenCalledTimes(1);
  });
});
