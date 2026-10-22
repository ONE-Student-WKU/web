import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', () => ({ getAdminPending: vi.fn() }));

import * as api from '../api/chatApi.js';
import AccountMenu from './AccountMenu.jsx';
import { resetAdminPending, refreshAdminPending } from '../utils/adminPending.js';

/**
 * client/src/components/AccountMenu.adminPending.test.jsx
 * 관리자 빨간 점: 관리자 계정이고 처리할 일(신고·문의·승인 대기)이 1건 이상이면 아바타에 빨간 점, "관리자" 줄에 건수가 붙는다.
 * 학생 계정은 건수를 묻지도 않는다.
 */

const handlers = { onLogout: vi.fn(), onOpenSettings: vi.fn(), onOpenOnboarding: vi.fn(), onOpenProfile: vi.fn(), onOpenAdmin: vi.fn(), onOpenInquiry: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  resetAdminPending();
});

describe('관리자 처리할 일 표시', () => {
  it('처리할 일이 있으면 아바타에 빨간 점이 붙고, 메뉴의 관리자 줄에 건수가 보인다', async () => {
    api.getAdminPending.mockResolvedValue({ reports: 2, inquiries: 1, posts: 2, total: 5 });
    const { container } = render(<AccountMenu user={{ name: '관리자', role: 'admin' }} {...handlers} />);
    const avatar = await screen.findByRole('button', { name: '관리자 · 계정 메뉴, 처리할 일 5건' });
    expect(container.querySelector('.account-avatar-dot')).not.toBeNull();
    await userEvent.click(avatar);
    expect(screen.getByRole('button', { name: '관리자, 처리할 일 5건' }).querySelector('.account-menu-count').textContent).toBe('5');
  });

  it('처리할 일이 0건이면 점도 건수도 없다', async () => {
    api.getAdminPending.mockResolvedValue({ reports: 0, inquiries: 0, posts: 0, total: 0 });
    const { container } = render(<AccountMenu user={{ name: '관리자', role: 'admin' }} {...handlers} />);
    await waitFor(() => expect(api.getAdminPending).toHaveBeenCalled());
    expect(container.querySelector('.account-avatar-dot')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /계정 메뉴/ }));
    expect(document.querySelector('.account-menu-count')).toBeNull();
  });

  it('관리자 화면에서 처리하면(refreshAdminPending) 다른 화면의 메뉴도 같이 바뀐다', async () => {
    api.getAdminPending.mockResolvedValueOnce({ reports: 1, inquiries: 0, posts: 0, total: 1 }).mockResolvedValueOnce({ reports: 0, inquiries: 0, posts: 0, total: 0 });
    const { container } = render(<AccountMenu user={{ name: '관리자', role: 'admin' }} {...handlers} />);
    await waitFor(() => expect(container.querySelector('.account-avatar-dot')).not.toBeNull());
    await refreshAdminPending();
    await waitFor(() => expect(container.querySelector('.account-avatar-dot')).toBeNull());
  });

  it('학생 계정은 건수를 묻지 않는다', async () => {
    const { container } = render(<AccountMenu user={{ name: '학생', role: 'student' }} {...handlers} />);
    await userEvent.click(screen.getByRole('button', { name: /계정 메뉴/ }));
    expect(api.getAdminPending).not.toHaveBeenCalled();
    expect(container.querySelector('.account-avatar-dot')).toBeNull();
  });
});
