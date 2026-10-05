import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
 * client/src/pages/Community.test.jsx
 * 커뮤니티 화면 개선(마감 표시, 받은 신청의 글 구분, 제재 중 글 수정 안내) — API는 mock이라
 * 실제 로그인/서버 없이 화면 동작만 확인한다.
 */

const user = { name: '글쓴이', role: 'student' };
const baseProps = {
  user,
  onGoHome: vi.fn(),
  onLogout: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenOnboarding: vi.fn(),
  onOpenProfile: vi.fn(),
  onOpenAdmin: vi.fn(),
  onOpenInquiry: vi.fn(),
};

const post = (over = {}) => ({ id: 1, title: '알고리즘 스터디', body: '본문', category: 'study', capacity: 4, closedAt: null, createdAt: '2026-09-01T00:00:00.000Z', author: '홍길동', ...over });
const myPost = (over = {}) => ({ ...post(over), status: 'approved' });
const detail = (over = {}) => ({ ...myPost(), isMine: true, myApplication: null, contentHidden: false, rejectReason: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  resetCommunityCache();
  api.getMySanction.mockResolvedValue(null);
  api.getCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityApplications.mockResolvedValue([]);
  api.getCommunityApplicants.mockResolvedValue([]);
});

describe('마감 표시', () => {
  it('전체 글 목록: 마감된 글은 제목 앞에 "마감" 접두어가 붙고 모집 중인 글에는 없다', async () => {
    api.getCommunityPosts.mockResolvedValue([post({ id: 1, title: '마감된 글', closedAt: '2026-09-10T00:00:00.000Z' }), post({ id: 2, title: '모집중 글' })]);
    render(<Community {...baseProps} />);

    const closedRow = (await screen.findByText('마감된 글')).closest('button');
    expect(closedRow.querySelector('.community-closed-prefix')).toHaveTextContent('마감');
    expect(closedRow.className).toContain('community-post-list-item-closed');
    // 제목 접두어가 제목보다 앞에 온다
    const row = closedRow.querySelector('.community-post-list-row');
    expect(row.firstElementChild).toHaveClass('community-closed-prefix');

    const openRow = screen.getByText('모집중 글').closest('button');
    expect(openRow.querySelector('.community-closed-prefix')).toBeNull();
    expect(openRow.className).not.toContain('community-post-list-item-closed');
  });

  it('상세: 마감된 글의 제목 앞에도 "마감"이 붙는다', async () => {
    api.getCommunityPosts.mockResolvedValue([post({ id: 1, title: '마감된 글', closedAt: '2026-09-10T00:00:00.000Z' })]);
    api.getCommunityPost.mockResolvedValue(detail({ title: '마감된 글', closedAt: '2026-09-10T00:00:00.000Z', isMine: false }));
    render(<Community {...baseProps} />);

    await userEvent.click(await screen.findByText('마감된 글'));
    const heading = await screen.findByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('마감마감된 글');
    expect(heading.querySelector('.community-closed-prefix')).not.toBeNull();
  });

  it('내 신청 탭: 마감된 글에 낸 신청도 접두어가 붙는다', async () => {
    api.getMyCommunityApplications.mockResolvedValue([
      { id: 5, postId: 1, postTitle: '마감된 글', postCategory: 'study', postClosedAt: '2026-09-10T00:00:00.000Z', status: 'pending', createdAt: '2026-09-02T00:00:00.000Z', author: '홍길동', contactEmail: null },
    ]);
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내 신청' }));
    const row = (await screen.findByText('마감된 글')).closest('button');
    expect(row.querySelector('.community-closed-prefix')).not.toBeNull();
  });
});

