import React from 'react';
import { IconHome, IconChecklist, IconMessageCircle, IconCompass, IconUsers } from './icons.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * BottomTabBar Component
 * 앱 전체 화면 하단에 고정되는 5개 아이콘 전용 탭바 — 홈/졸업요건진단/채팅(중앙 강조)/
 * 진로탐색/커뮤니티. 과목 관리는 탭에 없음 — Home의 메뉴 버튼과
 * 졸업요건 진단 화면의 "과목 관리로 이동" 버튼으로 이미 충분히 닿을 수 있어 제외했다.
 *
 * Props:
 * - active: 'home' | 'graduation' | 'chat' | 'career' | 'community' | null
 * - onOpenHome: function
 * - onOpenGraduation: function
 * - onOpenChat: function
 * - onOpenCareer: function
 * - onOpenCommunity: function
 * - communityBadge: boolean (선택) — 커뮤니티에 확인하지 않은 신고 처리 결과가 있으면 아이콘 옆에 작은 점을 보여준다.
 */
function BottomTabBar({ active, onOpenHome, onOpenGraduation, onOpenChat, onOpenCareer, onOpenCommunity, communityBadge = false }) {
  const { t } = useI18n();
  return (
    <nav className="bottom-tab-bar" aria-label={t('nav.aria')}>
      <button
        type="button"
        className={active === 'home' ? 'bottom-tab active' : 'bottom-tab'}
        onClick={onOpenHome}
        aria-label={t('nav.home')}
        aria-current={active === 'home' ? 'page' : undefined}
      >
        <IconHome size={21} />
      </button>
      <button
        type="button"
        className={active === 'graduation' ? 'bottom-tab active' : 'bottom-tab'}
        onClick={onOpenGraduation}
        aria-label={t('nav.graduation')}
        aria-current={active === 'graduation' ? 'page' : undefined}
      >
        <IconChecklist size={21} />
      </button>
      <button
        type="button"
        className={active === 'chat' ? 'bottom-tab-chat active' : 'bottom-tab-chat'}
        onClick={onOpenChat}
        aria-label={t('nav.chat')}
        aria-current={active === 'chat' ? 'page' : undefined}
      >
        <IconMessageCircle size={20} />
      </button>
      <button
        type="button"
        className={active === 'career' ? 'bottom-tab active' : 'bottom-tab'}
        onClick={onOpenCareer}
        aria-label={t('nav.career')}
        aria-current={active === 'career' ? 'page' : undefined}
      >
        <IconCompass size={21} />
      </button>
      <button
        type="button"
        className={active === 'community' ? 'bottom-tab active' : 'bottom-tab'}
        onClick={onOpenCommunity}
        aria-label={communityBadge ? t('nav.communityBadge') : t('nav.community')}
        aria-current={active === 'community' ? 'page' : undefined}
      >
        <IconUsers size={21} />
        {communityBadge && <span className="bottom-tab-dot" aria-hidden="true" />}
      </button>
    </nav>
  );
}

export default BottomTabBar;
