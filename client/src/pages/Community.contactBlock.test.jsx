import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', () => ({
  getCommunityPosts: vi.fn(),
  // 공지(전체 글 탭 맨 위 고정 줄) — 이 테스트는 공지가 없는 상태로 본다.
  getNotices: vi.fn(() => Promise.resolve([])),
  markNoticeRead: vi.fn(() => Promise.resolve(null)),
  markAllNoticesRead: vi.fn(() => Promise.resolve(null)),
  getMyCommunityPosts: vi.fn(),
  getCommunityPost: vi.fn(),
  getMyCommunityApplications: vi.fn(),
  getCommunityApplicants: vi.fn(),
  getMySanction: vi.fn(),
  blockCommunityContact: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import Community, { resetCommunityCache } from './Community.jsx';

/**
 * client/src/pages/Community.contactBlock.test.jsx
 * 매칭 연락(2026-10-22): 연락 이메일 아래에 연결용 주소라는 설명과 "연락 차단"이 있고, 차단하면 팝업에서 한 번 더 묻고
 * 연락 주소 대신 "연락이 차단됐어요" 안내가 보인다. 글쓴이(신청자 카드)와 신청자(글 상세) 양쪽에 같은 버튼이 있다.
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

const post = (over = {}) => ({ id: 7, title: '자료구조 스터디', body: '본문', category: 'study', capacity: 4, closedAt: null, createdAt: '2026-10-01T00:00:00.000Z', author: '글쓴이', status: 'approved', ...over });
const accepted = (over = {}) => ({
  id: 11, message: '같이 해요', status: 'accepted', createdAt: '2026-10-03T00:00:00.000Z', applicant: '지원자', hasAppliedBefore: false,
  contactEmail: '3f9a1c0e@relay.example', contactBlockedAt: null, rejectReason: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  resetCommunityCache();
  api.getMySanction.mockResolvedValue(null);
  api.getCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityPosts.mockResolvedValue([post()]);
  api.getMyCommunityApplications.mockResolvedValue([]);
  api.getCommunityApplicants.mockResolvedValue([accepted()]);
  api.getCommunityPost.mockResolvedValue({ ...post(), isMine: true, myApplication: null, contentHidden: false, rejectReason: null });
  api.blockCommunityContact.mockResolvedValue(null);
});

async function openMyPost() {
  render(<Community {...baseProps} />);
  await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
  await userEvent.click(await screen.findByText('자료구조 스터디'));
}

describe('매칭 연락 차단', () => {
  it('수락된 신청자 카드에 연락 주소와 연결용 주소 설명, 연락 차단 버튼이 보인다', async () => {
    await openMyPost();
    expect(await screen.findByText(/3f9a1c0e@relay\.example/)).toBeInTheDocument();
    expect(screen.getByText(/실제 이메일 대신 연결용 주소예요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '연락 차단' })).toBeInTheDocument();
  });

  it('연락 차단은 팝업에서 한 번 더 묻고, 취소하면 아무 일도 없다', async () => {
    await openMyPost();
    await userEvent.click(await screen.findByRole('button', { name: '연락 차단' }));
    expect(screen.getByRole('dialog', { name: '지원자님과 연락을 차단할까요?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.blockCommunityContact).not.toHaveBeenCalled();
  });

  it('차단하면 서버에 알리고, 연락 주소 대신 차단 안내와 "연락 차단됨" 표시가 보인다', async () => {
    await openMyPost();
    await userEvent.click(await screen.findByRole('button', { name: '연락 차단' }));
    await userEvent.click(screen.getByRole('button', { name: '차단하기' }));
    await waitFor(() => expect(api.blockCommunityContact).toHaveBeenCalledWith(11));
    expect(await screen.findByText(/연락이 차단됐어요/)).toBeInTheDocument();
    expect(screen.getByText('연락 차단됨')).toBeInTheDocument();
    expect(screen.queryByText(/3f9a1c0e@relay\.example/)).toBeNull();
    expect(screen.getByText('연락을 차단했어요.')).toBeInTheDocument();
  });

  it('이미 차단된 매칭은 연락 주소 없이 차단 안내만 보인다', async () => {
    api.getCommunityApplicants.mockResolvedValue([accepted({ contactEmail: null, contactBlockedAt: '2026-10-20T03:00:00.000Z' })]);
    await openMyPost();
    expect(await screen.findByText(/2026\.10\.20에 연락이 차단됐어요/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '연락 차단' })).toBeNull();
  });

  it('신청자는 글 상세의 내 신청에서 글쓴이 연락 주소를 보고 차단할 수 있다', async () => {
    api.getCommunityPosts.mockResolvedValue([post({ author: '글쓴이' })]);
    api.getCommunityPost.mockResolvedValue({
      ...post(), isMine: false, contentHidden: false, rejectReason: null,
      myApplication: { id: 21, status: 'accepted', rejectReason: null, contactEmail: 'author@relay.example', contactBlockedAt: null },
    });
    render(<Community {...baseProps} />);
    await userEvent.click(await screen.findByText('자료구조 스터디'));
    expect(await screen.findByText(/author@relay\.example/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '연락 차단' }));
    expect(screen.getByRole('dialog', { name: '글쓴이님과 연락을 차단할까요?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '차단하기' }));
    await waitFor(() => expect(api.blockCommunityContact).toHaveBeenCalledWith(21));
    expect(await screen.findByText(/연락이 차단됐어요/)).toBeInTheDocument();
  });
});
