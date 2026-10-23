import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', () => ({
  getCommunityPosts: vi.fn(),
  getNotices: vi.fn(),
  markNoticeRead: vi.fn(),
  markAllNoticesRead: vi.fn(),
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
 * 커뮤니티 공지(2026-10-23 개편): 공지는 상세를 열어야 읽은 것이 된다(목록을 여는 것만으로는 아니다). 전체 글 위에는 안 읽은 공지
 * 개수와 최대 3개를 줄로 보여주고, 다 읽었으면 최근 공지 한 줄로 줄어든다. 작성자는 "ONE Student 운영팀"이다.
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

const notice = (over = {}) => ({
  id: 1,
  title: '10월 25일 새벽 서비스 점검',
  body: '새벽 2시부터 4시까지 접속이 안 돼요.',
  createdAt: '2026-10-22T00:00:00.000Z',
  updatedAt: null,
  isNew: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  resetCommunityCache();
  api.getMySanction.mockResolvedValue(null);
  api.getCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityApplications.mockResolvedValue([]);
  api.getNotices.mockResolvedValue([notice({ isNew: true }), notice({ id: 2, title: '이용 규칙 안내' })]);
  api.markNoticeRead.mockResolvedValue(null);
  api.markAllNoticesRead.mockResolvedValue(null);
});

const pin = () => document.querySelector('.notice-pin');

describe('전체 글 위 공지', () => {
  it('안 읽은 공지가 있으면 개수와 그 공지 줄이 보이고, 줄을 누르면 목록을 거치지 않고 바로 그 공지가 열리며 읽음으로 기록한다', async () => {
    const onUnseenNoticesChange = vi.fn();
    render(<Community {...props('student', { onUnseenNoticesChange })} />);
    await screen.findByText('안 읽은 공지 1개');
    expect(pin()).toHaveTextContent('전체 2');
    expect(within(pin()).queryByText('이용 규칙 안내')).toBeNull(); // 읽은 공지는 줄로 나오지 않는다

    await userEvent.click(within(pin()).getByRole('button', { name: /10월 25일 새벽 서비스 점검/ }));
    expect(await screen.findByText('새벽 2시부터 4시까지 접속이 안 돼요.')).toBeInTheDocument();
    expect(api.markNoticeRead).toHaveBeenCalledWith(1);
    expect(onUnseenNoticesChange).toHaveBeenCalledWith(0);
  });

  it('안 읽은 공지가 4개 이상이면 3줄만 보이고 "외 n개 더 보기"로 목록에 간다', async () => {
    api.getNotices.mockResolvedValue([1, 2, 3, 4].map((id) => notice({ id, title: `공지 ${id}`, isNew: true })));
    render(<Community {...props()} />);
    await screen.findByText('안 읽은 공지 4개');
    expect(within(pin()).getAllByRole('button', { name: /^공지 \d/ })).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: '외 1개 더 보기' }));
    expect(await screen.findByRole('button', { name: '모두 읽음으로 표시' })).toBeInTheDocument();
  });

  it('다 읽었으면 최근 공지 한 줄로 줄어들고 개수 표시가 없다', async () => {
    api.getNotices.mockResolvedValue([notice(), notice({ id: 2, title: '이용 규칙 안내' })]);
    render(<Community {...props()} />);
    const line = await screen.findByRole('button', { name: /10월 25일 새벽 서비스 점검/ });
    expect(line).toHaveTextContent('전체 2');
    expect(screen.queryByText(/안 읽은 공지/)).toBeNull();
  });

  it('공지가 없으면 그리지 않는다', async () => {
    api.getNotices.mockResolvedValue([]);
    render(<Community {...props()} />);
    await screen.findByRole('button', { name: /글 검색/ });
    expect(pin()).toBeNull();
  });
});

