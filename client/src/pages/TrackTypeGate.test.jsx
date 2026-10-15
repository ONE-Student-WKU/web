import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', async (importOriginal) => ({ ...(await importOriginal()), updateProfile: vi.fn() }));

import * as api from '../api/chatApi.js';
import TrackTypeGate from './TrackTypeGate.jsx';

/**
 * client/src/pages/TrackTypeGate.test.jsx
 * 이수유형을 받기 전에 온보딩을 마친 광역 계열전공 계정에게 한 번 묻는 화면(#378 결정 3-4 A).
 */

beforeEach(() => vi.clearAllMocks());

describe('TrackTypeGate', () => {
  it('고르기 전에는 저장할 수 없고, 고르면 그 값을 저장해 돌려받은 학생 정보로 넘긴다', async () => {
    const saved = { id: 1, majorTrackType: 'UNDECIDED', trackTypeAnswerRequired: false };
    api.updateProfile.mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<TrackTypeGate onSaved={onSaved} />);
    const save = screen.getByRole('button', { name: '저장하고 계속하기' });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /아직 안 정했어요/ }));
    await userEvent.click(save);
    expect(api.updateProfile).toHaveBeenCalledWith({ majorTrackType: 'UNDECIDED' });
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it('저장에 실패하면 안내하고 화면에 남는다', async () => {
    api.updateProfile.mockRejectedValue(new Error('x'));
    const onSaved = vi.fn();
    render(<TrackTypeGate onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('button', { name: /복수전공형/ }));
    await userEvent.click(screen.getByRole('button', { name: '저장하고 계속하기' }));
    expect(await screen.findByText(/저장하지 못했어요/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
