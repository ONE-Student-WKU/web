import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', () => ({
  deleteAccount: vi.fn(),
  startGoogleReauth: vi.fn(),
  requestDeleteReauthCode: vi.fn(),
  verifyDeleteReauthCode: vi.fn(),
}));

import SuspendedGate from './SuspendedGate.jsx';
import { LanguageProvider } from '../i18n/I18nContext.jsx';

/**
 * client/src/pages/SuspendedGate.test.jsx
 * 서비스 전체 이용 정지 화면(#457): 관리자가 쓴 사유를 그대로, 기간(또는 영구)과 이의 제기 이메일을 보여주고,
 * 로그아웃과 계정 삭제(재가입 제한 안내 포함)만 할 수 있다. 영어 화면에서도 사유는 번역하지 않는다.
 */

const user = { id: 7, hasGoogleAccount: true };

function renderGate(props = {}) {
  const onLogout = vi.fn();
  render(
    <LanguageProvider>
      <SuspendedGate user={user} suspension={{ reason: '문의하기에서 욕설 반복', endsAt: '2026-11-03T05:00:00.000Z' }} onLogout={onLogout} onAccountDeleted={vi.fn()} justReauthenticated={false} {...props} />
    </LanguageProvider>
  );
  return { onLogout };
}

beforeEach(() => {
  localStorage.clear();
});

describe('SuspendedGate', () => {
  it('기간 정지: 사유·끝나는 날짜·이의 제기 이메일을 보여주고 로그아웃할 수 있다', async () => {
    const { onLogout } = renderGate();
    expect(screen.getByRole('heading', { name: '이용이 정지됐어요' })).toBeInTheDocument();
    expect(screen.getByText('문의하기에서 욕설 반복')).toBeInTheDocument();
    expect(screen.getByText(/2026\.11\.0[34] \d{2}:\d{2}까지/)).toBeInTheDocument();
    expect(screen.getByText('sicnro3241@gmail.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }));
    expect(onLogout).toHaveBeenCalled();
  });

  it('영구 정지는 날짜 대신 "영구 정지"', () => {
    renderGate({ suspension: { reason: '금전 요구', endsAt: null } });
    expect(screen.getByText('영구 정지')).toBeInTheDocument();
    expect(screen.getByText('운영팀이 해제하기 전까지 이용할 수 없어요.')).toBeInTheDocument();
  });

  it('계정 삭제를 펼치면 재가입 제한 안내와 재인증 단계가 보인다', async () => {
    renderGate();
    await userEvent.click(screen.getByRole('button', { name: '계정 삭제' }));
    expect(screen.getByText(/같은 이메일이나 Google 계정으로 다시 가입할 수 없어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 로그인해서 확인' })).toBeInTheDocument();
  });

  it('영어 화면: 안내는 영어, 사유는 쓴 그대로', () => {
    localStorage.setItem('language', 'en');
    renderGate();
    expect(screen.getByRole('heading', { name: 'Your account is suspended' })).toBeInTheDocument();
    expect(screen.getByText('문의하기에서 욕설 반복')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });
});
