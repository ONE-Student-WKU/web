import { useEffect } from 'react';
import { isTextEntryElement } from './useTextInputFocused.js';

/**
 * 입력 칸 밖에서 클릭(탭)으로 생긴 커서 위치를 지운다.
 * 글자나 빈 배경을 클릭하면 브라우저가 가장 가까운 글자 사이에 보이지 않는 커서(접힌 선택 영역)를 두는데, 커서를 그리는
 * 설정(캐럿 브라우징 등)이 켜진 브라우저에서는 바뀌지 않는 글자 위에서 커서가 깜빡여 입력해야 하는 칸처럼 보였다(2026-10-22 피드백).
 * - 누를 때가 아니라 뗀 뒤에 지운다 — 누르는 순간 지우면 드래그로 글자를 고르는 동작이 끊길 수 있다.
 * - 커서 한 점(접힌 선택)만 지운다. 드래그·더블클릭으로 고른 글자(범위)는 복사할 수 있게 그대로 둔다.
 * - 입력 칸(input·textarea·contentEditable)에 포커스가 있으면 그 칸의 커서는 건드리지 않는다.
 * 화면이 바뀔 때 남은 커서를 지우는 useClearStaleSelection과 짝이다.
 */
export default function useClearClickCaret() {
  useEffect(() => {
    let timer = null;
    const clearCaret = () => {
      const selection = window.getSelection?.();
      if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return;
      if (isTextEntryElement(document.activeElement)) return;
      selection.removeAllRanges();
    };
    // 브라우저가 클릭을 마무리하며 선택을 고치는 경우가 있어(이미 고른 글자 안을 클릭하면 뗄 때 접힌다) 한 박자 뒤에 본다.
    const handlePointerUp = () => {
      clearTimeout(timer);
      timer = setTimeout(clearCaret, 0);
    };
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);
}
