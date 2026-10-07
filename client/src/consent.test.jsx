import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getMe: vi.fn(),
  logout: vi.fn(),
  startGoogleLogin: vi.fn(),
  requestEmailCode: vi.fn(),
  verifyEmailCode: vi.fn(),
  acceptConsent: vi.fn(),
  getUnseenReportCount: vi.fn(),
}));

// App 안의 화면은 스텁으로 — 이 테스트는 로그인 폼의 동의 체크와 로그인 직후 동의 화면만 본다.
vi.mock('./pages/Home.jsx', () => ({ default: () => <div>HOME</div>, resetHomeCache: () => {} }));
vi.mock('./pages/Chat.jsx', () => ({ default: () => <div>CHAT</div> }));
vi.mock('./pages/CourseManagement.jsx', () => ({ default: () => <div>COURSES</div>, resetCourseMgmtCache: () => {} }));
vi.mock('./pages/GraduationStatus.jsx', () => ({ default: () => <div>GRAD</div>, resetGraduationCache: () => {} }));
vi.mock('./pages/CareerExploration.jsx', () => ({ default: () => <div>CAREER</div> }));
vi.mock('./pages/Settings.jsx', () => ({ default: () => <div>SETTINGS</div> }));
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
import Login from './pages/Login.jsx';
import { LanguageProvider } from './i18n/I18nContext.jsx';
import { CONSENT_VERSION } from './utils/consent.js';

/**
 * client/src/consent.test.jsx
 * 이용약관·개인정보 수집·이용 동의: 로그인 폼의 필수 체크(체크 전에는 Google/이메일 로그인 버튼이 막힘, 로고 버튼)와
 * 동의 기록이 없는 계정이 로그인 직후 보는 동의 화면(ConsentGate).
 */

const renderLogin = (props = {}) =>
  render(
    <LanguageProvider>
      <Login onOpenPrivacy={() => {}} onOpenTerms={() => {}} onLoginSuccess={() => {}} {...props} />
    </LanguageProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  api.getUnseenReportCount.mockResolvedValue(0);
});

describe('로그인 폼의 필수 동의', () => {
  it('체크하기 전에는 Google 로그인과 인증코드 받기 버튼이 모두 막혀 있고, 안내가 보인다', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: /Google로 로그인/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '인증코드 받기' })).toBeDisabled();
    expect(screen.getByText('로그인하려면 위 동의가 필요해요.')).toBeInTheDocument();
  });

  it('체크하면 버튼이 열리고, Google 로그인은 현재 약관 버전과 함께 시작된다', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('checkbox', { name: /이용약관.*개인정보처리방침.*동의합니다/ }));

    const google = screen.getByRole('button', { name: /Google로 로그인/ });
    expect(google).toBeEnabled();
    await userEvent.click(google);
    expect(api.startGoogleLogin).toHaveBeenCalledWith(true, CONSENT_VERSION);
    expect(localStorage.getItem('consent_version')).toBe(CONSENT_VERSION);
  });

  it('이 브라우저에서 현재 버전에 이미 동의했으면 처음부터 체크돼 있다', () => {
    localStorage.setItem('consent_version', CONSENT_VERSION);
    renderLogin();
    expect(screen.getByRole('checkbox', { name: /동의합니다/ })).toBeChecked();
    expect(screen.getByRole('button', { name: /Google로 로그인/ })).toBeEnabled();
  });

  it('옛 버전에 동의한 기억은 인정하지 않는다', () => {
    localStorage.setItem('consent_version', '2020-01-01');
    renderLogin();
    expect(screen.getByRole('checkbox', { name: /동의합니다/ })).not.toBeChecked();
  });

  it('체크를 풀면 다시 막히고 저장된 동의 기억도 지워진다', async () => {
    localStorage.setItem('consent_version', CONSENT_VERSION);
    renderLogin();
    await userEvent.click(screen.getByRole('checkbox', { name: /동의합니다/ }));
    expect(screen.getByRole('button', { name: '인증코드 받기' })).toBeDisabled();
    expect(localStorage.getItem('consent_version')).toBeNull();
  });

  it('이메일 인증코드 요청과 확인에 동의 버전이 함께 전송된다', async () => {
    api.requestEmailCode.mockResolvedValue({});
    api.verifyEmailCode.mockResolvedValue({});
    localStorage.setItem('consent_version', CONSENT_VERSION);
    renderLogin();

    await userEvent.type(screen.getByLabelText('이메일 주소'), 'a@example.com');
    await userEvent.click(screen.getByRole('button', { name: '인증코드 받기' }));
    expect(api.requestEmailCode).toHaveBeenCalledWith('a@example.com', CONSENT_VERSION);

    await userEvent.type(await screen.findByLabelText('인증코드'), '123456');
    await userEvent.click(screen.getByRole('button', { name: '로그인' }));
    expect(api.verifyEmailCode).toHaveBeenCalledWith('a@example.com', '123456', true, CONSENT_VERSION);
  });

  it('동의 링크를 누르면 약관/방침 화면으로 가는 콜백이 불린다', async () => {
    const onOpenTerms = vi.fn();
    const onOpenPrivacy = vi.fn();
    renderLogin({ onOpenTerms, onOpenPrivacy });
    const inLabel = screen.getByRole('checkbox', { name: /동의합니다/ }).closest('label');
    await userEvent.click(inLabel.querySelector('button:nth-of-type(1)'));
    expect(onOpenTerms).toHaveBeenCalled();
    await userEvent.click(inLabel.querySelector('button:nth-of-type(2)'));
    expect(onOpenPrivacy).toHaveBeenCalled();
  });

  it('영어에서는 문구와 안내가 영어로 나온다', () => {
    localStorage.setItem('language', 'en');
    renderLogin();
    expect(screen.getByRole('checkbox', { name: /I agree to the.*Terms of Service.*Privacy Policy/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log in with Google/ })).toBeDisabled();
    expect(screen.getByText('Please agree above to log in.')).toBeInTheDocument();
  });

  it('서버가 동의 필요 오류를 내려주면 그 안내를 보여준다', () => {
    renderLogin({ error: 'CONSENT_REQUIRED' });
    expect(screen.getByText('이용약관과 개인정보 수집·이용에 동의해야 로그인할 수 있어요.')).toBeInTheDocument();
  });
});

