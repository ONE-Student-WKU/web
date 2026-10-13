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
 * 홈 화면 편집: 하단 바는 정확히 3칸이어야 저장되고, 기본 배치와 같으면 null로 보낸다. 메뉴 카드는 숨길 수 없다.
 */

const USER = { id: 1, homeLayout: null };

beforeEach(() => {
  vi.clearAllMocks();
  api.updateProfile.mockImplementation(async (payload) => ({ ...USER, homeLayout: payload.homeLayout }));
});

const selectedList = () => screen.getByText('하단 바에 있는 기능').nextElementSibling;

describe('HomeEdit', () => {
  it('기본 배치가 보이고, 바꾸지 않고 저장하면 null(기본 배치)로 보낸다', async () => {
    const onSaved = vi.fn();
    render(<HomeEdit user={USER} onCancel={() => {}} onSaved={onSaved} />);
    const names = within(selectedList()).getAllByRole('listitem').map((li) => li.textContent);
    expect(names[0]).toMatch('졸업요건 진단');
    expect(names[1]).toMatch('진로 탐색');
    expect(names[2]).toMatch('커뮤니티');

    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenCalledWith({ homeLayout: null });
    expect(onSaved).toHaveBeenCalled();
  });

  it('3칸이 다 차면 더 넣을 수 없고, 하나를 빼면 3칸이 될 때까지 저장할 수 없다', async () => {
    render(<HomeEdit user={USER} onCancel={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole('button', { name: '문의하기 하단 바에 넣기' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '커뮤니티 하단 바에서 빼기' }));
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '문의하기 하단 바에 넣기' }));
    await userEvent.click(screen.getByRole('button', { name: '진로 탐색 위로' }));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenCalledWith({
      homeLayout: { tabs: ['career', 'graduation', 'inquiry'], cards: { order: ['progress', 'shortfall', 'menu'], hidden: [] } },
    });
  });

  it('카드를 숨기고 순서를 바꿀 수 있지만 메뉴는 숨길 수 없다', async () => {
    render(<HomeEdit user={USER} onCancel={() => {}} onSaved={() => {}} />);
    expect(screen.getByText('항상 보여요')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '메뉴' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: '이수학점 진행률' }));
    await userEvent.click(screen.getByRole('button', { name: '메뉴 위로' }));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenCalledWith({
      homeLayout: { tabs: ['graduation', 'career', 'community'], cards: { order: ['progress', 'menu', 'shortfall'], hidden: ['progress'] } },
    });
  });

  it('기본값으로 되돌리면 저장한 배치를 지우고(null) 보낸다', async () => {
    const saved = { tabs: ['courses', 'inquiry', 'career'], cards: { order: ['menu', 'progress', 'shortfall'], hidden: ['shortfall'] } };
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