describe('공지 목록·상세', () => {
  const openList = async () => {
    render(<Community {...props()} />);
    await userEvent.click(await screen.findByRole('button', { name: /전체 2/ }));
    await screen.findByText('공지', { selector: '.screen-title' });
  };

  it('목록을 여는 것만으로는 읽음으로 기록하지 않고, 안 읽은 공지에만 "새 공지"가 붙는다', async () => {
    await openList();
    expect(screen.getAllByText('새 공지')).toHaveLength(1);
    expect(screen.getAllByText(/ONE Student 운영팀/).length).toBeGreaterThan(0);
    expect(api.markNoticeRead).not.toHaveBeenCalled();
    expect(api.markAllNoticesRead).not.toHaveBeenCalled();
  });

  it('"모두 읽음으로 표시"를 누르면 새 공지 표시가 모두 사라지고 남은 수 0을 알린다', async () => {
    const onUnseenNoticesChange = vi.fn();
    render(<Community {...props('student', { onUnseenNoticesChange })} />);
    await userEvent.click(await screen.findByRole('button', { name: /전체 2/ }));
    await userEvent.click(await screen.findByRole('button', { name: '모두 읽음으로 표시' }));
    expect(api.markAllNoticesRead).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('새 공지')).toBeNull();
    expect(screen.queryByRole('button', { name: '모두 읽음으로 표시' })).toBeNull();
    expect(onUnseenNoticesChange).toHaveBeenCalledWith(0);
  });

  it('이미 읽은 공지를 열면 다시 기록하지 않는다', async () => {
    await openList();
    await userEvent.click(screen.getByRole('button', { name: /이용 규칙 안내/ }));
    await screen.findByRole('heading', { name: '이용 규칙 안내' });
    expect(api.markNoticeRead).not.toHaveBeenCalled();
  });

  it('학생은 공지 상세에서 읽기만 한다(신청·신고·⋯ 메뉴 없음), 작성자는 ONE Student 운영팀이고, 뒤로가기는 공지 목록 → 전체 글 순서다', async () => {
    await openList();
    expect(screen.queryByRole('button', { name: '공지 쓰기' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /10월 25일 새벽 서비스 점검/ }));
    expect(await screen.findByText('새벽 2시부터 4시까지 접속이 안 돼요.')).toBeInTheDocument();
    expect(screen.getByText('ONE Student 운영팀')).toBeInTheDocument();
    expect(screen.getByText(/공지에는 신청·신고·댓글을 할 수 없어요/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '신고하기' })).toBeNull();
    expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(await screen.findByText('이용 규칙 안내')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '목록으로' }));
    expect(await screen.findByRole('button', { name: /글 검색/ })).toBeInTheDocument();
  });
});

describe('관리자', () => {
  it('공지를 바로 올릴 수 있고, 올린 뒤 목록을 다시 불러온다', async () => {
    api.createNotice.mockResolvedValue({ id: 3 });
    render(<Community {...props('admin')} />);
    await userEvent.click(await screen.findByRole('button', { name: /전체 2/ }));
    await userEvent.click(await screen.findByRole('button', { name: '공지 쓰기' }));
    expect(screen.getByText(/공지는 승인 없이 바로 모든 학생에게 보여요/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('제목'), '  새 공지 제목 ');
    await userEvent.type(screen.getByLabelText('내용'), '공지 본문');
    await userEvent.click(screen.getByRole('button', { name: '공지 올리기' }));
    await waitFor(() => expect(api.createNotice).toHaveBeenCalledWith({ title: '새 공지 제목', body: '공지 본문' }));
    await waitFor(() => expect(api.getNotices).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('공지를 올렸어요.')).toBeInTheDocument();
  });

  it('공지 상세의 ⋯ 메뉴에서 고치고 지울 수 있다', async () => {
    api.updateNotice.mockResolvedValue(null);
    api.deleteNotice.mockResolvedValue(null);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Community {...props('admin')} />);
    await userEvent.click(await screen.findByRole('button', { name: /전체 2/ }));
    await userEvent.click(await screen.findByRole('button', { name: /이용 규칙 안내/ }));
    await userEvent.click(await screen.findByRole('button', { name: '더 보기' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '수정' }));
    expect(screen.getByText(/이미 읽은 학생에게 새 공지로 다시 뜨지는 않아요/)).toBeInTheDocument();
    expect(screen.getByText('공지', { selector: '.screen-title' })).toBeInTheDocument();
    const title = screen.getByLabelText('제목');
    expect(title).toHaveValue('이용 규칙 안내');
    await userEvent.clear(title);
    await userEvent.type(title, '이용 규칙(개정)');
    await userEvent.click(screen.getByRole('button', { name: '수정하기' }));
    await waitFor(() => expect(api.updateNotice).toHaveBeenCalledWith(2, { title: '이용 규칙(개정)', body: '새벽 2시부터 4시까지 접속이 안 돼요.' }));

    await userEvent.click(await screen.findByRole('button', { name: /이용 규칙 안내/ }));
    await userEvent.click(await screen.findByRole('button', { name: '더 보기' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '삭제' }));
    await waitFor(() => expect(api.deleteNotice).toHaveBeenCalledWith(2));
  });
});
