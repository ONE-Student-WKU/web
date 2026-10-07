import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getDepartments: vi.fn(),
  getTracks: vi.fn(),
  submitOnboarding: vi.fn(),
  updateProfile: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import Onboarding from './Onboarding.jsx';

/**
 * client/src/pages/Onboarding.test.jsx
 * 학적정보 수정 화면의 "몇 학번이에요?" 단계가 실제로 그려지는지 확인한다. 이 단계는 개편 전 학과의 "이후 학과" 안내
 * (describeSuccessors)를 쓰는데, import가 빠져 이 화면에 들어가는 순간 ReferenceError로 앱 전체가 사라졌던 적이 있다
 * (학과 선택 트리 개편 #297 이후). 다른 테스트는 이 화면을 렌더하지 않아 못 잡았다.
 */

const FORMER_DEPT = {
  id: 4,
  name: '경영학부',
  minAdmissionYear: 2020,
  maxAdmissionYear: 2022,
  coreMinAdmissionYear: 2020,
  coreMaxAdmissionYear: 2022,
  successors: [{ name: '경영계열', effectiveYear: 2023, confirmed: false }],
  college: '경상대학',
  former: true,
  collegeOrder: 12,
};

const USER = {
  id: 1,
  onboardingCompleted: true,
  departmentId: 4,
  trackId: null,
  enrollmentType: 'GENERAL',
  admissionYear: 2021,
  leaveSemesters: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getDepartments.mockResolvedValue([FORMER_DEPT]);
  api.getTracks.mockResolvedValue([]);
});

describe('학적정보 수정(Onboarding) 화면', () => {
  it('요약 화면이 기존 값을 보여준다', async () => {
    render(<Onboarding user={USER} onDone={() => {}} onSkip={() => {}} />);
    expect(await screen.findByText('경영학부')).toBeInTheDocument();
    expect(screen.getByText('2021학번')).toBeInTheDocument();
    expect(screen.getByText('일반 재학생')).toBeInTheDocument();
  });

  it('학번 항목을 눌러 "몇 학번이에요?" 단계로 가면 오류 없이 그려지고 이후 학과 안내가 보인다', async () => {
    render(<Onboarding user={USER} onDone={() => {}} onSkip={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /학번.*2021학번/ }));

    expect(await screen.findByRole('heading', { name: '몇 학번이에요?' })).toBeInTheDocument();
    expect(screen.getByText('이후 학과(추정): 경영계열')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '2021학번' })).toBeInTheDocument();
  });
});
