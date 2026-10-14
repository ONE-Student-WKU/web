import React, { useEffect, useRef, useState } from 'react';
import { IconChevronLeft, IconSearch, IconX } from './icons.jsx';
import { closeSearchScreen } from './searchScreenHistory.js';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * SearchScreen
 * 검색할 때 앱 프레임 전체(하단 탭바 포함)를 덮는 검색 전용 화면 — 위에 뒤로가기 + 검색창, 아래에 결과만 보여줘서
 * 검색에 집중하게 한다. 열리면 검색창에 바로 포커스가 간다(키보드가 올라옴).
 * 모바일 뒤로가기(제스처/버튼)가 앱을 떠나지 않고 이 화면만 닫도록 열릴 때 히스토리를 한 칸 쌓는다
 * (App.jsx·Community.jsx의 화면 히스토리 관리와 같은 방식 — state의 searchScreen 표시로 구분).
 *
 * Props:
 * - search: useSearchInput()의 반환값 — 입력 상태·한글 조합 처리
 * - onClose: function — 화면이 닫힐 때(뒤로가기 버튼, 시스템 뒤로가기) 호출. 부모는 이 화면을 렌더하지 않으면 된다.
 *   부모가 스스로 닫을 때는 closeSearchScreen()을 부르면 같은 경로(히스토리 한 칸 되돌리기 → onClose)를 탄다.
 * - placeholder / ariaLabel: string
 * - onSubmit: (value) => void (선택) — 엔터(모바일 키보드의 "검색")를 눌렀을 때 입력 칸의 지금 값으로 불린다(학과 검색: 맨 위 결과 바로 선택).
 * - hidden: boolean (선택) — 닫지 않고 잠깐 숨긴다(검색 결과에서 글 상세로 갔다가 돌아오면 검색 결과가 그대로 남아 있게)
 *
 * 열릴 때는 오른쪽에서 슬라이드해 들어온다(화면이 갑자기 바뀌는 느낌 방지). 숨겼다가 다시 보일 때는 슬라이드가 다시 재생되지
 * 않도록, 슬라이드 클래스는 처음 한 번만 붙였다가 애니메이션이 끝나면 뗀다.
 * - children: 결과 영역
 */
function SearchScreen({ search, onClose, placeholder, ariaLabel, onSubmit, hidden = false, children }) {
  const { t } = useI18n();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closedByBackRef = useRef(false);
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    window.history.pushState({ ...window.history.state, searchScreen: true }, '');
    const handlePopState = (event) => {
      if (event.state?.searchScreen) return; // 위에 쌓인 다른 화면(글 상세 등)이 닫힌 것 — 이 화면은 그대로 둔다
      closedByBackRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      // 뒤로가기가 아니라 부모가 그냥 렌더를 멈춘 경우(글 삭제 후 목록으로 등)에도 현재 칸의 표시를 지워, 이후에 쌓이는
      // 히스토리가 검색 화면이 열려 있다고 오해되지 않게 한다. 칸 자체는 남는다(다른 화면들도 같은 방식).
      if (!closedByBackRef.current && window.history.state?.searchScreen) {
        const { searchScreen: _removed, ...rest } = window.history.state; // eslint-disable-line no-unused-vars
        window.history.replaceState(rest, '');
      }
    };
  }, []);

  useEffect(() => {
    search.focus();
    // 처음 열릴 때만 포커스한다 — 숨겼다가 다시 보일 때 키보드가 갑자기 뜨지 않게.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    if (window.history.state?.searchScreen) closeSearchScreen(); // popstate 핸들러가 onClose를 부른다
    else onCloseRef.current();
  };

  return (
    <div
      className={entering ? 'search-screen search-screen--enter' : 'search-screen'}
      onAnimationEnd={(e) => e.target === e.currentTarget && setEntering(false)} // 안쪽 요소의 애니메이션 끝은 무시
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      hidden={hidden}
    >
      <div className="search-screen-bar">
        <button type="button" className="search-screen-back" onClick={handleClose} aria-label={t('search.close')}>
          <IconChevronLeft />
        </button>
        <div className="search-screen-field">
          <IconSearch />
          <input
            {...search.inputProps}
            type="text"
            role="searchbox"
            enterKeyHint="search"
            placeholder={placeholder}
            aria-label={ariaLabel}
            autoComplete="off"
            onKeyDown={(e) => {
              // 한글 조합 중 엔터는 조합을 끝내는 키로도 들어와 브라우저에 따라 두 번 불린다 — 조합 중인 것은 건너뛰어 한 번만 처리한다.
              if (onSubmit && e.key === 'Enter' && !e.nativeEvent.isComposing) onSubmit(e.currentTarget.value);
            }}
          />
          {search.value && (
            <button
              type="button"
              className="search-screen-clear"
              // 지우기를 눌러도 입력 칸이 포커스를 잃지 않게(키보드가 내려가지 않게) 한다.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                search.reset();
                search.inputProps.onChange({ target: { value: '' } });
                search.focus();
              }}
              aria-label={t('search.clear')}
            >
              <IconX size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="search-screen-body">{children}</div>
    </div>
  );
}

export default SearchScreen;
