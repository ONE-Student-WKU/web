import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import useClearStaleSelection from './useClearStaleSelection.js';

function Probe({ view }) {
  useClearStaleSelection(view);
  return (
    <div>
      <p data-testid="text">{view} 화면의 글자</p>
      <input aria-label="field" />
    </div>
  );
}

function placeCaretIn(node) {
  const range = document.createRange();
  range.setStart(node, 0);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

describe('useClearStaleSelection', () => {
  it('화면이 바뀌면 글자 위에 남은 선택(커서 위치)을 지운다', () => {
    const { rerender } = render(<Probe view="home" />);
    placeCaretIn(screen.getByTestId('text').firstChild);
    expect(window.getSelection().rangeCount).toBe(1);

    rerender(<Probe view="chat" />);
    expect(window.getSelection().rangeCount).toBe(0);
  });

  it('화면이 그대로면 선택을 건드리지 않는다', () => {
    const { rerender } = render(<Probe view="home" />);
    placeCaretIn(screen.getByTestId('text').firstChild);

    rerender(<Probe view="home" />);
    expect(window.getSelection().rangeCount).toBe(1);
  });

  it('입력 칸에 포커스가 있으면 화면이 바뀌어도 선택을 지우지 않는다', () => {
    const { rerender } = render(<Probe view="home" />);
    screen.getByLabelText('field').focus();
    placeCaretIn(screen.getByTestId('text').firstChild);

    rerender(<Probe view="chat" />);
    expect(screen.getByLabelText('field')).toHaveFocus();
    expect(window.getSelection().rangeCount).toBe(1);
  });
});
