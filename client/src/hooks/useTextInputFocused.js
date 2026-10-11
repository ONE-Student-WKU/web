import { useEffect, useState } from 'react';

// 키보드를 띄우는 입력 요소인지 — 체크박스·라디오·버튼·파일 선택 같은 input은 키보드가 안 뜨므로 제외.
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image', 'hidden']);

export function isTextEntryElement(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((el.getAttribute('type') || 'text').toLowerCase());
  return el.isContentEditable === true;
}

// 화면 키보드가 뜨는 환경(터치 기기, 폰 너비)에서만 쓴다 — 데스크톱에서는 입력창에 포커스가 가도 탭바를 숨길 이유가 없다.
function hasOnScreenKeyboard() {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 480px)').matches;
}

/**
 * 글자를 입력하는 칸(input/textarea)에 포커스가 가 있는 동안 true — 모바일에서 키보드가 올라온 상태.
 * 채팅·진로 탐색·커뮤니티 글쓰기·과목 검색 등 어느 화면이든 같은 기준으로 하단 탭바를 접는 데 쓴다.
 * 칸에서 칸으로 포커스가 옮겨 갈 때는 값이 깜빡이지 않도록 focusout의 relatedTarget을 본다.
 * 포커스된 칸이 화면 전환으로 통째로 사라지면 focusout이 안 오는 브라우저가 있어, resetKey(현재 화면)가
 * 바뀔 때 실제 포커스 상태로 다시 맞춘다.
 */
export default function useTextInputFocused(resetKey) {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setFocused(isTextEntryElement(document.activeElement) && hasOnScreenKeyboard());
  }, [resetKey]);

  useEffect(() => {
    const handleFocusIn = (e) => {
      if (isTextEntryElement(e.target) && hasOnScreenKeyboard()) setFocused(true);
    };
    const handleFocusOut = (e) => {
      if (isTextEntryElement(e.relatedTarget)) return;
      setFocused(false);
    };
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  return focused;
}
