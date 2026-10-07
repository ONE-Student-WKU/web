import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getMe: vi.fn(),
  logout: vi.fn(),
}));

// 화면 컴포넌트는 가벼운 스텁으로 바꾼다 — 이 테스트는 "새로고침 후 어떤 화면에서 시작하는가"만 본다.
vi.mock('./pages/Login.jsx', () => ({ default: () => <div>LOGIN</div> }));
vi.mock('./pages/Home.jsx', () => ({
  default: ({ onOpenAdmin }) => (
    <div>
      HOME
      <button onClick={onOpenAdmin}>go-admin</button>
    </div>
  ),
  resetHomeCache: () => {},
}));
vi.mock('./pages/Admin.jsx', () => ({
  default: ({ onGoHome }) => (
    <div>
      ADMIN
      <button onClick={onGoHome}>go-home</button>
    </div>
  ),
}));
vi.mock('./pages/Chat.jsx', () => ({ default: () => <div>CHAT</div> }));
vi.mock('./pages/CourseManagement.jsx', () => ({ default: () => <div>COURSES</div>, resetCourseMgmtCache: () => {} }));
vi.mock('./pages/GraduationStatus.jsx', () => ({ default: () => <div>GRAD</div>, resetGraduationCache: () => {} }));
vi.mock('./pages/CareerExploration.jsx', () => ({ default: () => <div>CAREER</div> }));
vi.mock('./pages/Settings.jsx', () => ({ default: () => <div>SETTINGS</div> }));
vi.mock('./pages/Onboarding.jsx', () => ({ default: () => <div>ONBOARDING</div> }));
vi.mock('./pages/Profile.jsx', () => ({ default: () => <div>PROFILE</div>, resetProfileCache: () => {} }));
vi.mock('./pages/Community.jsx', () => ({ default: () => <div>COMMUNITY</div>, resetCommunityCache: () => {} }));
vi.mock('./pages/Inquiry.jsx', () => ({ default: () => <div>INQUIRY</div> }));
vi.mock('./pages/PrivacyPolicy.jsx', () => ({ default: () => <div>PRIVACY</div> }));
vi.mock('./pages/TermsOfService.jsx', () => ({ default: () => <div>TERMS</div> }));
vi.mock('./components/BottomTabBar.jsx', () => ({ default: () => <nav>TABBAR</nav> }));

import * as api from './api/chatApi.js';
import App from './App.jsx';

/**
 * client/src/App.adminRefresh.test.jsx
 * 관리자 화면에서 새로고침해도 관리자 화면에 머무는지(PR2, 항목 3). 새로고침 = App이 새로 마운트되는 것이고,
 * 그때 남아 있는 건 sessionStorage의 표시뿐이다. 관리자가 아닌 사용자가 그 표시로 관리자 화면에 못 들어가는 것도 확인한다.
 */

const KEY = 'wku_cache_app_view'; // utils/sessionCache.js의 PREFIX + 'app_view'
const admin = { id: 1, name: '관리자', role: 'admin', onboardingCompleted: true };
const student = { id: 2, name: '학생', role: 'student', onboardingCompleted: true };

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom에는 matchMedia가 없다 — App이 테마 초기값을 구할 때 쓰므로 스텁(라이트 테마 아님).
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('관리자 화면 새로고침', () => {
  it('관리자 화면에 있다가 새로고침(재마운트)하면 홈이 아니라 관리자 화면에서 시작한다', async () => {
    api.getMe.mockResolvedValue(admin);
    const first = render(<App />);
    await screen.findByText(/HOME/);
    await userEvent.click(screen.getByText('go-admin'));
    expect(await screen.findByText(/ADMIN/)).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBe('"admin"');

    first.unmount(); // 새로고침: React 상태는 사라지고 sessionStorage만 남는다
    render(<App />);
    expect(await screen.findByText(/ADMIN/)).toBeInTheDocument();
    expect(screen.queryByText(/HOME/)).toBeNull();
  });

  it('관리자 화면에서 홈으로 나가면 표시가 지워져, 이후 새로고침은 홈에서 시작한다', async () => {
    api.getMe.mockResolvedValue(admin);
    sessionStorage.setItem(KEY, '"admin"');
    const first = render(<App />);
    await userEvent.click(await screen.findByText('go-home'));
    expect(await screen.findByText(/HOME/)).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem(KEY)).toBeNull());

    first.unmount();
    render(<App />);
    expect(await screen.findByText(/HOME/)).toBeInTheDocument();
  });

  it('관리자가 아닌 사용자는 표시가 남아 있어도(조작 포함) 관리자 화면에 못 들어가고 홈으로 간다', async () => {
    api.getMe.mockResolvedValue(student);
    sessionStorage.setItem(KEY, '"admin"');
    render(<App />);
    expect(await screen.findByText(/HOME/)).toBeInTheDocument();
    expect(screen.queryByText(/ADMIN/)).toBeNull();
    await waitFor(() => expect(sessionStorage.getItem(KEY)).toBeNull());
  });

  it('로그인이 안 된 상태에서는 표시가 있어도 로그인 화면이 먼저고, 이후 일반 학생으로 로그인하면 홈이다', async () => {
    api.getMe.mockRejectedValueOnce(new Error('401'));
    sessionStorage.setItem(KEY, '"admin"');
    render(<App />);
    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
    expect(screen.queryByText(/ADMIN/)).toBeNull();
  });

  it('표시가 없으면 기존처럼 홈에서 시작한다(다른 화면은 영향 없음)', async () => {
    api.getMe.mockResolvedValue(admin);
    render(<App />);
    expect(await screen.findByText(/HOME/)).toBeInTheDocument();
  });
});
