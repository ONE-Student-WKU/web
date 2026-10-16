import React, { useRef } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import useChatAutoScroll from './useChatAutoScroll.js';

/**
 * jsdom은 레이아웃을 계산하지 않으므로 스크롤 높이와 말풍선 위치를 직접 정해 둔다.
 * 목록: 높이 600, 내용 높이 SCROLL_HEIGHT, 화면 위쪽 100. 마지막 답 말풍선의 화면 위치는 ANSWER_TOP.
 */
let SCROLL_HEIGHT = 2000;
let ANSWER_TOP = 900;
let resizeCallbacks = [];
const OriginalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  SCROLL_HEIGHT = 2000;
  ANSWER_TOP = 900;
  resizeCallbacks = [];
  globalThis.ResizeObserver = class {
    constructor(cb) {
      resizeCallbacks.push(cb);
    }
    observe() {}
    disconnect() {}
  };
});

afterEach(() => {
  globalThis.ResizeObserver = OriginalResizeObserver;
});

function List({ messages, waiting, enabled = true }) {
  const ref = useRef(null);
  useChatAutoScroll(ref, {
    count: messages.length,
    lastSender: messages[messages.length - 1]?.sender,
    waiting,
    enabled,
  });
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el && !el.dataset.mocked) {
          el.dataset.mocked = '1';
          Object.defineProperty(el, 'scrollHeight', { get: () => SCROLL_HEIGHT });
          el.getBoundingClientRect = () => ({ top: 100 });
        }
      }}
      data-testid="list"
    >
      {messages.map((m, i) => (
        <div
          key={i}
          className={`chat-bubble ${m.sender}`}
          ref={(el) => {
            if (el) el.getBoundingClientRect = () => ({ top: ANSWER_TOP });
          }}
        />
      ))}
    </div>
  );
}

const user = { sender: 'user' };
const answer = { sender: 'assistant' };

describe('useChatAutoScroll — 챗봇·진로 대화 스크롤(UX 점검 2-1·2-2)', () => {
  it('처음 열면 맨 아래로 간다', () => {
    const { getByTestId } = render(<List messages={[user, answer]} waiting={false} />);
    expect(getByTestId('list').scrollTop).toBe(2000);
  });

  it('질문을 보내 기다리는 동안 목록 높이가 줄어도(입력창 포커스가 빠져 안내 문구가 다시 나옴) 다시 맨 아래로 붙는다', () => {
    const { getByTestId, rerender } = render(<List messages={[user, answer]} waiting={false} />);
    rerender(<List messages={[user, answer, user]} waiting />);
    const list = getByTestId('list');
    SCROLL_HEIGHT = 2100; // 기다리는 점이 붙어 내용이 길어짐
    list.scrollTop = 1900; // 목록이 줄어 아래가 가려진 상태
    act(() => resizeCallbacks.forEach((cb) => cb([])));
    expect(list.scrollTop).toBe(2100);
  });

  it('기다리는 동안 화면이 다시 그려지며 내용이 늘어도(안내 문구가 다시 나타남 등) 그리기 전에 맨 아래로 맞춘다', () => {
    const { getByTestId, rerender } = render(<List messages={[user, answer]} waiting={false} />);
    rerender(<List messages={[user, answer, user]} waiting />);
    const list = getByTestId('list');
    SCROLL_HEIGHT = 2150;
    rerender(<List messages={[user, answer, user]} waiting />); // 메시지·기다림은 그대로, 다른 이유로 다시 그림
    expect(list.scrollTop).toBe(2150);
  });

  it('답이 오면 그 답의 첫 줄이 목록 맨 위(여백 8px)에 오게 스크롤하고, 그 뒤 크기가 바뀌어도 맨 아래로 끌어내리지 않는다', () => {
    const { getByTestId, rerender } = render(<List messages={[user, answer]} waiting={false} />);
    rerender(<List messages={[user, answer, user]} waiting />);
    const list = getByTestId('list');
    list.scrollTop = 2000;
    ANSWER_TOP = 1300; // 새 답이 목록 위쪽(100)보다 1200 아래에 그려짐
    rerender(<List messages={[user, answer, user, answer]} waiting={false} />);
    expect(list.scrollTop).toBe(2000 + 1300 - 100 - 8);
    const afterAnswer = list.scrollTop;
    act(() => resizeCallbacks.forEach((cb) => cb([])));
    expect(list.scrollTop).toBe(afterAnswer);
  });

  it('답을 읽는 중에 다음 질문을 보내면 다시 맨 아래를 붙잡는다', () => {
    const { getByTestId, rerender } = render(<List messages={[user]} waiting />);
    ANSWER_TOP = 1300;
    rerender(<List messages={[user, answer]} waiting={false} />);
    const list = getByTestId('list');
    expect(list.scrollTop).toBe(2000 + 1300 - 100 - 8);
    SCROLL_HEIGHT = 2300;
    rerender(<List messages={[user, answer, user]} waiting />);
    expect(list.scrollTop).toBe(2300);
    SCROLL_HEIGHT = 2400;
    act(() => resizeCallbacks.forEach((cb) => cb([])));
    expect(list.scrollTop).toBe(2400);
  });

  it('enabled가 false면(진로 탐색의 후보·로드맵 화면) 움직이지 않는다', () => {
    const { getByTestId } = render(<List messages={[user, answer]} waiting={false} enabled={false} />);
    const list = getByTestId('list');
    expect(list.scrollTop).toBe(0);
    act(() => resizeCallbacks.forEach((cb) => cb([])));
    expect(list.scrollTop).toBe(0);
  });
});
