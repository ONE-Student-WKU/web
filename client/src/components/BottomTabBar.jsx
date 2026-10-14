import React from 'react';
import { IconHome, IconChecklist, IconMessageCircle, IconCompass, IconUsers, IconBook, IconHelpCircle } from './icons.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import { TAB_LABEL_KEYS } from '../utils/homeLayout.js';

// 고를 수 있는 기능별 아이콘(utils/homeLayout.js의 TAB_OPTIONS와 같은 이름). 홈 바로가기·편집 화면도 같이 쓴다.
// eslint-disable-next-line react-refresh/only-export-components -- 다른 화면이 재사용하는 아이콘 표라 컴포넌트와 같이 export함.
export const TAB_ICONS = {
  courses: IconBook,
  graduation: IconChecklist,
  career: IconCompass,
  community: IconUsers,
  inquiry: IconHelpCircle,
};

/**
 * BottomTabBar Component
 * 앱 전체 화면 하단에 고정되는 5개 아이콘 탭바 — [홈, 칸1, 챗봇(중앙 강조), 칸2, 칸3].
 * 홈과 챗봇은 고정이고, 나머지 3칸은 사용자가 홈 화면 편집에서 고른다(utils/homeLayout.js, 기본: 졸업요건·진로·커뮤니티).
 *
 * Props:
 * - tabs: [칸1, 칸2, 칸3] — 'courses' | 'graduation' | 'career' | 'community' | 'inquiry'
 * - active: 활성 화면 이름(홈·챗봇·tabs 중 하나) 또는 null
 * - onOpen: function(view)
 * - communityBadge: boolean (선택) — 커뮤니티 칸에 확인하지 않은 신고 처리 결과가 있으면 작은 점을 보여준다(어느 칸에 있든).
 */
function BottomTabBar({ tabs, active, onOpen, communityBadge = false }) {
  const { t } = useI18n();

  const tabButton = (view) => {
    const Icon = TAB_ICONS[view];
    const badge = view === 'community' && communityBadge;
    return (
      <button
        key={view}
        type="button"
        className={active === view ? 'bottom-tab active' : 'bottom-tab'}
        onClick={() => onOpen(view)}
        aria-label={badge ? t('nav.communityBadge') : t(TAB_LABEL_KEYS[view])}
        aria-current={active === view ? 'page' : undefined}
      >
        <Icon size={21} />
        {badge && <span className="bottom-tab-dot" aria-hidden="true" />}
      </button>
    );
  };

  return (
    <nav className="bottom-tab-bar" aria-label={t('nav.aria')}>
      <button
        type="button"
        className={active === 'home' ? 'bottom-tab active' : 'bottom-tab'}
        onClick={() => onOpen('home')}
        aria-label={t('nav.home')}
        aria-current={active === 'home' ? 'page' : undefined}
      >
        <IconHome size={21} />
      </button>
      {tabButton(tabs[0])}
      <button
        type="button"
        className={active === 'chat' ? 'bottom-tab-chat active' : 'bottom-tab-chat'}
        onClick={() => onOpen('chat')}
        aria-label={t('nav.chat')}
        aria-current={active === 'chat' ? 'page' : undefined}
      >
        <IconMessageCircle size={20} />
      </button>
      {tabButton(tabs[1])}
      {tabButton(tabs[2])}
    </nav>
  );
}

export default BottomTabBar;
