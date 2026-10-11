import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', () => ({
  getCommunityPosts: vi.fn(),
  getMyCommunityPosts: vi.fn(),
  getCommunityPost: vi.fn(),
  createCommunityPost: vi.fn(),
  editCommunityPost: vi.fn(),
  deleteCommunityPost: vi.fn(),
  deleteAdminPost: vi.fn(),
  closeCommunityPost: vi.fn(),
  applyToCommunityPost: vi.fn(),
  getMyCommunityApplications: vi.fn(),
  getCommunityApplicants: vi.fn(),
  acceptCommunityApplication: vi.fn(),
  rejectCommunityApplication: vi.fn(),
  reportCommunityPost: vi.fn(),
  reportCommunityApplication: vi.fn(),
  getMySanction: vi.fn(),
  getReportedStudentSummary: vi.fn(),
  sanctionStudent: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import Community, { resetCommunityCache } from './Community.jsx';

/**
 * client/src/pages/Community.authorSanction.test.jsx
 * 글 상세에서 관리자가 작성자 이름을 눌러 바로 제재하는 흐름 — 관리자에게만 이름이 버튼이고(서버도 관리자에게만 authorId를 준다),
 * 내 글에는 없으며, 팝업에서 범위·기간·사유를 정해 확정하면 신고 없이 제재 API가 불린다.
 */

const props = (role) => ({
  user: { name: '관리자', role },
  onGoHome: vi.fn(),
  onLogout: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenOnboarding: vi.fn(),
  onOpenProfile: vi.fn(),
  onOpenAdmin: vi.fn(),
  onOpenInquiry: vi.fn(),
});

const listPost = { id: 1, title: '남의 글', body: '본문', category: 'study', capacity: null, closedAt: null, createdAt: '2026-09-01T00:00:00.000Z', author: '문제유저' };
const detail = (over = {}) => ({ ...listPost, status: 'approved', isMine: false, myApplication: null, contentHidden: false, rejectReason: null, authorId: 77, ...over });
const summary = {
  id: 77,
  nickname: '문제유저',
  department: '컴퓨터·소프트웨어공학과',
  admissionYear: 2022,
  joinedAt: '2026-03-02T00:00:00.000Z',
  postCount: 3,
  applicationCount: 2,
  reportsReceived: { pending: 1, resolved: 2, total: 3 },
  sanctions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  resetCommunityCache();
  api.getMySanction.mockResolvedValue(null);
  api.getCommunityPosts.mockResolvedValue([listPost]);
  api.getMyCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityApplications.mockResolvedValue([]);
  api.getCommunityApplicants.mockResolvedValue([]);
  api.getReportedStudentSummary.mockResolvedValue(summary);
  api.sanctionStudent.mockResolvedValue(null);
});

async function openDetail(role, over) {
  api.getCommunityPost.mockResolvedValue(detail(over));
  render(<Community {...props(role)} />);
  await userEvent.click(await screen.findByText('남의 글'));
  await screen.findByRole('heading', { level: 2 });
}

describe('글 상세에서 작성자를 눌러 제재', () => {
  it('일반 사용자에게는 작성자 이름이 버튼이 아니다(서버도 authorId를 주지 않는다)', async () => {
    await openDetail('student', { authorId: undefined });
    expect(screen.queryByRole('button', { name: /제재하기/ })).toBeNull();
  });

  it('내 글에는 작성자 제재 버튼이 없다', async () => {
    await openDetail('admin', { isMine: true });
    expect(screen.queryByRole('button', { name: /제재하기/ })).toBeNull();
  });

  it('작성자를 누르면 요약이 뜨고, 범위·기간·사유를 정해 확정하면 신고 없이 제재가 적용된다', async () => {
    await openDetail('admin');
    await userEvent.click(screen.getByRole('button', { name: '작성자 문제유저 제재하기' }));

    expect(await screen.findByText('작성자 제재')).toBeInTheDocument();
    expect(api.getReportedStudentSummary).toHaveBeenCalledWith(77);
    expect(await screen.findByText(/작성한 글 3개/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '전면 정지 (커뮤니티 진입 차단)' }));
    await userEvent.click(screen.getByRole('button', { name: '30일' }));
    const reason = screen.getByLabelText('제재 사유 (사용자에게 보여요)');
    expect(reason).toHaveValue('커뮤니티 운영 정책 위반');
    await userEvent.clear(reason);
    await userEvent.type(reason, '반복적인 비방');
    await userEvent.click(screen.getByRole('button', { name: '제재 확정' }));

    await waitFor(() => expect(api.sanctionStudent).toHaveBeenCalledWith(77, { scope: 'full', duration: '30d', reason: '반복적인 비방' }));
    expect(await screen.findByText('제재를 적용했어요.')).toBeInTheDocument();
    expect(screen.queryByText('작성자 제재')).toBeNull();
    // 글은 지우지 않는다
    expect(api.deleteAdminPost).not.toHaveBeenCalled();
  });

  it('사유를 비우면 확정할 수 없고, 서버가 관리자 계정을 거부하면 안내가 나온다', async () => {
    api.sanctionStudent.mockRejectedValue(Object.assign(new Error('x'), { code: 'CANNOT_SANCTION_ADMIN' }));
    await openDetail('admin');
    await userEvent.click(screen.getByRole('button', { name: '작성자 문제유저 제재하기' }));
    const dialog = (await screen.findByText('작성자 제재')).closest('form');
    const reason = within(dialog).getByLabelText('제재 사유 (사용자에게 보여요)');

    await userEvent.clear(reason);
    expect(within(dialog).getByRole('button', { name: '제재 확정' })).toBeDisabled();

    await userEvent.type(reason, '사유');
    await userEvent.click(within(dialog).getByRole('button', { name: '제재 확정' }));
    expect(await within(dialog).findByText('관리자 계정은 제재할 수 없어요.')).toBeInTheDocument();
  });

  it('취소하면 제재 없이 닫힌다', async () => {
    await openDetail('admin');
    await userEvent.click(screen.getByRole('button', { name: '작성자 문제유저 제재하기' }));
    await userEvent.click(await screen.findByRole('button', { name: '취소' }));
    expect(screen.queryByText('작성자 제재')).toBeNull();
    expect(api.sanctionStudent).not.toHaveBeenCalled();
  });
});
