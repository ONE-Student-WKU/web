import { useLayoutEffect } from 'react';
import { isTextEntryElement } from './useTextInputFocused.js';

/**
 * 화면(resetKey)이 바뀔 때 글자 위에 남아 있던 선택/커서 위치를 지운다.
 * 일반 글자를 클릭하면 브라우저가 그 자리에 보이지 않는 커서(빈 선택 영역)를 두는데, 화면 전환으로 그 글자가 DOM에서 사라지면
 * 선택이 새 화면의 엉뚱한 자리로 옮겨 가 — 커서 표시가 켜진 브라우저(캐럿 브라우징 등)에서는 깜빡이는 커서가 허공에 남는다.
 * 글자 입력 칸에 포커스가 있으면(화면이 입력 칸에 자동 포커스한 경우 등) 그 칸의 커서는 건드리지 않는다.
 * 페인트 전에 지우려고 useLayoutEffect를 쓴다.
 */
export default function useClearStaleSelection(resetKey) {
  useLayoutEffect(() => {
    if (isTextEntryElement(document.activeElement)) return;
    window.getSelection?.()?.removeAllRanges();
  }, [resetKey]);
}
