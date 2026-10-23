import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getMe: vi.fn(),
  logout: vi.fn(),
}));

// 화면 컴포넌트는 가벼운 스텁으로 바꾼다 — 이 테스트는 하단 바를 언제 그리고 화면 틀에 어떤 표시를 붙이는지만 본다.
vi.mock('./pages/Login.jsx', () => ({ default: () => <div>LOGIN</div> }));
vi.mock('./pages/Home.jsx', () => ({ default: () => <div>HOME</div>, resetHomeCache: () => {} }));
vi.mock('./pages/Chat.jsx', () => ({ default: () => <div>CHAT</div> }));
vi.mock('./pages/CareerExploration.jsx', () => ({ default: () => <div>CAREER</div> }));
vi.mock('./components/BottomTabBar.jsx', () => ({
  default: ({ onOpen }) => (
    <nav>
      TABBAR
      <button onClick={() => onOpen('chat')}>open-chat</button>
      <button onClick={() => onOpen('career')}>open-career</button>
    </nav>
  ),
}));

import * as api from './api/chatApi.js';
import App from './App.jsx';

/**
 * client/src/App.floatingChat.test.jsx
 * 하단 바 4자리를 모두 비우면(챗봇 버튼만) 버튼을 내용 위에 띄운다 — 화면 틀에 floating-chat을 붙여 스크롤 끝 여백을 두고,
 * 채팅 화면에서는 입력창과 겹치지 않게 하단 바를 그리지 않는다.
 */

const student = (homeLayout) => ({ id: 2, name: '학생', role: 'student', onboardingCompleted: true, homeLayout });

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('챗봇 버튼만 남긴 하단 바', () => {
  it('4자리가 모두 비면 화면 틀에 floating-chat이 붙고, 채팅 화면에서는 하단 바를 그리지 않는다', async () => {
    api.getMe.mockResolvedValue(student({ tabs: [null, null, null, null], showTabBar: true }));
    const { container } = render(<App />);
    await screen.findByText('HOME');
    expect(screen.getByText(/TABBAR/)).toBeInTheDocument();
    expect(container.querySelector('.app-frame')).toHaveClass('floating-chat');

    await userEvent.click(screen.getByText('open-chat'));
    expect(await screen.findByText('CHAT')).toBeInTheDocument();
    expect(screen.queryByText(/TABBAR/)).toBeNull();
    expect(container.querySelector('.app-frame')).not.toHaveClass('floating-chat');
  });

  it('진로 탐색 화면에서도(아래에 입력창이 있다) 떠 있는 챗봇 버튼을 그리지 않는다', async () => {
    // 진로 탐색은 학과를 고른 계정만 열 수 있다(isLockedView).
    api.getMe.mockResolvedValue({ ...student({ tabs: [null, null, null, null], showTabBar: true }), departmentId: 1 });
    const { container } = render(<App />);
    await screen.findByText('HOME');
    await userEvent.click(screen.getByText('open-career'));
    expect(await screen.findByText('CAREER')).toBeInTheDocument();
    expect(screen.queryByText(/TABBAR/)).toBeNull();
    expect(container.querySelector('.app-frame')).not.toHaveClass('floating-chat');
  });

  it('자리가 하나라도 있으면 지금처럼 바가 자리를 차지하고, 채팅 화면에서도 보인다', async () => {
    api.getMe.mockResolvedValue(student({ tabs: [null, 'graduation', null, null], showTabBar: true }));
    const { container } = render(<App />);
    await screen.findByText('HOME');
    expect(container.querySelector('.app-frame')).not.toHaveClass('floating-chat');

    await userEvent.click(screen.getByText('open-chat'));
    expect(await screen.findByText('CHAT')).toBeInTheDocument();
    expect(screen.getByText(/TABBAR/)).toBeInTheDocument();
  });
});
