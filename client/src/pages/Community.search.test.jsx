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
  getMyReports: vi.fn(),
  markMyReportsSeen: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import Community, { resetCommunityCache } from './Community.jsx';

/**
 * client/src/pages/Community.search.test.jsx
 * 게시글 검색(MVP): 목록 위 검색창을 누르면 검색 전용 화면이 열리고, 제목·본문 검색 결과를 같은 모양으로 보여준다.
 */

const baseProps = {
  user: { name: '학생', role: 'student' },
  onGoHome: vi.fn(),
  onLogout: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenOnboarding: vi.fn(),
  onOpenProfile: vi.fn(),
  onOpenAdmin: vi.fn(),
  onOpenInquiry: vi.fn(),
};

const post = (over = {}) => ({
  id: 1,
  title: '알고리즘 스터디',
  body: '본문',
  category: 'study',
  capacity: 4,
  closedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  author: '홍길동',
  recruitEndDate: null,
  recruitState: 'open',
  ...over,
});

const entryButton = () => screen.getByRole('button', { name: '글 검색' });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  resetCommunityCache();
  window.history.replaceState(null, '', '/');
  api.getMySanction.mockResolvedValue(null);
  api.getCommunityPosts.mockImplementation(async (q) => (q ? [post({ id: 7, title: '검색된 글' })] : [post({ id: 1 }), post({ id: 2, title: '다른 글' })]));
  api.getMyCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityApplications.mockResolvedValue([]);
  api.getCommunityApplicants.mockResolvedValue([]);
});

describe('커뮤니티 글 검색', () => {
  it('목록 위 검색창을 누르면 검색 전용 화면이 열리고 검색 입력에 바로 포커스가 간다', async () => {
    render(<Community {...baseProps} />);
    await screen.findByText('알고리즘 스터디');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(entryButton());
    expect(screen.getByRole('dialog', { name: '글 검색' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveFocus();
    expect(screen.getByText('제목이나 내용에 들어간 말로 찾아요.')).toBeInTheDocument();
  });

  it('검색어를 입력하면 서버에 검색어를 보내고 결과를 보여준다', async () => {
    render(<Community {...baseProps} />);
    await screen.findByText('알고리즘 스터디');
    await userEvent.click(entryButton());
    await userEvent.type(screen.getByRole('searchbox'), '스터디');

    await waitFor(() => expect(api.getCommunityPosts).toHaveBeenCalledWith('스터디'));
    expect(await screen.findByText('검색된 글')).toBeInTheDocument();
    expect(screen.getByText('검색 결과 1개')).toBeInTheDocument();
  });

  it('결과가 없으면 검색어를 넣어 알려준다', async () => {
    api.getCommunityPosts.mockImplementation(async (q) => (q ? [] : [post()]));
    render(<Community {...baseProps} />);
    await screen.findByText('알고리즘 스터디');
    await userEvent.click(entryButton());
    await userEvent.type(screen.getByRole('searchbox'), '없는말');
    expect(await screen.findByText('"없는말"에 맞는 결과가 없어요.')).toBeInTheDocument();
  });

  it('검색 요청이 실패하면 오류 안내를 보여준다', async () => {
    api.getCommunityPosts.mockImplementation(async (q) => {
      if (q) throw Object.assign(new Error('x'), { code: 'SERVER' });
      return [post()];
    });
    render(<Community {...baseProps} />);
    await screen.findByText('알고리즘 스터디');
    await userEvent.click(entryButton());
    await userEvent.type(screen.getByRole('searchbox'), '가');
    expect(await screen.findByText('검색하지 못했어요. 잠시 후 다시 시도해주세요.')).toBeInTheDocument();
  });

  it('검색어를 지우면 결과를 비우고 안내로 돌아간다', async () => {
    render(<Community {...baseProps} />);
    await screen.findByText('알고리즘 스터디');
    await userEvent.click(entryButton());
    await userEvent.type(screen.getByRole('searchbox'), '스터디');
    await screen.findByText('검색된 글');

    await userEvent.click(screen.getByRole('button', { name: '검색어 지우기' }));
    expect(screen.queryByText('검색된 글')).not.toBeInTheDocument();
    expect(screen.getByText('제목이나 내용에 들어간 말로 찾아요.')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('결과에서 글을 열면 상세로 가고, 돌아오면 검색 결과가 그대로 있다', async () => {
    api.getCommunityPost.mockResolvedValue({
      ...post({ id: 7, title: '검색된 글' }),
      status: 'approved',
      isMine: false,
      myApplication: null,
      contentHidden: false,
      rejectReason: null,
    });
    render(<Community {...baseProps} />);
    await screen.findByText('알고리즘 스터디');
    await userEvent.click(entryButton());
    await userEvent.type(screen.getByRole('searchbox'), '스터디');
    await userEvent.click(await screen.findByRole('button', { name: /검색된 글/ }));

    await waitFor(() => expect(api.getCommunityPost).toHaveBeenCalledWith(7));
    // 상세가 보이는 동안 검색 화면은 숨겨진다(대화상자로 노출되지 않음).
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(await screen.findByRole('dialog', { name: '글 검색' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('스터디');
    expect(screen.getByText('검색된 글')).toBeInTheDocument();
  });

  it('검색 화면의 뒤로가기 버튼을 누르면 검색 화면만 닫히고 커뮤니티에 남는다', async () => {
    render(<Community {...baseProps} />);
    await screen.findByText('알고리즘 스터디');
    await userEvent.click(entryButton());
    await userEvent.type(screen.getByRole('searchbox'), '스터디');

    await userEvent.click(screen.getByRole('button', { name: '검색 닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(baseProps.onGoHome).not.toHaveBeenCalled();
    expect(screen.getByText('알고리즘 스터디')).toBeInTheDocument();

    // 다시 열면 비어 있는 상태로 시작한다.
    await userEvent.click(entryButton());
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('시스템 뒤로가기(popstate)로도 검색 화면만 닫힌다', async () => {
    render(<Community {...baseProps} />);
    await screen.findByText('알고리즘 스터디');
    await userEvent.click(entryButton());
    expect(window.history.state?.searchScreen).toBe(true);

    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(baseProps.onGoHome).not.toHaveBeenCalled();
  });

  it('내가 쓴 글 탭에는 검색창이 없다(전체 글 검색용)', async () => {
    render(<Community {...baseProps} />);
    await screen.findByText('알고리즘 스터디');
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
    expect(screen.queryByRole('button', { name: '글 검색' })).not.toBeInTheDocument();
  });
});
