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
import { LanguageProvider } from '../i18n/I18nContext.jsx';

/**
 * client/src/pages/Community.english.test.jsx
 * 영어 화면의 커뮤니티: 화면 문구(탭, 배지, 안내, 오류, 토스트, 제재 안내, 신고 내역)는 영어이고, 학생이 쓴 글(제목·본문·신청 메시지·
 * 닉네임·신고/반려/제재 사유)은 쓴 그대로 보인다.
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
  id: 1, title: '알고리즘 스터디', body: '매주 두 문제씩 풀어요', category: 'study', capacity: 4, closedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z', author: '지원', recruitEndDate: null, recruitState: 'open', ...over,
});
const detail = (over = {}) => ({ ...post(), status: 'approved', isMine: false, myApplication: null, contentHidden: false, rejectReason: null, ...over });

const renderEn = (props = {}) => {
  localStorage.setItem('language', 'en');
  return render(
    <LanguageProvider>
      <Community {...baseProps} {...props} />
    </LanguageProvider>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  resetCommunityCache();
  window.confirm = vi.fn().mockReturnValue(true);
  api.getMySanction.mockResolvedValue(null);
  api.getCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityPosts.mockResolvedValue([]);
  api.getMyCommunityApplications.mockResolvedValue([]);
  api.getCommunityApplicants.mockResolvedValue([]);
  api.getMyReports.mockResolvedValue([]);
  api.markMyReportsSeen.mockResolvedValue({ updated: 0 });
});

describe('커뮤니티 영어 화면', () => {
  it('탭·빈 목록 안내·글쓰기 버튼이 영어다', async () => {
    renderEn();
    expect(await screen.findByText('No posts yet.')).toBeInTheDocument();
    for (const name of ['All posts', 'My posts', 'My applications', 'My reports']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Write a post' })).toBeInTheDocument();
    expect(screen.getByText('Community', { selector: '.screen-title' })).toBeInTheDocument();
  });

  it('목록: 구분 배지·모집 인원·마감일은 영어이고, 제목과 닉네임은 그대로다', async () => {
    api.getCommunityPosts.mockResolvedValue([post({ recruitEndDate: '2026-12-05' })]);
    renderEn();
    const item = (await screen.findByText('알고리즘 스터디')).closest('button');
    expect(within(item).getByText('Study group')).toBeInTheDocument();
    expect(item).toHaveTextContent('지원');
    expect(item).toHaveTextContent('Recruiting 4');
    expect(item).toHaveTextContent('until 12.05');
  });

  it('상세(내 글이 아님): 신청 폼이 영어이고, 신청하면 영어 토스트가 나온다', async () => {
    api.getCommunityPosts.mockResolvedValue([post()]);
    api.getCommunityPost.mockResolvedValue(detail());
    api.applyToCommunityPost.mockResolvedValue({});
    renderEn();
    await userEvent.click((await screen.findByText('알고리즘 스터디')).closest('button'));

    expect(await screen.findByText('Application message')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), '참여하고 싶어요');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText("Applied — you'll find out once the author reviews it.")).toBeInTheDocument();
    expect(api.applyToCommunityPost).toHaveBeenCalledWith(1, '참여하고 싶어요');
  });

  it('신청 오류 코드(이미 신청함)가 영어 안내로 나온다', async () => {
    api.getCommunityPosts.mockResolvedValue([post()]);
    api.getCommunityPost.mockResolvedValue(detail());
    api.applyToCommunityPost.mockRejectedValue(Object.assign(new Error('x'), { code: 'DUPLICATE_APPLICATION' }));
    renderEn();
    await userEvent.click((await screen.findByText('알고리즘 스터디')).closest('button'));
    await userEvent.type(await screen.findByRole('textbox'), 'hi');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText("You've already applied to this post.")).toBeInTheDocument();
  });

  it('내 글 상세: 신청자 목록 제목·수락/거부 버튼은 영어이고 신청 메시지와 거부 사유는 그대로다', async () => {
    api.getMyCommunityPosts.mockResolvedValue([{ ...post(), status: 'approved', applicationCount: 1, pendingApplicationCount: 1 }]);
    api.getCommunityPost.mockResolvedValue(detail({ isMine: true }));
    api.getCommunityApplicants.mockResolvedValue([
      { id: 11, applicant: '민수', message: '열심히 할게요', status: 'pending', createdAt: '2026-09-02T00:00:00.000Z', hasAppliedBefore: true },
      { id: 12, applicant: '하나', message: '질문 있어요', status: 'rejected', rejectReason: '시간이 안 맞아요', createdAt: '2026-09-02T00:00:00.000Z' },
    ]);
    renderEn();
    await userEvent.click(screen.getByRole('button', { name: 'My posts' }));
    expect(await screen.findByText('1 applications waiting for review')).toBeInTheDocument();
    await userEvent.click((await screen.findByText('알고리즘 스터디')).closest('button'));

    expect(await screen.findByText('Applicants for "알고리즘 스터디": 2')).toBeInTheDocument();
    expect(screen.getByText('열심히 할게요')).toBeInTheDocument();
    expect(screen.getByText('Re-applied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    expect(screen.getByText('Reason for declining')).toBeInTheDocument();
    expect(screen.getByText(/시간이 안 맞아요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close recruitment' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('글쓰기 폼: 안내·라벨·마감일 도움말이 영어다', async () => {
    renderEn();
    await userEvent.click(await screen.findByRole('button', { name: 'Write a post' }));
    expect(screen.getByText(/Post to find teammates/)).toBeInTheDocument();
    expect(screen.getByLabelText('Recruitment deadline (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument();
    expect(screen.getByText(/Applications are open through the deadline day/)).toBeInTheDocument();
  });

  it('제재 배너: 안내는 영어이고 사유(사람이 쓴 글)는 그대로이며, <b>가 들어 있어도 굵게 해석하지 않는다', async () => {
    api.getMySanction.mockResolvedValue({ scope: 'post_apply', endsAt: '2026-12-01T00:00:00.000Z', reason: '운영정책 위반 <b>주의</b>' });
    renderEn();
    const banner = (await screen.findByText(/Posting, editing and applying are restricted/)).closest('.community-sanction-banner');
    expect(banner).toHaveTextContent('until 2026.12.01');
    expect(banner).toHaveTextContent('Reason: 운영정책 위반 <b>주의</b>');
    expect(banner.querySelectorAll('strong')).toHaveLength(1); // 기간만 굵게
    expect(screen.getByRole('button', { name: 'Write a post (restricted)' })).toBeDisabled();
  });

  it('전면 정지 화면이 영어다', async () => {
    api.getMySanction.mockResolvedValue({ scope: 'full', endsAt: null, reason: '반복 위반' });
    renderEn();
    expect(await screen.findByText('Your community access is restricted')).toBeInTheDocument();
    expect(screen.getByText('Your access to the whole community is permanently restricted.')).toBeInTheDocument();
    expect(screen.getByText(/반복 위반/)).toBeInTheDocument();
  });

  it('내 신고: 처리 안내가 없으면 영어 기본 문구, 있으면 관리자가 쓴 그대로 보인다', async () => {
    api.getMyReports.mockResolvedValue([
      { id: 1, targetType: 'post', targetTitle: '광고글', status: 'resolved', createdAt: '2026-09-01T00:00:00.000Z', resolvedAt: '2026-09-02T00:00:00.000Z', reason: '광고예요', resolutionNote: null, isUnseen: true },
      { id: 2, targetType: 'application', targetTitle: null, status: 'pending', createdAt: '2026-09-03T00:00:00.000Z', reason: '욕설', resolutionNote: null, isUnseen: false },
      { id: 3, targetType: 'post', targetTitle: '다른 글', status: 'resolved', createdAt: '2026-09-03T00:00:00.000Z', resolvedAt: '2026-09-04T00:00:00.000Z', reason: '허위', resolutionNote: '삭제 처리했습니다', isUnseen: false },
    ]);
    renderEn();
    await userEvent.click(screen.getByRole('button', { name: 'My reports' }));

    expect(await screen.findByText(/Post report · 광고글/)).toBeInTheDocument();
    expect(screen.getByText(/Application report · \(deleted post\)/)).toBeInTheDocument();
    expect(screen.getByText('New result')).toBeInTheDocument();
    expect(screen.getByText(/We reviewed your report and handled it according to the community policy/)).toBeInTheDocument();
    expect(screen.getByText(/삭제 처리했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/An admin is looking into it/)).toBeInTheDocument();
    expect(screen.getByText('Under review')).toBeInTheDocument();
    await waitFor(() => expect(api.markMyReportsSeen).toHaveBeenCalled());
  });

  it('불러오기에 실패하면 영어 오류가 나온다', async () => {
    api.getCommunityPosts.mockRejectedValue(new Error('boom'));
    renderEn();
    expect(await screen.findByText("Couldn't load community posts. Please refresh and try again.")).toBeInTheDocument();
  });
});
