import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getMe: vi.fn(),
  logout: vi.fn(),
  updateProfile: vi.fn(),
  getUnseenReportCount: vi.fn(),
}));

// 화면은 가벼운 스텁으로 — 이 테스트는 "로그인 직후 어떤 언어로 시작하고 계정에 뭘 저장하는가"만 본다.
vi.mock('./pages/Login.jsx', () => ({ default: () => <div>LOGIN</div> }));
vi.mock('./pages/Home.jsx', async () => {
  const { useI18n } = await import('./i18n/I18nContext.jsx');
  return {
    default: ({ onOpenSettings }) => {
      const { lang } = useI18n();
      return (
        <div>
          <span>{`HOME-${lang}`}</span>
          <button onClick={onOpenSettings}>go-settings</button>
        </div>
      );
    },
    resetHomeCache: () => {},
  };
});
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
 * client/src/App.language.test.jsx
 * 화면 언어를 계정에 저장하는 규칙(App.jsx): 로그인 직후 한 번, 어느 쪽 언어를 따를지와 계정에 무엇을 저장할지.
 */

const student = (language) => ({ id: 2, name: '학생', role: 'student', onboardingCompleted: true, language });

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
  api.getUnseenReportCount.mockResolvedValue(0);
});

describe('계정에 저장된 화면 언어', () => {
  it('계정에 en이 저장돼 있으면 브라우저에 아무 선택이 없어도(다른 기기) 영어로 시작하고 다시 저장하지 않는다', async () => {
    api.getMe.mockResolvedValue(student('en'));
    renderApp();

    expect(await screen.findByText('HOME-en')).toBeInTheDocument();
    expect(localStorage.getItem('language')).toBe('en');
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('계정 언어가 이 브라우저에 남은 선택과 다르면 계정 언어를 따른다', async () => {
    localStorage.setItem('language', 'en');
    api.getMe.mockResolvedValue(student('ko'));
    renderApp();

    expect(await screen.findByText('HOME-ko')).toBeInTheDocument();
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('계정에 언어가 없고 이 브라우저에서 고른 적이 있으면 그 언어를 계정에 저장한다', async () => {
    localStorage.setItem('language', 'en');
    api.getMe.mockResolvedValue(student(null));
    renderApp();

    expect(await screen.findByText('HOME-en')).toBeInTheDocument();
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ language: 'en' }));
  });

  it('계정에도 브라우저에도 선택이 없으면 한국어 기본값을 그대로 두고 아무것도 저장하지 않는다', async () => {
    api.getMe.mockResolvedValue(student(null));
    renderApp();

    expect(await screen.findByText('HOME-ko')).toBeInTheDocument();
    expect(api.updateProfile).not.toHaveBeenCalled();
    expect(localStorage.getItem('language')).toBeNull();
  });

  it('로그인 화면에서 방금 고른 언어는 계정에 저장된 언어보다 우선해서 계정에 저장된다', async () => {
    localStorage.setItem('language', 'en');
    sessionStorage.setItem('language_chosen_before_login', 'en');
    api.getMe.mockResolvedValue(student('ko'));
    renderApp();

    expect(await screen.findByText('HOME-en')).toBeInTheDocument();
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ language: 'en' }));
    expect(sessionStorage.getItem('language_chosen_before_login')).toBeNull();
  });

  it('로그인 화면 선택이 계정 언어와 같으면 다시 저장하지 않는다', async () => {
    localStorage.setItem('language', 'en');
    sessionStorage.setItem('language_chosen_before_login', 'en');
    api.getMe.mockResolvedValue(student('en'));
    renderApp();

    expect(await screen.findByText('HOME-en')).toBeInTheDocument();
    expect(api.updateProfile).not.toHaveBeenCalled();
  });
});

describe('설정 화면에서 언어를 바꿀 때', () => {
  it('바꾼 언어를 계정에 저장한다', async () => {
    api.getMe.mockResolvedValue(student('ko'));
    renderApp();
    await userEvent.click(await screen.findByText('go-settings'));

    await userEvent.click(await screen.findByRole('button', { name: 'English' }));

    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ language: 'en' }));
    expect(localStorage.getItem('language')).toBe('en');
  });
});