describe('로그인 직후 동의 화면', () => {
  const renderApp = () =>
    render(
      <LanguageProvider>
        <App />
      </LanguageProvider>
    );
  const user = (consentRequired) => ({ id: 5, name: '학생', role: 'student', onboardingCompleted: true, consentRequired });

  it('동의 기록이 없는 계정은 홈 대신 동의 화면을 보고, 하단 탭바도 없다', async () => {
    api.getMe.mockResolvedValue(user(true));
    renderApp();
    expect(await screen.findByRole('heading', { name: '서비스 이용 동의' })).toBeInTheDocument();
    expect(screen.queryByText('HOME')).not.toBeInTheDocument();
    expect(screen.queryByText('TABBAR')).not.toBeInTheDocument();
  });

  it('체크하고 동의하면 서버에 현재 버전을 보내고 홈으로 간다', async () => {
    api.getMe.mockResolvedValue(user(true));
    api.acceptConsent.mockResolvedValue({});
    renderApp();
    const agree = await screen.findByRole('button', { name: '동의하고 계속하기' });
    expect(agree).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: /동의합니다/ }));
    await userEvent.click(agree);

    await waitFor(() => expect(api.acceptConsent).toHaveBeenCalledWith(CONSENT_VERSION));
    expect(await screen.findByText('HOME')).toBeInTheDocument();
  });

  it('저장에 실패하면 안내를 보여주고 화면을 유지한다', async () => {
    api.getMe.mockResolvedValue(user(true));
    api.acceptConsent.mockRejectedValue(new Error('x'));
    renderApp();
    await userEvent.click(await screen.findByRole('checkbox', { name: /동의합니다/ }));
    await userEvent.click(screen.getByRole('button', { name: '동의하고 계속하기' }));
    expect(await screen.findByText('동의를 저장하지 못했어요. 잠시 후 다시 시도해주세요.')).toBeInTheDocument();
    expect(screen.queryByText('HOME')).not.toBeInTheDocument();
  });

  it('동의하지 않고 나가기는 로그아웃한다', async () => {
    api.getMe.mockResolvedValue(user(true));
    api.logout.mockResolvedValue({});
    renderApp();
    await userEvent.click(await screen.findByRole('button', { name: '동의하지 않고 나가기' }));
    await waitFor(() => expect(api.logout).toHaveBeenCalled());
  });

  it('이미 동의한 계정은 동의 화면 없이 바로 홈이다', async () => {
    api.getMe.mockResolvedValue(user(false));
    renderApp();
    expect(await screen.findByText('HOME')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '서비스 이용 동의' })).not.toBeInTheDocument();
  });
});
