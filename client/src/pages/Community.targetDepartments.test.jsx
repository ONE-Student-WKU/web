import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', () => ({
  getCommunityPosts: vi.fn(),
  // 공지(전체 글 탭 맨 위 고정 줄, 별도 브랜치)와 합쳐져도 이 테스트는 공지가 없는 상태로 본다.
  getNotices: vi.fn(() => Promise.resolve([])),
  markNoticeRead: vi.fn(() => Promise.resolve(null)),
  markAllNoticesRead: vi.fn(() => Promise.resolve(null)),
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
  getDepartments: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import Community, { resetCommunityCache } from './Community.jsx';

/**
 * client/src/pages/Community.targetDepartments.test.jsx
 * 커뮤니티 모집 학과(2026-10-22 피드백): 목록의 모집 학과 줄·"내 학과" 배지·"내 학과 글만 보기", 상세의 모집 학과,
 * 글쓰기의 "학과 상관없음 / 특정 학과만"(기본은 글쓴이 학과)과 학과 추가·빼기. API는 mock.
 */

const user = { name: '글쓴이', role: 'student', departmentId: 1, department: '컴퓨터·소프트웨어공학과' };
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

const CSE = { id: 1, name: '컴퓨터·소프트웨어공학과' };
const ENG3 = { id: 2, name: '공학3계열' };
const BIZ = { id: 4, name: '경영학부' };
const ECON = { id: 5, name: '경제학과' };

const post = (over = {}) => ({
  id: 1,
  title: '알고리즘 스터디',
  body: '본문',
  category: 'study',
  capacity: null,
  closedAt: null,
  createdAt: '2026-10-20T00:00:00.000Z',
  author: '홍길동',
  targetDepartments: [],
  isMyDepartment: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  resetCommunityCache();
  api.getMySanction.mockResolvedValue(null);
  api.getCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityApplications.mockResolvedValue([]);
  api.getCommunityApplicants.mockResolvedValue([]);
  api.createCommunityPost.mockResolvedValue({ id: 99 });
  api.getDepartments.mockResolvedValue([
    { ...CSE, college: null, former: true },
    { ...ENG3, college: '공과대학' },
    { ...BIZ, college: '경상대학' },
    { ...ECON, college: '경상대학' },
  ]);
});

const rowOf = async (title) => (await screen.findByText(title)).closest('button');

