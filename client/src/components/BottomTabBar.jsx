import React from 'react';
import { IconHome, IconChecklist, IconMessageCircle, IconCompass, IconUsers, IconBook, IconHelpCircle } from './icons.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import { TAB_LABEL_KEYS } from '../utils/homeLayout.js';

// 고를 수 있는 기능별 아이콘(utils/homeLayout.js의 TAB_OPTIONS와 같은 이름). 홈 메뉴·편집 화면도 같이 쓴다.
// eslint-disable-next-line react-refresh/only-export-components -- 다른 화면이 재사용하는 아이콘 표라 컴포넌트와 같이 export함.
export const TAB_ICONS = {
  home: IconHome,
  courses: IconBook,
  graduation: IconChecklist,
  career: IconCompass,
  community: IconUsers,
  inquiry: IconHelpCircle,
};

/**
 * BottomTabBar Component
 * 앱 전체 화면 하단에 고정되는 5개 아이콘 탭바 — [칸1, 칸2, 챗봇(중앙 강조), 칸3, 칸4].
 * 챗봇만 고정이고, 나머지 4자리는 사용자가 홈 화면 편집에서 고른다(utils/homeLayout.js, 기본: 홈·졸업요건·진로·커뮤니티).
 * 빈 자리(null)는 같은 크기의 빈 공간으로 두어 다른 아이콘의 위치가 바뀌지 않게 한다. 4자리가 모두 비면 바 배경·테두리 없이
 * 가운데 원형 챗봇 버튼만 그린다. 하단 바 전체를 끄는 설정(showTabBar)은 App.jsx가 이 컴포넌트를 그리지 않는 것으로 처리한다.
 *
 * Props:
 * - tabs: [자리1, 자리2, 자리3, 자리4] — 'home' | 'courses' | 'graduation' | 'career' | 'community' | 'inquiry' | null(빈 자리)
 * - active: 활성 화면 이름(챗봇·tabs 중 하나) 또는 null
 * - onOpen: function(view)
 * - isLocked: function(view) → boolean (선택) — 학과를 고르지 않아 쓸 수 없는 기능이면 흐리게 보인다(누르면 App이 학과 선택으로 보낸다).
 * - communityBadge: boolean (선택) — 커뮤니티 칸에 확인하지 않은 신고 처리 결과가 있으면 작은 점을 보여준다(어느 칸에 있든).
 */
function BottomTabBar({ tabs, active, onOpen, isLocked = () => false, communityBadge = false }) {
  const { t } = useI18n();

  const tabButton = (view, slot) => {
    if (!view) return <span key={`empty-${slot}`} className="bottom-tab-empty" aria-hidden="true" />;
    const Icon = TAB_ICONS[view];
    const badge = view === 'community' && communityBadge;
    const locked = isLocked(view);
    const name = badge ? t('nav.communityBadge') : t(TAB_LABEL_KEYS[view]);
    return (
      <button
        key={view}
        type="button"
        className={'bottom-tab' + (active === view ? ' active' : '') + (locked ? ' locked' : '')}
        onClick={() => onOpen(view)}
        aria-label={locked ? t('nav.locked', { name }) : name}
        aria-current={active === view ? 'page' : undefined}
      >
        <Icon size={21} />
        {badge && <span className="bottom-tab-dot" aria-hidden="true" />}
      </button>
    );
  };

  const chatOnly = tabs.every((v) => !v);

  return (
    <nav className={chatOnly ? 'bottom-tab-bar chat-only' : 'bottom-tab-bar'} aria-label={t('nav.aria')}>
      {!chatOnly && tabButton(tabs[0], 0)}
      {!chatOnly && tabButton(tabs[1], 1)}
      <button
        type="button"
        className={active === 'chat' ? 'bottom-tab-chat active' : 'bottom-tab-chat'}
        onClick={() => onOpen('chat')}
        aria-label={t('nav.chat')}
        aria-current={active === 'chat' ? 'page' : undefined}
      >
        <IconMessageCircle size={20} />
      </button>
      {!chatOnly && tabButton(tabs[2], 2)}
      {!chatOnly && tabButton(tabs[3], 3)}
    </nav>
  );
}

export default BottomTabBar;