describe('받은 신청이 어느 글인지 알아보기', () => {
  it('내가 쓴 글 목록: 받은 신청 수와 검토 대기 신청이 글마다 보인다', async () => {
    api.getMyCommunityPosts.mockResolvedValue([
      myPost({ id: 1, title: '글 A', applicationCount: 3, pendingApplicationCount: 2 }),
      myPost({ id: 2, title: '글 B', applicationCount: 0, pendingApplicationCount: 0 }),
    ]);
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));

    const rowA = (await screen.findByText('글 A')).closest('button');
    expect(rowA).toHaveTextContent('받은 신청 3건');
    expect(rowA).toHaveTextContent('검토 대기 신청 2건');
    const rowB = screen.getByText('글 B').closest('button');
    expect(rowB).not.toHaveTextContent('받은 신청');
    expect(rowB).not.toHaveTextContent('검토 대기');
  });

  it('서버가 아직 신청 수 필드를 안 내려줘도(배포 순서) 목록이 깨지지 않는다', async () => {
    api.getMyCommunityPosts.mockResolvedValue([myPost({ id: 1, title: '구버전 응답 글' })]);
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
    const row = (await screen.findByText('구버전 응답 글')).closest('button');
    expect(row).not.toHaveTextContent('받은 신청');
  });

  it('내 글 상세: 신청자 구역 제목과 카드에 어느 글에 온 신청인지 글 제목이 나온다', async () => {
    api.getMyCommunityPosts.mockResolvedValue([myPost({ id: 7, title: '프로젝트 팀원', applicationCount: 1, pendingApplicationCount: 1 })]);
    api.getCommunityPost.mockResolvedValue(detail({ id: 7, title: '프로젝트 팀원' }));
    api.getCommunityApplicants.mockResolvedValue([
      { id: 11, message: '참여하고 싶어요', status: 'pending', createdAt: '2026-09-03T00:00:00.000Z', applicant: '지원자', hasAppliedBefore: false, contactEmail: null, rejectReason: null },
    ]);
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
    await userEvent.click(await screen.findByText('프로젝트 팀원'));

    expect(await screen.findByText('「프로젝트 팀원」에 온 신청자 1명')).toBeInTheDocument();
    expect(screen.getByText(/2026\.09\.03 · 「프로젝트 팀원」/)).toBeInTheDocument();
  });
});

describe('제재 중 글 수정', () => {
  const sanction = { scope: 'post_apply', reason: '운영 정책 위반', endsAt: '2099-01-01T00:00:00.000Z' };

  it('상세: 제재 중이면 수정 버튼 근처에 안내 배너가 보이고 수정 버튼이 비활성화된다', async () => {
    api.getMySanction.mockResolvedValue(sanction);
    api.getMyCommunityPosts.mockResolvedValue([myPost({ id: 1, title: '내 글' })]);
    api.getCommunityPost.mockResolvedValue(detail({ title: '내 글' }));
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
    await userEvent.click(await screen.findByText('내 글'));

    expect(await screen.findByText(/글 작성·수정·신청이 제한돼요/)).toBeInTheDocument();
    expect(screen.getByText(/사유: 운영 정책 위반/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '수정 (제한됨)' })).toBeDisabled();
  });

  it('제재가 없으면 수정 버튼이 활성이고 배너가 없다', async () => {
    api.getMyCommunityPosts.mockResolvedValue([myPost({ id: 1, title: '내 글' })]);
    api.getCommunityPost.mockResolvedValue(detail({ title: '내 글' }));
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
    await userEvent.click(await screen.findByText('내 글'));

    expect(await screen.findByRole('button', { name: '수정' })).toBeEnabled();
    expect(screen.queryByText(/글 작성·수정·신청이 제한돼요/)).toBeNull();
  });

  it('수정 저장이 SANCTIONED(403)로 거절되면(제재가 걸린 뒤 화면을 열어둔 경우) 서버 응답으로 안내 배너를 채운다', async () => {
    api.getMyCommunityPosts.mockResolvedValue([myPost({ id: 1, title: '내 글' })]);
    api.getCommunityPost.mockResolvedValue(detail({ title: '내 글' }));
    const err = Object.assign(new Error('SANCTIONED'), { code: 'SANCTIONED', data: sanction });
    api.editCommunityPost.mockRejectedValue(err);
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
    await userEvent.click(await screen.findByText('내 글'));
    await userEvent.click(await screen.findByRole('button', { name: '수정' }));
    await userEvent.click(screen.getByRole('button', { name: '수정하기' }));

    await waitFor(() => expect(screen.getByText('글 수정이 제한된 계정이에요.')).toBeInTheDocument());
    expect(screen.getByText(/글 작성·수정·신청이 제한돼요/)).toBeInTheDocument();
    expect(screen.getByText(/사유: 운영 정책 위반/)).toBeInTheDocument();
  });
});
