import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  saveLeavePeriods: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import LeaveGate from './LeaveGate.jsx';

/**
 * client/src/pages/LeaveGate.test.jsx
 * 휴학 기간을 받기 전에 온보딩을 마친 계정에게 한 번 묻는 화면. 답하기 전에는 저장할 수 없고, "없어요"는 []를, 기간은 그 값을 보낸다.
 * 예전에 휴학 학기 수만 입력한 계정에는 그 수를 보여 준다.
 */

const USER = { id: 1, onboardingCompleted: true, enrollmentType: 'GENERAL', admissionYear: 2021, leaveSemesters: 0, leavePeriods: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LeaveGate', () => {
  it('답하기 전에는 저장할 수 없고, "휴학한 적 없어요"를 고르면 빈 기간을 저장한다', async () => {
    const saved = { ...USER, leavePeriods: [], leaveAnswerRequired: false };
    api.saveLeavePeriods.mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<LeaveGate user={USER} onSaved={onSaved} />);

    const save = screen.getByRole('button', { name: '저장하고 계속하기' });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '휴학한 적 없어요' }));
    await userEvent.click(save);
    expect(api.saveLeavePeriods).toHaveBeenCalledWith([]);
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it('예전에 휴학 학기 수만 입력했으면 그 수를 보여 주고, 기간을 고르면 그 값을 보낸다', async () => {
    api.saveLeavePeriods.mockResolvedValue({});
    render(<LeaveGate user={{ ...USER, leaveSemesters: 4 }} onSaved={() => {}} />);
    expect(screen.getByText('이전에 휴학 4학기로 입력하셨어요. 언제였는지 알려 주세요.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /휴학한 적 있어요/ }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '시작 학년도' }), '2022');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '시작 학기' }), '2');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '휴학한 학기 수' }), '4');
    await userEvent.click(screen.getByRole('button', { name: '저장하고 계속하기' }));
    expect(api.saveLeavePeriods).toHaveBeenCalledWith([{ startYear: 2022, startSemester: 2, semesters: 4 }]);
  });

  it('서버가 입학 전 학기라고 거부하면 이유를 보여 준다', async () => {
    api.saveLeavePeriods.mockRejectedValue(Object.assign(new Error('x'), { code: 'LEAVE_BEFORE_ADMISSION' }));
    render(<LeaveGate user={USER} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /휴학한 적 있어요/ }));
    await userEvent.click(screen.getByRole('button', { name: '저장하고 계속하기' }));
    expect(await screen.findByText('입학(편입)하기 전 학기는 넣을 수 없어요.')).toBeInTheDocument();
  });
});