describe('목록과 상세', () => {
  it('모집 학과 줄: 2개까지는 이름을 다 쓰고, 3개면 "외 1개", 학과 상관없는 글은 "모든 학과"', async () => {
    api.getCommunityPosts.mockResolvedValue([
      post({ id: 1, title: '두 학과', targetDepartments: [CSE, ENG3] }),
      post({ id: 2, title: '세 학과', targetDepartments: [BIZ, ECON, ENG3] }),
      post({ id: 3, title: '상관없음' }),
    ]);
    render(<Community {...baseProps} />);
    expect((await rowOf('두 학과')).querySelector('.post-dept')).toHaveTextContent('모집 학과컴퓨터·소프트웨어공학과, 공학3계열');
    expect((await rowOf('세 학과')).querySelector('.post-dept')).toHaveTextContent('경영학부, 경제학과 외 1개');
    expect((await rowOf('상관없음')).querySelector('.post-dept')).toHaveTextContent('모든 학과');
  });

  it('내 학과를 모집하는 글에만 "내 학과" 배지가 붙는다', async () => {
    api.getCommunityPosts.mockResolvedValue([post({ id: 1, title: '내 학과 글', targetDepartments: [ENG3], isMyDepartment: true }), post({ id: 2, title: '다른 학과 글', targetDepartments: [BIZ] })]);
    render(<Community {...baseProps} />);
    expect((await rowOf('내 학과 글')).querySelector('.post-mydept')).toHaveTextContent('내 학과');
    expect((await rowOf('다른 학과 글')).querySelector('.post-mydept')).toBeNull();
  });

  it('서버가 모집 학과를 안 내려주면(배포 순서) 줄을 숨긴다', async () => {
    api.getCommunityPosts.mockResolvedValue([post({ title: '예전 응답', targetDepartments: undefined, isMyDepartment: undefined })]);
    render(<Community {...baseProps} />);
    expect((await rowOf('예전 응답')).querySelector('.post-dept')).toBeNull();
  });

  it('"내 학과" 필터를 켜면 다른 학과만 모집하는 글이 빠지고(학과 상관없는 글은 남음), 브라우저에 기억된다', async () => {
    api.getCommunityPosts.mockResolvedValue([
      post({ id: 1, title: '내 학과 글', targetDepartments: [ENG3], isMyDepartment: true }),
      post({ id: 2, title: '다른 학과 글', targetDepartments: [BIZ] }),
      post({ id: 3, title: '아무나 글' }),
    ]);
    const { unmount } = render(<Community {...baseProps} />);
    await screen.findByText('다른 학과 글');
    await userEvent.click(screen.getByRole('button', { name: '내 학과 글만 보기' }));
    expect(screen.queryByText('다른 학과 글')).toBeNull();
    expect(screen.getByText('내 학과 글')).toBeInTheDocument();
    expect(screen.getByText('아무나 글')).toBeInTheDocument();
    unmount();

    render(<Community {...baseProps} />);
    expect(screen.getByRole('button', { name: '내 학과 글만 보기' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('학과가 없는 계정에는 "내 학과 글만 보기"가 없다', async () => {
    api.getCommunityPosts.mockResolvedValue([post({ title: '글' })]);
    render(<Community {...baseProps} user={{ name: '학과없음', role: 'student' }} />);
    await screen.findByText('글');
    expect(screen.queryByRole('button', { name: '내 학과 글만 보기' })).toBeNull();
  });

  it('상세에는 모집 학과를 모두 보여준다', async () => {
    api.getCommunityPosts.mockResolvedValue([post({ title: '세 학과', targetDepartments: [BIZ, ECON, ENG3] })]);
    api.getCommunityPost.mockResolvedValue({ ...post({ title: '세 학과', targetDepartments: [BIZ, ECON, ENG3] }), status: 'approved', isMine: false, myApplication: null, contentHidden: false });
    render(<Community {...baseProps} />);
    await userEvent.click(await rowOf('세 학과'));
    expect((await screen.findByText(/경영학부, 경제학과, 공학3계열/)).closest('.post-fact')).toHaveTextContent('모집 학과');
  });
});

describe('글쓰기', () => {
  const openWrite = async () => {
    render(<Community {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '글 쓰기' }));
    await userEvent.type(screen.getByLabelText('제목'), '스터디');
    await userEvent.type(screen.getByLabelText('내용'), '같이 해요');
  };

  it('기본은 "특정 학과만"에 글쓴이 학과가 골라져 있고, 그대로 올리면 그 학과로 저장된다', async () => {
    await openWrite();
    expect(screen.getByRole('button', { name: '특정 학과만' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.dept-chip')).toHaveTextContent('컴퓨터·소프트웨어공학과');
    await userEvent.click(screen.getByRole('button', { name: '등록하기' }));
    await waitFor(() => expect(api.createCommunityPost).toHaveBeenCalledWith(expect.objectContaining({ departmentIds: [1] })));
  });

  it('"학과 상관없음"으로 바꾸면 학과 칩이 사라지고 빈 목록으로 저장된다', async () => {
    await openWrite();
    await userEvent.click(screen.getByRole('button', { name: '학과 상관없음' }));
    expect(document.querySelector('.dept-chip')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '등록하기' }));
    await waitFor(() => expect(api.createCommunityPost).toHaveBeenCalledWith(expect.objectContaining({ departmentIds: [] })));
  });

  it('특정 학과만인데 학과를 다 빼면 올리지 않고 학과를 고르라고 안내한다', async () => {
    await openWrite();
    await userEvent.click(screen.getByRole('button', { name: '컴퓨터·소프트웨어공학과 빼기' }));
    await userEvent.click(screen.getByRole('button', { name: '등록하기' }));
    expect(await screen.findByText(/모집할 학과를 골라주세요/)).toBeInTheDocument();
    expect(api.createCommunityPost).not.toHaveBeenCalled();
  });

  it('학과 검색으로 학과를 더 붙이고, 3개가 되면 "학과 추가"가 사라진다', async () => {
    await openWrite();
    for (const [query, name] of [
      ['공학3', '공학3계열'],
      ['경영', '경영학부'],
    ]) {
      await userEvent.click(screen.getByRole('button', { name: '학과 추가' }));
      const dialog = await screen.findByRole('dialog', { name: '학과 검색' });
      await userEvent.type(within(dialog).getByRole('searchbox', { name: '학과 검색' }), query);
      await userEvent.click(await within(dialog).findByRole('button', { name: new RegExp(`^${name}`) }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '학과 검색' })).toBeNull());
    }
    expect([...document.querySelectorAll('.dept-chip')].map((c) => c.firstChild.textContent)).toEqual(['컴퓨터·소프트웨어공학과', '공학3계열', '경영학부']);
    expect(screen.queryByRole('button', { name: '학과 추가' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '등록하기' }));
    await waitFor(() => expect(api.createCommunityPost).toHaveBeenCalledWith(expect.objectContaining({ departmentIds: [1, 2, 4] })));
  });

  it('글을 고칠 때는 그 글의 모집 학과가 채워져 있다(학과 상관없는 글이면 "학과 상관없음")', async () => {
    api.getMyCommunityPosts.mockResolvedValue([{ ...post({ title: '내 글', targetDepartments: [] }), status: 'approved' }]);
    api.getCommunityPost.mockResolvedValue({ ...post({ title: '내 글', targetDepartments: [] }), status: 'approved', isMine: true, myApplication: null, contentHidden: false });
    render(<Community {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: '내가 쓴 글' }));
    await userEvent.click(await rowOf('내 글'));
    await userEvent.click(await screen.findByRole('button', { name: '더 보기' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '수정하기' }));
    expect(screen.getByRole('button', { name: '학과 상관없음' })).toHaveAttribute('aria-pressed', 'true');
  });
});
