import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * 채팅 목록 자동 스크롤 — 챗봇(Chat.jsx)과 진로 대화(CareerExploration.jsx)가 같이 쓴다.
 *
 * - 처음 열 때, 질문을 보내 답을 기다리는 동안: 맨 아래(내 질문과 기다리는 점)를 붙잡는다.
 *   보낸 직후 입력창이 비활성화돼 포커스가 빠지면 면책 문구·하단 바가 다시 나타나 목록 높이가 줄어드는데,
 *   그 전에 스크롤해 두면 기다리는 점이 입력창 뒤로 밀려 안 보였다(UX 점검 2026-10-16 2-1). 그래서 목록 크기가
 *   바뀔 때마다(ResizeObserver) 다시 맨 아래로 붙인다.
 * - 답이 도착하면: 그 답의 첫 줄이 목록 맨 위에 오게 한다. 긴 답을 끝부터 보여 위로 거슬러 올라가야 했다(2-2).
 *   답이 짧아 다 들어가면 브라우저가 끝까지만 스크롤하므로 결과는 맨 아래와 같다.
 *
 * containerRef: 실제로 스크롤되는 요소. 답 말풍선은 그 안의 `.chat-bubble.assistant` 중 마지막 것으로 찾는다.
 * count: 메시지 개수, lastSender: 마지막 메시지를 보낸 쪽('user' | 'assistant' | 그 밖), waiting: 답을 기다리는 중인지.
 * enabled: false면 아무것도 하지 않는다(진로 탐색의 후보·로드맵 화면처럼 같은 스크롤 영역을 다른 화면이 쓸 때).
 * 키보드가 떠서 목록이 좁아질 때도 맨 아래를 붙잡는 중이면 따라간다. 답을 읽는 중이면 읽던 위치(답의 첫 줄 기준)를 그대로 둔다.
 */
export default function useChatAutoScroll(containerRef, { count, lastSender, waiting, enabled = true }) {
  const mode = useRef('bottom'); // 'bottom' | 'answer'
  const prevCount = useRef(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // 화면을 그린 직후(그리기 전 레이아웃 기준) 위치를 정해야 끝으로 갔다가 위로 튀는 깜빡임이 없다.
  useLayoutEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;
    const answered = prevCount.current !== null && prevCount.current > 0 && count > prevCount.current;
    prevCount.current = count;
    if (answered && lastSender === 'assistant' && !waiting) {
      const answers = el.querySelectorAll('.chat-bubble.assistant');
      const answer = answers[answers.length - 1];
      if (answer) {
        mode.current = 'answer';
        el.scrollTop += answer.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
        return;
      }
    }
    mode.current = 'bottom';
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- containerRef는 바뀌지 않는 ref다
  }, [count, lastSender, waiting, enabled]);

  // 같은 화면이 다시 그려지며 높이가 바뀌는 경우(보낸 직후 입력창 포커스가 빠져 안내 문구가 다시 나타남)는 그리기 전에 바로
  // 맞춘다. ResizeObserver 알림은 브라우저가 다음에 그릴 때 오므로 그사이 한 번 덜 내려간 화면이 보일 수 있다.
  useLayoutEffect(() => {
    if (enabledRef.current && mode.current === 'bottom') scrollToBottom();
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (enabledRef.current && mode.current === 'bottom') scrollToBottom();
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 붙일 요소가 생기거나 바뀔 때만 다시 건다
  }, [containerRef.current]);
}
