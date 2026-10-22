import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import useClearClickCaret from './useClearClickCaret.js';

function Probe() {
  useClearClickCaret();
  return (
    <div>
      <p data-testid="text">바뀌지 않는 안내 글자</p>
      <input aria-label="field" defaultValue="입력한 글" />
    </div>
  );
}

function select(node, start, end = start) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

// 브라우저는 선택이 바뀌어도 지우지 않고, 클릭(포인터)을 뗀 뒤 한 박자 뒤에 확인한다.
const release = () => fireEvent.pointerUp(document);

describe('useClearClickCaret', () => {
  it('글자를 클릭해 생긴 커서(접힌 선택)는 손을 뗀 뒤 지운다', async () => {
    render(<Probe />);
    select(screen.getByTestId('text').firstChild, 3);
    expect(window.getSelection().rangeCount).toBe(1);
    release();
    await waitFor(() => expect(window.getSelection().rangeCount).toBe(0));
  });

  it('드래그로 고른 글자(범위)는 복사할 수 있게 그대로 둔다', async () => {
    render(<Probe />);
    select(screen.getByTestId('text').firstChild, 0, 4);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(window.getSelection().toString()).toBe('바뀌지 ');
  });

  it('입력 칸에 포커스가 있으면 커서를 건드리지 않는다', async () => {
    render(<Probe />);
    screen.getByLabelText('field').focus();
    select(screen.getByTestId('text').firstChild, 2);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(window.getSelection().rangeCount).toBe(1);
  });

  it('손을 떼기 전(누르고 드래그하는 동안)에는 지우지 않는다', async () => {
    render(<Probe />);
    select(screen.getByTestId('text').firstChild, 1);
    fireEvent.pointerDown(document);
    await new Promise((r) => setTimeout(r, 10));
    expect(window.getSelection().rangeCount).toBe(1);
  });
});
