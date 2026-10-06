import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
}));

import * as api from '../api/chatApi.js';
import Community, { resetCommunityCache } from './Community.jsx';

/**
 * client/src/pages/Community.report.test.jsx
 * 신고 화면(PR3): 중복 신고·자기 글 신고에 대한 안내, 자기 글에는 신고 버튼이 없다(서버 거부와 별개로 화면도 숨김).
 */

const baseProps = {
  user: { name: '나', role: 'student' },
  onGoHome: vi.fn(),
  onLogout: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenOnboarding: vi.fn(),
  onOpenProfile: vi.fn(),
  onOpenAdmin: vi.fn(),
  onOpenInquiry: vi.fn(),
};

const listPost = { id: 1, title: '남의 글', body: '본문', category: 'study', capacity: null, closedAt: null, createdAt: '2026-09-01T00:00:00.000Z', author: '남' };
const detail = (over = {}) => ({ ...listPost, status: 'approved', isMine: false, myApplication: null, contentHidden: false, rejectReason: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  resetCommunityCache();
  api.getMySanction.mockResolvedValue(null);
  api.getCommunityPosts.mockResolvedValue([listPost]);
  api.getMyCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityApplications.mockResolvedValue([]);
  api.getCommunityApplicants.mockResolvedValue([]);
});

async function openReportForm() {
  render(<Community {...baseProps} />);
  await userEvent.click(await screen.findByText('남의 글'));
  await userEvent.click(await screen.findByRole('button', { name: '신고하기' }));
  await userEvent.type(screen.getByPlaceholderText('신고하는 이유를 적어주세요.'), '부적절한 글');
}

describe('글 신고', () => {
  it('이미 신고한 글을 다시 신고하면(서버가 처리 상태와 무관하게 DUPLICATE_REPORT) 안내가 나온다', async () => {
    api.getCommunityPost.mockResolvedValue(detail());
    api.reportCommunityPost.mockRejectedValue(Object.assign(new Error('dup'), { code: 'DUPLICATE_REPORT' }));
    await openReportForm();
    await userEvent.click(screen.getByRole('button', { name: '신고 제출' }));
    expect((await screen.findAllByText('이미 신고한 글이에요.')).length).toBeGreaterThan(0);
  });

  it('서버가 자기 글 신고를 거부(CANNOT_REPORT_OWN)하면 그 사유가 안내된다', async () => {
    api.getCommunityPost.mockResolvedValue(detail());
    api.reportCommunityPost.mockRejectedValue(Object.assign(new Error('own'), { code: 'CANNOT_REPORT_OWN' }));
    await openReportForm();
    await userEvent.click(screen.getByRole('button', { name: '신고 제출' }));
    expect((await screen.findAllByText('내가 쓴 글은 신고할 수 없어요.')).length).toBeGreaterThan(0);
  });

  it('정상 신고는 성공 안내를 띄우고 신고 폼이 닫힌다', async () => {
    api.getCommunityPost.mockResolvedValue(detail());
    api.reportCommunityPost.mockResolvedValue({ id: 1 });
    await openReportForm();
    await userEvent.click(screen.getByRole('button', { name: '신고 제출' }));
    expect(await screen.findByText('신고했어요 — 관리자가 확인할게요.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('신고하는 이유를 적어주세요.')).toBeNull();
  });

  it('내가 쓴 글의 상세에는 글 신고 버튼이 없다', async () => {
    api.getCommunityPost.mockResolvedValue(detail({ isMine: true }));
    render(<Community {...baseProps} />);
    await userEvent.click(await screen.findByText('남의 글'));
    await screen.findByRole('heading', { level: 2 });
    expect(screen.queryByRole('button', { name: '신고하기' })).toBeNull();
  });
});

describe('신청 신고', () => {
  it('내 글의 신청자를 이미 신고했다면 DUPLICATE_REPORT 안내가 나온다', async () => {
    api.getCommunityPost.mockResolvedValue(detail({ isMine: true }));
    api.getCommunityApplicants.mockResolvedValue([
      { id: 9, message: '신청해요', status: 'pending', createdAt: '2026-09-03T00:00:00.000Z', applicant: '지원자', hasAppliedBefore: false, contactEmail: null, rejectReason: null },
    ]);
    api.reportCommunityApplication.mockRejectedValue(Object.assign(new Error('dup'), { code: 'DUPLICATE_REPORT' }));
    render(<Community {...baseProps} />);
    await userEvent.click(await screen.findByText('남의 글'));
    await userEvent.click(await screen.findByRole('button', { name: '신고하기' }));
    await userEvent.type(screen.getByPlaceholderText('신고 사유를 적어주세요.'), '욕설');
    await userEvent.click(screen.getByRole('button', { name: '신고 제출' }));
    expect(await screen.findByText('이미 신고한 신청이에요.')).toBeInTheDocument();
  });
});
