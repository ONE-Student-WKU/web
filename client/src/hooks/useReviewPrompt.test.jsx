import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

vi.mock('../api/chatApi.js', () => ({ getReviewPrompt: vi.fn(), markReviewPromptShown: vi.fn() }));

import * as api from '../api/chatApi.js';
import useReviewPrompt, { ACTIVE_MS_BEFORE_RECHECK } from './useReviewPrompt.js';

/**
 * client/src/hooks/useReviewPrompt.test.jsx
 * 후기 창을 언제 띄우나: 다른 화면에서 홈으로 돌아올 때만, 접속할 때 이미 기준을 채웠으면 첫 귀환에,
 * 아니면 앱을 3분 이상 본 뒤 서버에 다시 물어서. 한 접속에 한 번, 다른 창이 떠 있으면 띄우지 않는다.
 */

function Harness({ view, blocked = false, studentId = 1 }) {
  const [open] = useReviewPrompt({ studentId, view, blocked });
  return <div data-testid="state">{open ? 'open' : 'closed'}</div>;
}

const state = (r) => r.getByTestId('state').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  api.markReviewPromptShown.mockResolvedValue(null);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-09T12:00:00+09:00'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('후기 창 띄우는 때', () => {
  it('접속할 때 이미 기준을 채웠으면, 들어오자마자가 아니라 홈으로 돌아올 때 한 번 띄운다', async () => {
    api.getReviewPrompt.mockResolvedValue(true);
    const r = render(<Harness view="home" />);
    await waitFor(() => expect(api.getReviewPrompt).toHaveBeenCalledTimes(1));
    expect(state(r)).toBe('closed');

    r.rerender(<Harness view="chat" />);
    expect(state(r)).toBe('closed');
    r.rerender(<Harness view="home" />);
    expect(state(r)).toBe('open');
    expect(api.markReviewPromptShown).toHaveBeenCalledTimes(1);

    // 한 접속에 한 번
    r.rerender(<Harness view="courses" />);
    r.rerender(<Harness view="home" />);
    expect(api.markReviewPromptShown).toHaveBeenCalledTimes(1);
  });

  it('접속할 때 기준을 못 채웠으면 3분이 지나기 전엔 묻지 않고, 지난 뒤 홈으로 돌아올 때 다시 묻는다', async () => {
    api.getReviewPrompt.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const r = render(<Harness view="home" />);
    await waitFor(() => expect(api.getReviewPrompt).toHaveBeenCalledTimes(1));

    r.rerender(<Harness view="courses" />);
    r.rerender(<Harness view="home" />);
    expect(api.getReviewPrompt).toHaveBeenCalledTimes(1);
    expect(state(r)).toBe('closed');

    vi.setSystemTime(Date.now() + ACTIVE_MS_BEFORE_RECHECK);
    r.rerender(<Harness view="courses" />);
    r.rerender(<Harness view="home" />);
    expect(api.getReviewPrompt).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(state(r)).toBe('open'));
    expect(api.markReviewPromptShown).toHaveBeenCalledTimes(1);
  });

  it('탭이 숨어 있던 시간은 3분에 넣지 않는다', async () => {
    api.getReviewPrompt.mockResolvedValue(false);
    const r = render(<Harness view="home" />);
    await waitFor(() => expect(api.getReviewPrompt).toHaveBeenCalledTimes(1));

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    vi.setSystemTime(Date.now() + ACTIVE_MS_BEFORE_RECHECK * 2);
    visibility.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    visibility.mockRestore();

    r.rerender(<Harness view="courses" />);
    r.rerender(<Harness view="home" />);
    expect(api.getReviewPrompt).toHaveBeenCalledTimes(1);
  });

  it('다른 창이 떠 있으면 띄우지 않는다', async () => {
    api.getReviewPrompt.mockResolvedValue(true);
    const r = render(<Harness view="home" blocked />);
    await waitFor(() => expect(api.getReviewPrompt).toHaveBeenCalledTimes(1));
    r.rerender(<Harness view="chat" blocked />);
    r.rerender(<Harness view="home" blocked />);
    expect(state(r)).toBe('closed');
    expect(api.markReviewPromptShown).not.toHaveBeenCalled();
  });

  it('후기를 물을 학생이 아니면(관리자·온보딩 전) 서버에 묻지도 않는다', () => {
    render(<Harness view="home" studentId={null} />);
    expect(api.getReviewPrompt).not.toHaveBeenCalled();
  });
});
