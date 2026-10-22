import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', () => ({
  getCommunityPosts: vi.fn(),
  getNotices: vi.fn(),
  markNoticesSeen: vi.fn(),
  createNotice: vi.fn(),
  updateNotice: vi.fn(),
  deleteNotice: vi.fn(),
  getMyCommunityPosts: vi.fn(),
  getCommunityPost: vi.fn(),
  getMyCommunityApplications: vi.fn(),
  getCommunityApplicants: vi.fn(),
  getMySanction: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import Community, { resetCommunityCache } from './Community.jsx';

/**
 * client/src/pages/Community.notice.test.jsx
 * 커뮤니티 공지(2026-10-22, B안): 전체 글 탭 맨 위에 최신 공지 한 줄을 고정하고, 누르면 공지 목록 → 상세로 간다.
 * 학생은 읽기만 하고(신청·신고 없음), 관리자에게만 공지 쓰기·수정·삭제가 보인다.
 */

const props = (role = 'student', over = {}) => ({
  user: { name: '나', role },
  onGoHome: vi.fn(),
  onLogout: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenOnboarding: vi.fn(),
  onOpenProfile: vi.fn(),
  onOpenAdmin: vi.fn(),
  onOpenInquiry: vi.fn(),
  ...over,
});

const notice = (over = {}) => ({ id: 1, title: '10월 25일 새벽 서비스 점검', body: '새벽 2시부터 4시까지 접속이 안 돼요.', createdAt: '2026-10-22T00:00:00.000Z', updatedAt: null, isNew: false, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  resetCommunityCache();
  api.getMySanction.mockResolvedValue(null);
  api.getCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityApplications.mockResolvedValue([]);
  api.getNotices.mockResolvedValue([notice({ isNew: true }), notice({ id: 2, title: '이용 규칙 안내' })]);
  api.markNoticesSeen.mockResolvedValue(null);
});

describe('커뮤니티 공지', () => {
  it('전체 글 맨 위에 최신 공지 한 줄과 전체 개수가 보이고, 누르면 공지 목록이 열리며 본 것으로 기록한다', async () => {
    const onUnseenNoticesChange = vi.fn();
    render(<Community {...props('student', { onUnseenNoticesChange })} />);
    const pin = await screen.findByRole('button', { name: /10월 25일 새벽 서비스 점검/ });
    expect(pin).toHaveTextContent('공지');
    expect(pin).toHaveTextContent('전체 2 ›');

    await userEvent.click(pin);
    expect(await screen.findByText('이용 규칙 안내')).toBeInTheDocument();
    expect(screen.getByText('새 공지')).toBeInTheDocument();
    await waitFor(() => expect(api.markNoticesSeen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onUnseenNoticesChange).toHaveBeenCalledWith(0));
  });

  it('새 공지가 없으면 목록을 열어도 본 것으로 다시 기록하지 않는다', async () => {
    api.getNotices.mockResolvedValue([notice()]);
    render(<Community {...props()} />);
    await userEvent.click(await screen.findByRole('button', { name: /10월 25일 새벽 서비스 점검/ }));
    await screen.findByText('공지', { selector: '.home-quick-label' });
    expect(api.markNoticesSeen).not.toHaveBeenCalled();
  });

  it('공지가 없으면 고정 줄을 그리지 않는다', async () => {
    api.getNotices.mockResolvedValue([]);
    render(<Community {...props()} />);
    await screen.findByRole('button', { name: /글 검색/ });
    expect(document.querySelector('.notice-pin')).toBeNull();
  });

  it('학생은 공지 상세에서 읽기만 한다(신청·신고·수정 없음), 뒤로가기는 공지 목록 → 전체 글 순서다', async () => {
    render(<Community {...props()} />);
    await userEvent.click(await screen.findByRole('button', { name: /10월 25일 새벽 서비스 점검/ }));
    expect(screen.queryByRole('button', { name: '공지 쓰기' })).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: /10월 25일 새벽 서비스 점검/ })[0]);
    expect(await screen.findByText('새벽 2시부터 4시까지 접속이 안 돼요.')).toBeInTheDocument();
    expect(screen.getByText(/공지에는 신청·신고·댓글을 할 수 없어요/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '신고하기' })).toBeNull();
    expect(screen.queryByRole('button', { name: '수정' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(await screen.findByText('이용 규칙 안내')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(await screen.findByRole('button', { name: /글 검색/ })).toBeInTheDocument();
  });

  it('관리자는 공지를 바로 올릴 수 있고, 올린 뒤 목록을 다시 불러온다', async () => {
    api.createNotice.mockResolvedValue({ id: 3 });
    render(<Community {...props('admin')} />);
    await userEvent.click(await screen.findByRole('button', { name: /10월 25일 새벽 서비스 점검/ }));
    await userEvent.click(await screen.findByRole('button', { name: '공지 쓰기' }));
    expect(screen.getByText('공지는 승인 없이 바로 모든 학생에게 보여요.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('제목'), '  새 공지 제목 ');
    await userEvent.type(screen.getByLabelText('내용'), '공지 본문');
    await userEvent.click(screen.getByRole('button', { name: '공지 올리기' }));
    await waitFor(() => expect(api.createNotice).toHaveBeenCalledWith({ title: '새 공지 제목', body: '공지 본문' }));
    await waitFor(() => expect(api.getNotices).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('공지를 올렸어요.')).toBeInTheDocument();
  });

  it('관리자는 공지 상세에서 고치고 지울 수 있다', async () => {
    api.updateNotice.mockResolvedValue(null);
    api.deleteNotice.mockResolvedValue(null);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Community {...props('admin')} />);
    await userEvent.click(await screen.findByRole('button', { name: /10월 25일 새벽 서비스 점검/ }));
    await userEvent.click(screen.getAllByRole('button', { name: /이용 규칙 안내/ })[0]);
    await userEvent.click(await screen.findByRole('button', { name: '수정' }));
    const title = screen.getByLabelText('제목');
    expect(title).toHaveValue('이용 규칙 안내');
    await userEvent.clear(title);
    await userEvent.type(title, '이용 규칙(개정)');
    await userEvent.click(screen.getByRole('button', { name: '수정하기' }));
    await waitFor(() => expect(api.updateNotice).toHaveBeenCalledWith(2, { title: '이용 규칙(개정)', body: '새벽 2시부터 4시까지 접속이 안 돼요.' }));

    await userEvent.click(screen.getAllByRole('button', { name: /이용 규칙 안내/ })[0]);
    await userEvent.click(await screen.findByRole('button', { name: '삭제' }));
    await waitFor(() => expect(api.deleteNotice).toHaveBeenCalledWith(2));
  });
});
