import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  requestEmailCode: vi.fn(),
  startGoogleLogin: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import Login from './Login.jsx';
import { storeConsent, storeNoticeAck } from '../utils/consent.js';

/**
 * client/src/pages/Login.safeguards.test.jsx
 * 공개 전 안전장치: 로그인 화면이 비공식 서비스임을 배지와 필수 체크로 밝히고,
 * 인증코드 메일을 보낼 수 없을 때(EMAIL_SEND_FAILED) "잠시 후 다시" 대신 Google 로그인을 권한다.
 */

const renderLogin = () => render(<Login error={null} onOpenPrivacy={() => {}} onOpenTerms={() => {}} onLoginSuccess={() => {}} />);

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('Login 안전장치', () => {
  it('비공식임은 배지와 필수 체크로 알린다', () => {
    renderLogin();
    expect(screen.getByText('학생 프로젝트 · 비공식')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /학교 공식 서비스가 아닌 비공식 서비스임을 확인했습니다/ })).toBeInTheDocument();
  });

  it('약관 동의만 하고 "학교 공식 서비스가 아님"을 확인하지 않으면 로그인 버튼이 막히고, 둘 다 하면 확인 여부를 함께 넘긴다', async () => {
    storeConsent(true);
    const google = vi.spyOn(api, 'startGoogleLogin').mockImplementation(() => {});
    renderLogin();
    // "비공식 서비스"는 굵게 보인다
    expect(screen.getByText('비공식 서비스', { selector: 'strong' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Google로 로그인/ }));
    expect(google).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox', { name: /비공식 서비스임을 확인했습니다/ }));
    await userEvent.click(screen.getByRole('button', { name: /Google로 로그인/ }));
    expect(google).toHaveBeenCalled();
  });

  it('메일을 보낼 수 없으면 Google 로그인을 권한다', async () => {
    storeConsent(true);
    storeNoticeAck(true);
    const err = Object.assign(new Error('send failed'), { code: 'EMAIL_SEND_FAILED' });
    api.requestEmailCode.mockRejectedValue(err);
    renderLogin();
    await userEvent.type(screen.getByLabelText('이메일 주소'), 'a@example.com');
    await userEvent.click(screen.getByRole('button', { name: '인증코드 받기' }));
    expect(await screen.findByText(/위의 Google 로그인을 이용해 주세요/)).toBeInTheDocument();
  });
});
