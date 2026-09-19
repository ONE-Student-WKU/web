import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountMenu from './AccountMenu.jsx';

function renderMenu(props = {}) {
  const handlers = {
    onLogout: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenOnboarding: vi.fn(),
    onOpenProfile: vi.fn(),
    onOpenAdmin: vi.fn(),
    onOpenInquiry: vi.fn(),
    ...props,
  };
  render(<AccountMenu {...handlers} />);
  return handlers;
}

describe('AccountMenu', () => {
  it('처음엔 드롭다운이 닫혀있다', () => {
    renderMenu({ user: { name: '홍길동', role: 'student' } });
    expect(screen.queryByText('설정')).not.toBeInTheDocument();
  });

  it('아바타를 누르면 드롭다운이 열리고, 일반 학생에게는 관리자 메뉴가 안 보인다', async () => {
    renderMenu({ user: { name: '홍길동', role: 'student' } });
    await userEvent.click(screen.getByRole('button', { name: /계정 메뉴/ }));

    expect(screen.getByText('설정')).toBeInTheDocument();
    expect(screen.getByText('학과, 학번 수정')).toBeInTheDocument();
    expect(screen.getByText('로그아웃')).toBeInTheDocument();
    expect(screen.queryByText('관리자')).not.toBeInTheDocument();
  });

  it('role이 admin이면 관리자 메뉴가 보이고, 누르면 onOpenAdmin이 불린다', async () => {
    const handlers = renderMenu({ user: { name: '관리자', role: 'admin' } });
    await userEvent.click(screen.getByRole('button', { name: /계정 메뉴/ }));

    const adminItem = screen.getByText('관리자');
    expect(adminItem).toBeInTheDocument();

    await userEvent.click(adminItem);
    expect(handlers.onOpenAdmin).toHaveBeenCalledTimes(1);
    // 항목을 누르면 드롭다운도 같이 닫혀야 한다.
    expect(screen.queryByText('설정')).not.toBeInTheDocument();
  });

  it('로그아웃을 누르면 onLogout이 호출된다', async () => {
    const handlers = renderMenu({ user: { name: '홍길동', role: 'student' } });
    await userEvent.click(screen.getByRole('button', { name: /계정 메뉴/ }));
    await userEvent.click(screen.getByText('로그아웃'));

    expect(handlers.onLogout).toHaveBeenCalledTimes(1);
  });
});
