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

// 편입생 테스트용 학과: 요건이 있는 학번 2017~2024.
const TRANSFER_DEPT = {
  id: 7,
  name: '국어국문학과',
  minAdmissionYear: 2017,
  maxAdmissionYear: 2024,
  coreMinAdmissionYear: 2017,
  coreMaxAdmissionYear: 2024,
  successors: [],
  college: '인문대학',
  former: false,
  collegeOrder: 1,
};

const transferUser = (over = {}) => ({
  id: 2,
  onboardingCompleted: true,
  departmentId: 7,
  trackId: null,
  enrollmentType: 'TRANSFER_ADMISSION',
  admissionYear: 2024,
  transferGrade: 3,
  leaveSemesters: 0,
  ...over,
});

const USER = {
  id: 1,
  onboardingCompleted: true,
  departmentId: 4,
  trackId: null,
  enrollmentType: 'GENERAL',
  admissionYear: 2021,
  leaveSemesters: 0,
};

// 요약 화면에는 '저장'이 둘이다(휴학 학기 수 저장, 전체 저장). 전체 저장이 화면 맨 아래 마지막 버튼이다.
const saveButton = () => screen.getAllByRole('button', { name: '저장' }).at(-1);

beforeEach(() => {
  vi.clearAllMocks();
  api.getDepartments.mockResolvedValue([FORMER_DEPT, TRANSFER_DEPT]);
  api.updateProfile.mockResolvedValue({});
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

describe('편입생: 편입 연도·학년 입력(제14조③ — 학번 = 편입 연도 − 학년 + 1)', () => {
  it('편입 학년을 저장한 편입생: 요약에 "2026년 3학년 편입"과 적용 학번 2024학번이 보이고, 저장하면 학번·편입 학년이 그대로 간다', async () => {
    render(<Onboarding user={transferUser()} onDone={() => {}} onSkip={() => {}} />);
    expect(await screen.findByText('2026년 3학년 편입')).toBeInTheDocument();
    expect(screen.getByText('2024학번')).toBeInTheDocument();

    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ departmentId: 7, admissionYear: 2024, enrollmentType: 'TRANSFER_ADMISSION', transferGrade: 3 })
    );
  });

  it('옛 방식으로 입력한 편입생(편입 학년 없음): "편입 시점"이 선택 필요로 보이고 다시 입력하기 전에는 저장할 수 없다', async () => {
    render(<Onboarding user={transferUser({ transferGrade: null })} onDone={() => {}} onSkip={() => {}} />);
    const row = await screen.findByRole('button', { name: /편입 시점/ });
    expect(row).toHaveTextContent('선택 필요');
    expect(saveButton()).toBeDisabled();
  });

  it('편입 시점을 고르면 적용 학번을 계산해 보여 주고, 확인 후 저장하면 계산된 학번과 편입 학년이 간다', async () => {
    render(<Onboarding user={transferUser({ transferGrade: null, admissionYear: 2026 })} onDone={() => {}} onSkip={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /편입 시점/ }));
    expect(await screen.findByRole('heading', { name: '언제, 몇 학년으로 편입했어요?' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox'), '2026');
    await userEvent.click(screen.getByRole('button', { name: '3학년' }));
    expect(screen.getByText('적용 학번: 2024학번')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(await screen.findByText('2026년 3학년 편입')).toBeInTheDocument();
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ admissionYear: 2024, transferGrade: 3 }));
  });

  it('그 학번의 자료가 이 학과에 없는 조합(2018년 4학년 편입 → 2015학번)이면 안내를 보여 주고 확인할 수 없다', async () => {
    render(<Onboarding user={transferUser({ transferGrade: null })} onDone={() => {}} onSkip={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /편입 시점/ }));
    await userEvent.selectOptions(await screen.findByRole('combobox'), '2018');
    await userEvent.click(screen.getByRole('button', { name: '4학년' }));
    expect(screen.getByText(/2015학번 자료가 없어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인' })).toBeDisabled();
  });

  it('편입생이 아닌 계정은 편입 시점 항목이 없고, 저장할 때 편입 학년을 null로 보낸다', async () => {
    render(<Onboarding user={USER} onDone={() => {}} onSkip={() => {}} />);
    await screen.findByText('경영학부');
    expect(screen.queryByText('편입 시점')).not.toBeInTheDocument();
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ enrollmentType: 'GENERAL', transferGrade: null }));
  });
});
