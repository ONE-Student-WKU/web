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
const USER = { id: 1, name: '학생', department: '경영학부', departmentId: 4, admissionYear: 2023, leaveSemesters: 0, homeLayout: null };

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

  it('메뉴 카드는 저장된 순서대로 나온다', async () => {
    render(<Home user={{ ...USER, homeLayout: { tabs: ['home', 'graduation', 'career', 'community'], showTabBar: true, menu: ['inquiry', 'community', 'career', 'graduation', 'courses'] } }} onOpenHomeEdit={() => {}} />);
    await screen.findByText('이수학점 진행률');
    const order = ['문의하기', '커뮤니티', '진로 탐색', '졸업요건 진단', '과목 관리'].map((name) => screen.getByRole('button', { name }));
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('메뉴 카드는 고른 것만 나오고, 모두 뺐으면 메뉴 영역이 없다', async () => {
    const layout = (menu) => ({ ...USER, homeLayout: { tabs: ['home', 'graduation', 'career', 'community'], showTabBar: true, menu } });
    const { unmount } = render(<Home user={layout(['career'])} onOpenHomeEdit={() => {}} />);
    await screen.findByText('이수학점 진행률');
    expect(screen.getByRole('button', { name: '진로 탐색' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '과목 관리' })).not.toBeInTheDocument();
    unmount();

    render(<Home user={layout([])} onOpenHomeEdit={() => {}} />);
    await screen.findByText('이수학점 진행률');
    expect(screen.queryByText('메뉴')).not.toBeInTheDocument();
  });

  it('편집 버튼 첫 안내는 한 번 보면 다시 나오지 않고, 버튼을 누르면 편집 화면을 연다', async () => {
    const onOpenHomeEdit = vi.fn();
    const { unmount } = renderHome(onOpenHomeEdit);
    expect(screen.getByText('하단 바와 메뉴를 내게 맞게 바꿀 수 있어요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '홈 화면 편집' }));
    expect(onOpenHomeEdit).toHaveBeenCalled();
    unmount();
    renderHome();
    expect(screen.queryByText('하단 바와 메뉴를 내게 맞게 바꿀 수 있어요')).not.toBeInTheDocument();
  });
});

describe('Home — 학과를 아직 고르지 않은 계정(나중에 선택하기)', () => {
  const onboardingRequired = () => Object.assign(new Error('ONBOARDING_REQUIRED'), { code: 'ONBOARDING_REQUIRED', status: 400 });

  it('진단이 ONBOARDING_REQUIRED로 거절되면 로딩이 끝나고 학과 선택 안내가 나온다(예전엔 스켈레톤이 끝나지 않았다)', async () => {
    api.getGraduationStatus.mockRejectedValue(onboardingRequired());
    const onOpenOnboarding = vi.fn();
    const { container } = render(<Home user={{ ...USER, department: null, departmentId: null, admissionYear: null }} onOpenOnboarding={onOpenOnboarding} onOpenHomeEdit={() => {}} />);
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
  it('학과가 필요한 기능(과목 관리·졸업요건 진단·진로 탐색)은 메뉴에서 흐리게 보이고, 커뮤니티·문의하기는 그대로다', async () => {
    api.getGraduationStatus.mockRejectedValue(onboardingRequired());
    render(<Home user={{ ...USER, department: null, departmentId: null }} onOpenHomeEdit={() => {}} />);
    await screen.findByText('학과·학번을 입력하면 이수학점 진행률과 부족 요건을 볼 수 있어요.');
    for (const name of ['과목 관리', '졸업요건 진단', '진로 탐색']) {
      expect(screen.getByRole('button', { name: `${name} (학과를 고르면 쓸 수 있어요)` })).toHaveClass('locked');
    }
    for (const name of ['커뮤니티', '문의하기']) expect(screen.getByRole('button', { name })).not.toHaveClass('locked');
  });
});

describe('Home — 지금 학년·학기는 서버 값(academicStanding)을 그대로 보여 준다(#318)', () => {
  const standing = (over) => ({ grade: 2, gradeSemester: 2, extended: false, extraTerms: 0, onLeave: false, enrolledTermNumber: 4, ...over });
  it('학년과 학기를 함께 보여 준다', async () => {
    render(<Home user={{ ...USER, academicStanding: standing() }} onOpenHomeEdit={() => {}} />);
    expect(await screen.findByText('2학년 2학기')).toBeInTheDocument();
  });
  it('휴학 중이면 함께 알리고, 수업연한을 넘기면 초과 학기로 보여 준다', async () => {
    const { unmount } = render(<Home user={{ ...USER, academicStanding: standing({ onLeave: true }) }} onOpenHomeEdit={() => {}} />);
    expect(await screen.findByText('2학년 2학기 · 휴학 중')).toBeInTheDocument();
    unmount();
    render(<Home user={{ ...USER, academicStanding: standing({ grade: 4, gradeSemester: null, extended: true, extraTerms: 2 }) }} onOpenHomeEdit={() => {}} />);
    expect(await screen.findByText('초과 2학기')).toBeInTheDocument();
  });
  it('초과 학기에 휴학했으면 "휴학 중"도 함께 보여 준다(#378 — 예전에는 빠졌다)', async () => {
    render(<Home user={{ ...USER, academicStanding: standing({ grade: 4, gradeSemester: null, extended: true, extraTerms: 1, onLeave: true }) }} onOpenHomeEdit={() => {}} />);
    expect(await screen.findByText('초과 1학기 · 휴학 중')).toBeInTheDocument();
  });
  it('서버 값이 없으면(학번 미입력) 학년을 표시하지 않는다', async () => {
    render(<Home user={{ ...USER, academicStanding: null }} onOpenHomeEdit={() => {}} />);
    await screen.findByText(/경영학부/);
    expect(screen.queryByText(/학년/)).toBeNull();
  });
});

describe('Home — 졸업요건 자료가 없거나 진단하지 않는 학과·학번(#378 운영 점검)', () => {
  const NO_DATA = { totalEarnedCredits: 0, totalRequiredCredits: 0, categories: [], certifications: [], regulation: { confidence: 'NO_DATA', flags: [] } };
  it('"모든 요건을 충족했어요!"와 0% 대신 진단할 수 없다는 안내를 보여 준다', async () => {
    api.getGraduationStatus.mockResolvedValue(NO_DATA);
    const { container } = renderHome();
    expect(await screen.findByText('이 학과·학번은 홈에서 부족 요건을 알려드릴 수 없어요. 졸업요건 진단에서 이유를 확인해 주세요.')).toBeInTheDocument();
    expect(screen.queryByText('모든 요건을 충족했어요!')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    expect(container.querySelector('.home-progress-track')).toBeNull();
    expect(container.querySelector('.shortfall-ok')).toBeNull();
  });
  it('자료가 있는데 부족한 게 없으면 예전처럼 충족으로 보여 준다', async () => {
    api.getGraduationStatus.mockResolvedValue({ ...STATUS, regulation: { confidence: 'CONFIRMED', flags: [] } });
    renderHome();
    expect(await screen.findByText('모든 요건을 충족했어요!')).toBeInTheDocument();
  });
});

describe('Home — 입학하자마자 휴학해 다닌 학기가 없을 때(#378 운영 점검)', () => {
  it('학년 없이 "휴학 중"을 보여 주고, 학년을 고칠 수 있는 링크도 남긴다(예전에는 둘 다 사라졌다)', async () => {
    render(<Home user={{ ...USER, academicStanding: { grade: null, gradeSemester: null, extended: false, extraTerms: 0, onLeave: true, enrolledTermNumber: 0 } }} onOpenHomeEdit={() => {}} />);
    expect(await screen.findByText('휴학 중')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '학년이 다르신가요?' })).toBeInTheDocument();
    expect(screen.queryByText(/null/)).toBeNull();
  });
});
