import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getGraduationStatus: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import Home, { resetHomeCache } from './Home.jsx';

/**
 * client/src/pages/Home.layout.test.jsx
 * 홈 화면 편집 진입: 헤더 편집 버튼(첫 안내는 한 번만), 메뉴는 홈을 뺀 기능 5개(문의하기 포함), 카드는 고정.
 */

const STATUS = { totalEarnedCredits: 100, totalRequiredCredits: 130, categories: [], certifications: [] };
const USER = { id: 1, name: '학생', department: '경영학부', admissionYear: 2023, leaveSemesters: 0, homeLayout: null };

beforeEach(() => {
  vi.clearAllMocks();
  resetHomeCache();
  localStorage.clear();
  api.getGraduationStatus.mockResolvedValue(STATUS);
});

const renderHome = (onOpenHomeEdit = () => {}) => render(<Home user={USER} onOpenHomeEdit={onOpenHomeEdit} />);

describe('Home — 홈 화면 편집 진입', () => {
  it('카드(진행률·부족 요건)는 고정이고, 메뉴에 문의하기까지 기능 5개가 글자와 함께 보인다', async () => {
    renderHome();
    expect(await screen.findByText('이수학점 진행률')).toBeInTheDocument();
    expect(screen.getByText('부족 요건')).toBeInTheDocument();
    for (const name of ['과목 관리', '졸업요건 진단', '진로 탐색', '커뮤니티', '문의하기']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('편집 버튼 첫 안내는 한 번 보면 다시 나오지 않고, 버튼을 누르면 편집 화면을 연다', async () => {
    const onOpenHomeEdit = vi.fn();
    const { unmount } = renderHome(onOpenHomeEdit);
    expect(screen.getByText('하단 바를 내게 맞게 바꾸거나 끌 수 있어요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '홈 화면 편집' }));
    expect(onOpenHomeEdit).toHaveBeenCalled();
    unmount();
    renderHome();
    expect(screen.queryByText('하단 바를 내게 맞게 바꾸거나 끌 수 있어요')).not.toBeInTheDocument();
  });
});

describe('Home — 학과를 아직 고르지 않은 계정(나중에 선택하기)', () => {
  const onboardingRequired = () => Object.assign(new Error('ONBOARDING_REQUIRED'), { code: 'ONBOARDING_REQUIRED', status: 400 });

  it('진단이 ONBOARDING_REQUIRED로 거절되면 로딩이 끝나고 학과 선택 안내가 나온다(예전엔 스켈레톤이 끝나지 않았다)', async () => {
    api.getGraduationStatus.mockRejectedValue(onboardingRequired());
    const onOpenOnboarding = vi.fn();
    const { container } = render(<Home user={{ ...USER, department: null, admissionYear: null }} onOpenOnboarding={onOpenOnboarding} onOpenHomeEdit={() => {}} />);
    expect(await screen.findByText('학과·학번을 입력하면 이수학점 진행률과 부족 요건을 볼 수 있어요.')).toBeInTheDocument();
    expect(container.querySelector('.home-body .skeleton')).toBeNull();
    expect(screen.getByText('학과 정보 없음')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '학과 선택하기' }));
    expect(onOpenOnboarding).toHaveBeenCalledTimes(1);
  });

  it('캐시에 남은 이전 값(다른 계정 등)은 진단이 거절되면 지우고 보여 주지 않는다', async () => {
    const { unmount } = renderHome(); // 정상 계정으로 한 번 받아 캐시가 채워진 상태
    expect(await screen.findByText('/ 130학점')).toBeInTheDocument();
    unmount();

    api.getGraduationStatus.mockRejectedValue(onboardingRequired());
    renderHome();
    expect(await screen.findByText('학과·학번을 입력하면 이수학점 진행률과 부족 요건을 볼 수 있어요.')).toBeInTheDocument();
    expect(screen.queryByText('/ 130학점')).toBeNull();
    expect(sessionStorage.getItem('wku_cache_home_status')).toBeNull();
  });
});
