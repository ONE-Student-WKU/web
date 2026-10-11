import { useRef, useState } from 'react';

/**
 * 검색 입력 칸의 상태와 한글 조합 처리를 한곳에 모은 훅 — 과목 카탈로그 검색과 커뮤니티 글 검색이 같이 쓴다.
 * 한글은 자음+모음이 조합돼야 완성된 글자가 되는데("데" = ㄷ+ㅔ), 조합 중간의 낱자("빅ㄷ")로 바로 검색하면
 * 실제 글에 없는 형태라 빈 결과가 나와 목록이 깜빡인다. 조합 중에는 onSearch를 보류하고 글자가 완성되는 순간
 * (compositionend)에만 부른다. 그래서 onSearch에는 디바운스가 필요 없다.
 *
 * onSearch(value)는 입력이 바뀔 때마다(조합 중 제외) 비어 있는 값도 포함해 불린다 — 비었을 때 결과를 비우는 건 호출 쪽 몫.
 * 반환: { value, inputProps(<input>에 펼치기), reset(), focus() }
 */
export default function useSearchInput(onSearch) {
  const [value, setValue] = useState('');
  const composingRef = useRef(false);
  const inputRef = useRef(null);
  // 매 렌더 최신 콜백을 쓰되, inputProps의 핸들러 정체성은 신경 쓰지 않는다(입력 칸은 가볍다).
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  const inputProps = {
    ref: inputRef,
    value,
    onChange: (e) => {
      setValue(e.target.value);
      if (!composingRef.current) onSearchRef.current(e.target.value);
    },
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: (e) => {
      composingRef.current = false;
      onSearchRef.current(e.target.value);
    },
  };

  return {
    value,
    inputProps,
    reset: () => {
      composingRef.current = false;
      setValue('');
    },
    focus: () => inputRef.current?.focus(),
  };
}
