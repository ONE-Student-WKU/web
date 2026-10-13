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
 * 홈 화면 편집 설정을 홈이 따르는지: 헤더 편집 버튼(첫 안내는 한 번만), 메뉴는 기능 5개 모두, 카드 순서·숨김.
 */

const STATUS = { totalEarnedCredits: 100, totalRequiredCredits: 130, categories: [], certifications: [] };
const USER = { id: 1, name: '학생', department: '경영학부', admissionYear: 2023, leaveSemesters: 0, homeLayout: null };

beforeEach(() => {
  vi.clearAllMocks();
  resetHomeCache();
  localStorage.clear();
  api.getGraduationStatus.mockResolvedValue(STATUS);
});

const renderHome = (user = USER, onOpenHomeEdit = () => {}) => render(<Home user={user} onOpenHomeEdit={onOpenHomeEdit} />);

describe('Home — 홈 화면 편집 설정', () => {
  it('메뉴에 문의하기까지 기능 5개가 글자와 함께 보인다', async () => {
    renderHome();
    await screen.findByText('이수학점 진행률');
    for (const name of ['과목 관리', '졸업요건 진단', '진로 탐색', '커뮤니티', '문의하기']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('편집 버튼 첫 안내는 한 번 닫으면 다시 나오지 않고, 버튼을 누르면 편집 화면을 연다', async () => {
    const onOpenHomeEdit = vi.fn();
    const { unmount } = renderHome(USER, onOpenHomeEdit);
    expect(screen.getByText('홈 화면과 하단 바를 내게 맞게 바꿀 수 있어요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '홈 화면 편집' }));
    expect(onOpenHomeEdit).toHaveBeenCalled();
    unmount();
    renderHome();
    expect(screen.queryByText('홈 화면과 하단 바를 내게 맞게 바꿀 수 있어요')).not.toBeInTheDocument();
  });

  it('숨긴 카드는 안 보이고, 메뉴를 맨 위로 올리면 메뉴가 카드보다 먼저 나온다', async () => {
    const homeLayout = { tabs: ['graduation', 'career', 'community'], cards: { order: ['menu', 'shortfall', 'progress'], hidden: ['progress'] } };
    renderHome({ ...USER, homeLayout });
    await screen.findByText('부족 요건');
    expect(screen.queryByText('이수학점 진행률')).not.toBeInTheDocument();
    const menuLabel = screen.getByText('메뉴');
    const shortfallLabel = screen.getByText('부족 요건');
    expect(menuLabel.compareDocumentPosition(shortfallLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
