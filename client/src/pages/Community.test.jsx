import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', () => ({
  getCommunityPosts: vi.fn(),
  // 공지(전체 글 탭 맨 위 고정 줄) — 이 테스트들은 공지가 없는 상태로 본다.
  getNotices: vi.fn(() => Promise.resolve([])),
  markNoticesSeen: vi.fn(() => Promise.resolve(null)),
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
  it('전체 글 목록: 마감된 글은 맨 위 줄에 "마감"이 붙고 흐리게 보이며, 모집 중인 글은 "모집 중"이다', async () => {
    api.getCommunityPosts.mockResolvedValue([post({ id: 1, title: '마감된 글', closedAt: '2026-09-10T00:00:00.000Z' }), post({ id: 2, title: '모집중 글' })]);
    render(<Community {...baseProps} />);

    const closedRow = (await screen.findByText('마감된 글')).closest('button');
    expect(closedRow.querySelector('.post-state')).toHaveTextContent('마감');
    expect(closedRow).toHaveClass('post-row--closed');

    const openRow = screen.getByText('모집중 글').closest('button');
    expect(openRow.querySelector('.post-state')).toHaveTextContent('모집 중');
    expect(openRow).not.toHaveClass('post-row--closed');
  });

  it('상세: 마감된 글은 제목 위 줄에 "마감"이 보이고, 마감 칸에 직접 마감했다고 나온다', async () => {
    api.getCommunityPosts.mockResolvedValue([post({ id: 1, title: '마감된 글', closedAt: '2026-09-10T00:00:00.000Z' })]);
    api.getCommunityPost.mockResolvedValue(detail({ title: '마감된 글', closedAt: '2026-09-10T00:00:00.000Z', isMine: false }));
    render(<Community {...baseProps} />);

    await userEvent.click(await screen.findByText('마감된 글'));
    const heading = await screen.findByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('마감된 글');
    expect(document.querySelector('.post-detail .post-state')).toHaveTextContent('마감');
    expect(screen.getByText('모집을 마감했어요')).toBeInTheDocument();
  });

  it('내 신청 탭: 마감된 글에 낸 신청은 흐리게 보인다', async () => {
    api.getMyCommunityApplications.mockResolvedValue([
      { id: 5, postId: 1, postTitle: '마감된 글', postCategory: 'study', postClosedAt: '2026-09-10T00:00:00.000Z', status: 'pending', createdAt: '2026-09-02T00:00:00.000Z', author: '홍길동', contactEmail: null },
    ]);
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내 신청' }));
    const row = (await screen.findByText('마감된 글')).closest('button');
    expect(row).toHaveClass('post-row--closed');
  });

  it('마감일까지 남은 날: 3일 안이면 빨강 "D-n", 그보다 멀면 파랑 "D-n", 당일은 "오늘 마감"', async () => {
    const dayAfter = (n) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    api.getCommunityPosts.mockResolvedValue([
      post({ id: 1, title: '곧 마감', recruitEndDate: dayAfter(2), recruitState: 'open' }),
      post({ id: 2, title: '여유', recruitEndDate: dayAfter(9), recruitState: 'open' }),
      post({ id: 3, title: '오늘까지', recruitEndDate: dayAfter(0), recruitState: 'open' }),
    ]);
    render(<Community {...baseProps} />);
    const state = async (title) => (await screen.findByText(title)).closest('button').querySelector('.post-state');
    expect(await state('곧 마감')).toHaveTextContent('D-2');
    expect(await state('곧 마감')).toHaveClass('post-state--soon');
    expect(await state('여유')).toHaveTextContent('D-9');
    expect(await state('여유')).toHaveClass('post-state--open');
    expect(await state('오늘까지')).toHaveTextContent('오늘 마감');
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

  it('내 글 상세: 글 위 상태 줄에 신청자 수와 확인 안 한 수가, 받은 신청 구역에 신청자가 나온다', async () => {
    api.getMyCommunityPosts.mockResolvedValue([myPost({ id: 7, title: '프로젝트 팀원', applicationCount: 1, pendingApplicationCount: 1 })]);
    api.getCommunityPost.mockResolvedValue(detail({ id: 7, title: '프로젝트 팀원' }));
    api.getCommunityApplicants.mockResolvedValue([
      { id: 11, message: '참여하고 싶어요', status: 'pending', createdAt: '2026-09-03T00:00:00.000Z', applicant: '지원자', hasAppliedBefore: false, contactEmail: null, rejectReason: null },
    ]);
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
    await userEvent.click(await screen.findByText('프로젝트 팀원'));

    expect(await screen.findByText('신청 1명 · 1명은 아직 확인하지 않았어요')).toBeInTheDocument();
    const head = screen.getByRole('heading', { level: 3, name: /받은 신청/ });
    expect(head).toHaveTextContent('받은 신청1');
    expect(screen.getByText('지원자')).toBeInTheDocument();
    expect(screen.getByText('2026.09.03')).toBeInTheDocument();
  });

  it('거부는 한 번 더 확인한다: 거부를 누르면 메시지(선택) 칸이 열리고, 거부하기를 눌러야 보낸다', async () => {
    api.getMyCommunityPosts.mockResolvedValue([myPost({ id: 7, title: '프로젝트 팀원' })]);
    api.getCommunityPost.mockResolvedValue(detail({ id: 7, title: '프로젝트 팀원' }));
    api.getCommunityApplicants.mockResolvedValue([
      { id: 11, message: '참여하고 싶어요', status: 'pending', createdAt: '2026-09-03T00:00:00.000Z', applicant: '지원자', hasAppliedBefore: false, contactEmail: null, rejectReason: null },
    ]);
    api.rejectCommunityApplication.mockResolvedValue(null);
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
    await userEvent.click(await screen.findByText('프로젝트 팀원'));

    await userEvent.click(await screen.findByRole('button', { name: '거부' }));
    expect(api.rejectCommunityApplication).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole('textbox', { name: /거부 사유/ }), '시간이 안 맞아요');
    await userEvent.click(screen.getByRole('button', { name: '거부하기' }));
    await waitFor(() => expect(api.rejectCommunityApplication).toHaveBeenCalledWith(11, '시간이 안 맞아요'));
  });

  it('한 사람이 반려 후 재신청하면 신청자는 사람 수로, 신청 건수는 따로 보인다(이슈 #304 3-2)', async () => {
    api.getMyCommunityPosts.mockResolvedValue([myPost({ id: 7, title: '프로젝트 팀원', applicationCount: 4, pendingApplicationCount: 0 })]);
    api.getCommunityPost.mockResolvedValue(detail({ id: 7, title: '프로젝트 팀원' }));
    const app = (id, applicant, hasAppliedBefore) => ({
      id, message: '신청', status: 'rejected', createdAt: '2026-09-03T00:00:00.000Z', applicant, hasAppliedBefore, contactEmail: null, rejectReason: null,
    });
    // 같은 사람이 3번(첫 신청 + 재신청 2번), 다른 사람이 1번 — 신청 4건, 신청자 2명.
    api.getCommunityApplicants.mockResolvedValue([app(1, '지원자', false), app(2, '지원자', true), app(3, '지원자', true), app(4, 'user40', false)]);
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
    await userEvent.click(await screen.findByText('프로젝트 팀원'));

    expect(await screen.findByRole('heading', { level: 3, name: /받은 신청/ })).toHaveTextContent('받은 신청2');
    expect(screen.getByText('신청 4건')).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: '더 보기' }));
    expect(screen.getByRole('menuitem', { name: '수정 (제한됨)' })).toBeDisabled();
  });

  it('제재가 없으면 ⋯ 메뉴의 수정이 활성이고 배너가 없다', async () => {
    api.getMyCommunityPosts.mockResolvedValue([myPost({ id: 1, title: '내 글' })]);
    api.getCommunityPost.mockResolvedValue(detail({ title: '내 글' }));
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
    await userEvent.click(await screen.findByText('내 글'));

    await userEvent.click(await screen.findByRole('button', { name: '더 보기' }));
    expect(screen.getByRole('menuitem', { name: '수정하기' })).toBeEnabled();
    expect(screen.queryByText(/글 작성·수정·신청이 제한돼요/)).toBeNull();
  });

  it('⋯ 메뉴: 신청자가 없으면 모집 마감하기가 막히고 이유가 보인다, 바깥을 누르면 닫힌다', async () => {
    api.getMyCommunityPosts.mockResolvedValue([myPost({ id: 1, title: '내 글' })]);
    api.getCommunityPost.mockResolvedValue(detail({ title: '내 글' }));
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
    await userEvent.click(await screen.findByText('내 글'));

    await userEvent.click(await screen.findByRole('button', { name: '더 보기' }));
    expect(await screen.findByRole('menuitem', { name: '모집 마감하기' })).toBeDisabled();
    expect(screen.getByText('신청자가 1명 이상 있어야 마감할 수 있어요.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('heading', { level: 2 }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('수정 저장이 SANCTIONED(403)로 거절되면(제재가 걸린 뒤 화면을 열어둔 경우) 서버 응답으로 안내 배너를 채운다', async () => {
    api.getMyCommunityPosts.mockResolvedValue([myPost({ id: 1, title: '내 글' })]);
    api.getCommunityPost.mockResolvedValue(detail({ title: '내 글' }));
    const err = Object.assign(new Error('SANCTIONED'), { code: 'SANCTIONED', data: sanction });
    api.editCommunityPost.mockRejectedValue(err);
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
    await userEvent.click(await screen.findByText('내 글'));
    await userEvent.click(await screen.findByRole('button', { name: '더 보기' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '수정하기' }));
    await userEvent.click(screen.getByRole('button', { name: '수정하기' }));

    await waitFor(() => expect(screen.getByText('글 수정이 제한된 계정이에요.')).toBeInTheDocument());
    expect(screen.getByText(/글 작성·수정·신청이 제한돼요/)).toBeInTheDocument();
    expect(screen.getByText(/사유: 운영 정책 위반/)).toBeInTheDocument();
  });
});
