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
  getMyReports: vi.fn(),
  markMyReportsSeen: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import Community, { resetCommunityCache } from './Community.jsx';

/**
 * client/src/pages/Community.recruitReports.test.jsx
 * ① 모집 마감일: 마감일이 지난 글은 직접 마감한 글처럼 제목 앞 "마감" + 흐리게 보이고 신청 폼이 없다, 글쓰기에 마감일 입력칸이 있다.
 * ② 내 신고 내역: 처리 상태·관리자 처리 안내(없으면 기본 문구)·새 결과 표시, 열면 확인 처리, 탭의 점.
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

const post = (over = {}) => ({
  id: 1, title: '스터디 모집', body: '본문', category: 'study', capacity: null, closedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z', author: '남', recruitEndDate: null, recruitState: 'open', ...over,
});
const detail = (over = {}) => ({ ...post(), status: 'approved', isMine: false, myApplication: null, contentHidden: false, rejectReason: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  resetCommunityCache();
  api.getMySanction.mockResolvedValue(null);
  api.getCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityApplications.mockResolvedValue([]);
  api.getCommunityApplicants.mockResolvedValue([]);
  api.getMyReports.mockResolvedValue([]);
  api.markMyReportsSeen.mockResolvedValue({ updated: 0 });
});

describe('모집 마감일', () => {
  it('마감일이 지난 글(recruitState=ended)은 목록에서 제목 앞에 "마감"이 붙고 흐리게 보인다, 진행 중인 글은 "N.DD까지"가 보인다', async () => {
    api.getCommunityPosts.mockResolvedValue([
      post({ id: 1, title: '끝난 모집', recruitEndDate: '2026-09-30', recruitState: 'ended' }),
      post({ id: 2, title: '진행 중 모집', recruitEndDate: '2026-12-05', recruitState: 'open' }),
    ]);
    render(<Community {...baseProps} />);
    const ended = (await screen.findByText('끝난 모집')).closest('button');
    expect(within(ended).getByText('마감')).toBeInTheDocument();
    expect(ended.className).toContain('community-post-list-item-closed');
    const open = screen.getByText('진행 중 모집').closest('button');
    expect(within(open).queryByText('마감')).toBeNull();
    expect(open.className).not.toContain('community-post-list-item-closed');
    expect(open).toHaveTextContent('12.05까지');
    expect(ended).not.toHaveTextContent('까지'); // 이미 끝난 글에는 "~까지"를 붙이지 않는다
  });

  it('마감일이 지난 글의 상세에는 "마감" 표시가 있고 신청 폼이 없다', async () => {
    api.getCommunityPosts.mockResolvedValue([post({ recruitEndDate: '2026-09-30', recruitState: 'ended' })]);
    api.getCommunityPost.mockResolvedValue(detail({ recruitEndDate: '2026-09-30', recruitState: 'ended' }));
    render(<Community {...baseProps} />);
    await userEvent.click(await screen.findByText('스터디 모집'));
    expect(await screen.findByText(/모집 기간이 끝났어요 \(9\.30까지\)/)).toBeInTheDocument();
    expect(screen.getByText('모집 기간 마감')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '신청하기' })).toBeNull();
  });

  it('서버가 recruitState를 아직 안 내려주는 배포 순서(프론트 먼저)에서도 기존처럼 동작한다(신청 폼 표시)', async () => {
    const legacy = post();
    delete legacy.recruitState;
    delete legacy.recruitEndDate;
    api.getCommunityPosts.mockResolvedValue([legacy]);
    api.getCommunityPost.mockResolvedValue({ ...detail(), recruitState: undefined, recruitEndDate: undefined });
    render(<Community {...baseProps} />);
    await userEvent.click(await screen.findByText('스터디 모집'));
    expect(await screen.findByRole('button', { name: '신청하기' })).toBeInTheDocument();
  });

  it('서버가 신청을 RECRUIT_ENDED로 거부하면 안내가 나온다', async () => {
    api.getCommunityPosts.mockResolvedValue([post()]);
    api.getCommunityPost.mockResolvedValue(detail());
    api.applyToCommunityPost.mockRejectedValue(Object.assign(new Error('ended'), { code: 'RECRUIT_ENDED' }));
    render(<Community {...baseProps} />);
    await userEvent.click(await screen.findByText('스터디 모집'));
    await userEvent.type(await screen.findByPlaceholderText(/간단한 소개/), '신청합니다');
    await userEvent.click(screen.getByRole('button', { name: '신청하기' }));
    expect(await screen.findByText('모집 기간이 끝나서 신청할 수 없어요.')).toBeInTheDocument();
  });

  it('글쓰기 폼에 마감일 입력칸이 있고(오늘~1년 범위), 입력한 날짜가 payload로 간다, 비우면 null', async () => {
    api.createCommunityPost.mockResolvedValue({ id: 9 });
    render(<Community {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: /글 쓰기/ }));
    const input = screen.getByLabelText('모집 마감일 (선택)');
    expect(input).toHaveAttribute('type', 'date');
    expect(input.min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input.max > input.min).toBe(true);

    await userEvent.type(screen.getByLabelText('제목'), '새 모집');
    await userEvent.type(screen.getByLabelText('내용'), '본문');
    await userEvent.click(screen.getByRole('button', { name: '등록하기' }));
    await waitFor(() => expect(api.createCommunityPost).toHaveBeenCalledTimes(1));
    expect(api.createCommunityPost.mock.calls[0][0]).toMatchObject({ title: '새 모집', recruitEndDate: null });
  });

  it('서버가 마감일을 INVALID_RECRUIT_END로 거부하면 범위 안내가 나온다', async () => {
    api.createCommunityPost.mockRejectedValue(Object.assign(new Error('bad'), { code: 'INVALID_RECRUIT_END' }));
    render(<Community {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: /글 쓰기/ }));
    await userEvent.type(screen.getByLabelText('제목'), '새 모집');
    await userEvent.type(screen.getByLabelText('내용'), '본문');
    await userEvent.click(screen.getByRole('button', { name: '등록하기' }));
    expect(await screen.findByText('모집 마감일은 오늘부터 1년 이내로 정해주세요.')).toBeInTheDocument();
  });
});

describe('내 신고 내역', () => {
  const report = (over = {}) => ({
    id: 1, targetType: 'post', targetTitle: '문제 글', reason: '광고예요', status: 'pending',
    createdAt: '2026-10-01T00:00:00.000Z', resolvedAt: null, resolutionNote: null, isUnseen: false, ...over,
  });

  it('검토 중인 신고는 "검토 중"과 기다려 달라는 안내가 보인다', async () => {
    api.getMyReports.mockResolvedValue([report()]);
    render(<Community {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '내 신고' }));
    expect(await screen.findByText(/글 신고 · 문제 글/)).toBeInTheDocument();
    expect(screen.getByText('검토 중')).toBeInTheDocument();
    expect(screen.getByText(/광고예요/)).toBeInTheDocument();
    expect(screen.getByText(/관리자가 확인하고 있어요/)).toBeInTheDocument();
    expect(api.markMyReportsSeen).not.toHaveBeenCalled();
  });

  it('처리 완료 + 관리자 안내가 있으면 그 문구가, 없으면 기본 문구가 보인다', async () => {
    api.getMyReports.mockResolvedValue([
      report({ id: 1, status: 'resolved', resolvedAt: '2026-10-02T00:00:00.000Z', resolutionNote: '확인했고 조치했어요.' }),
      report({ id: 2, targetTitle: '다른 글', status: 'resolved', resolvedAt: '2026-10-02T00:00:00.000Z', resolutionNote: null }),
    ]);
    render(<Community {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '내 신고' }));
    expect(await screen.findByText(/확인했고 조치했어요\./)).toBeInTheDocument();
    expect(screen.getByText(/신고를 검토했고 커뮤니티 운영 정책에 따라 처리했어요/)).toBeInTheDocument();
    expect(screen.getAllByText('처리 완료')).toHaveLength(2);
  });

  it('새 처리 결과가 있으면 "새 처리 결과" 표시가 보이고, 열면 확인 처리를 서버에 알리고 탭의 점이 사라진다', async () => {
    api.getMyReports.mockResolvedValue([report({ status: 'resolved', resolvedAt: '2026-10-02T00:00:00.000Z', resolutionNote: '조치했어요.', isUnseen: true })]);
    const onUnseenReportsChange = vi.fn();
    const { rerender } = render(<Community {...baseProps} unseenReportCount={1} onUnseenReportsChange={onUnseenReportsChange} />);
    const tab = await screen.findByRole('button', { name: /내 신고/ });
    expect(within(tab).getByLabelText('새 처리 결과 있음')).toBeInTheDocument(); // 점
    await userEvent.click(tab);
    expect(await screen.findByText('새 처리 결과')).toBeInTheDocument();
    await waitFor(() => expect(api.markMyReportsSeen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onUnseenReportsChange).toHaveBeenCalledWith(0));
    rerender(<Community {...baseProps} unseenReportCount={0} onUnseenReportsChange={onUnseenReportsChange} />);
    expect(within(screen.getByRole('button', { name: /내 신고/ })).queryByLabelText('새 처리 결과 있음')).toBeNull();
  });

  it('신고 내역이 없으면 안내 문구, 이 탭에는 글쓰기 버튼이 없다', async () => {
    render(<Community {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '내 신고' }));
    expect(await screen.findByText('신고한 내역이 없어요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /글 쓰기/ })).toBeNull();
  });
});
