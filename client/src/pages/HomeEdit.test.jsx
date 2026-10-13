import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  updateProfile: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import HomeEdit from './HomeEdit.jsx';

/**
 * client/src/pages/HomeEdit.test.jsx
 * 홈 화면 편집: 하단 바 켜기/끄기, 챗봇을 뺀 4칸(홈 포함)은 정확히 4칸이어야 저장되고, 기본 배치와 같으면 null로 보낸다.
 */

const USER = { id: 1, homeLayout: null };

beforeEach(() => {
  vi.clearAllMocks();
  api.updateProfile.mockImplementation(async (payload) => ({ ...USER, homeLayout: payload.homeLayout }));
});

const selectedNames = () =>
  within(screen.getByText('하단 바에 있는 기능').nextElementSibling)
    .getAllByRole('listitem')
    .map((li) => li.textContent.replace(/[↑↓✕]/g, ''));

describe('HomeEdit', () => {
  it('기본 배치(홈·졸업요건·진로·커뮤니티, 하단 바 켬)가 보이고, 바꾸지 않고 저장하면 null로 보낸다', async () => {
    const onSaved = vi.fn();
    render(<HomeEdit user={USER} onCancel={() => {}} onSaved={onSaved} />);
    expect(screen.getByRole('switch', { name: /하단 바 사용/ })).toBeChecked();
    expect(selectedNames()).toEqual(['홈', '졸업요건 진단', '진로 탐색', '커뮤니티']);

    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenCalledWith({ homeLayout: null });
    expect(onSaved).toHaveBeenCalled();
  });

  it('홈을 빼고 다른 기능을 넣을 수 있다 — 4칸이 차야 저장된다', async () => {
    render(<HomeEdit user={USER} onCancel={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole('button', { name: '문의하기 하단 바에 넣기' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '홈 하단 바에서 빼기' }));
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '과목 관리 하단 바에 넣기' }));
    await userEvent.click(screen.getByRole('button', { name: '과목 관리 위로' }));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenCalledWith({
      homeLayout: { tabs: ['graduation', 'career', 'courses', 'community'], showTabBar: true },
    });
  });

  it('하단 바를 끄면 칸 편집이 사라지고, 끈 채로 저장된다(덜 찬 칸은 기본 칸으로 채움)', async () => {
    render(<HomeEdit user={USER} onCancel={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '홈 하단 바에서 빼기' }));
    await userEvent.click(screen.getByRole('switch', { name: /하단 바 사용/ }));
    expect(screen.getByText(/챗봇 버튼을 포함한 하단 바가 모든 화면에서 사라져요/)).toBeInTheDocument();
    expect(screen.queryByText('하단 바에 있는 기능')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenCalledWith({
      homeLayout: { tabs: ['home', 'graduation', 'career', 'community'], showTabBar: false },
    });
  });

  it('기본값으로 되돌리면 null로 보낸다', async () => {
    const saved = { tabs: ['courses', 'inquiry', 'career', 'home'], showTabBar: false };
    render(<HomeEdit user={{ ...USER, homeLayout: saved }} onCancel={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '기본값으로 되돌리기' }));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenCalledWith({ homeLayout: null });
  });

  it('저장에 실패하면 알려 준다', async () => {
    api.updateProfile.mockRejectedValue(new Error('x'));
    render(<HomeEdit user={USER} onCancel={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('저장하지 못했어요. 다시 시도해 주세요.')).toBeInTheDocument();
  });
});
