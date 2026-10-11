import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import useTextInputFocused from './useTextInputFocused.js';

function Probe({ resetKey = 'a' }) {
  const focused = useTextInputFocused(resetKey);
  return (
    <div>
      <span data-testid="state">{focused ? 'focused' : 'idle'}</span>
      <input aria-label="text" type="text" />
      <input aria-label="second" type="search" />
      <textarea aria-label="area" />
      <input aria-label="check" type="checkbox" />
      <button type="button">btn</button>
    </div>
  );
}

function stubMedia(matches) {
  window.matchMedia = vi.fn().mockReturnValue({ matches, addEventListener: () => {}, removeEventListener: () => {} });
}

describe('useTextInputFocused', () => {
  beforeEach(() => stubMedia(true));
  afterEach(() => {
    delete window.matchMedia;
  });

  it('텍스트 입력 칸에 포커스가 가면 true, 빠지면 false', async () => {
    const user = userEvent.setup();
    render(<Probe />);
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
    await user.click(screen.getByLabelText('text'));
    expect(screen.getByTestId('state')).toHaveTextContent('focused');
    await user.click(screen.getByRole('button', { name: 'btn' }));
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
  });

  it('textarea도 입력 칸으로 본다', async () => {
    const user = userEvent.setup();
    render(<Probe />);
    await user.click(screen.getByLabelText('area'));
    expect(screen.getByTestId('state')).toHaveTextContent('focused');
  });

  it('체크박스 같은 키보드가 안 뜨는 칸은 무시한다', async () => {
    const user = userEvent.setup();
    render(<Probe />);
    await user.click(screen.getByLabelText('check'));
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
  });

  it('입력 칸에서 다른 입력 칸으로 옮겨 가는 동안 false로 깜빡이지 않는다', async () => {
    const user = userEvent.setup();
    render(<Probe />);
    await user.click(screen.getByLabelText('text'));
    const seen = [];
    const observer = new MutationObserver(() => seen.push(screen.getByTestId('state').textContent));
    observer.observe(screen.getByTestId('state'), { childList: true, characterData: true, subtree: true });
    await user.click(screen.getByLabelText('second'));
    observer.disconnect();
    expect(seen).not.toContain('idle');
    expect(screen.getByTestId('state')).toHaveTextContent('focused');
  });

  it('데스크톱(키보드가 안 뜨는 환경)에서는 포커스가 가도 false', async () => {
    stubMedia(false);
    const user = userEvent.setup();
    render(<Probe />);
    await user.click(screen.getByLabelText('text'));
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
  });

  it('포커스된 칸이 통째로 사라진 채 화면이 바뀌면 resetKey 변화로 다시 맞춘다', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Probe resetKey="a" />);
    await user.click(screen.getByLabelText('text'));
    expect(screen.getByTestId('state')).toHaveTextContent('focused');
    // focusout 없이 포커스만 사라진 상황을 흉내 — 포커스를 body로 돌리되 이벤트를 막는다.
    const blockFocusOut = (e) => e.stopImmediatePropagation();
    document.addEventListener('focusout', blockFocusOut, true);
    act(() => document.activeElement.blur());
    document.removeEventListener('focusout', blockFocusOut, true);
    expect(screen.getByTestId('state')).toHaveTextContent('focused');
    rerender(<Probe resetKey="b" />);
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
  });
});
