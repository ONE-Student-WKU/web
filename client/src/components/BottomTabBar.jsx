import React from 'react';
import { IconHome, IconChecklist, IconMessageCircle, IconCompass, IconUsers } from './icons.jsx';

/**
 * BottomTabBar Component
 * 앱 전체 화면 하단에 고정되는 5개 아이콘 전용 탭바 — 홈/졸업요건진단/채팅(중앙 강조)/
 * 진로탐색/커뮤니티(준비 중, 비활성). 과목 관리는 탭에 없음 — Home의 메뉴 버튼과
 * 졸업요건 진단 화면의 "과목 관리로 이동" 버튼으로 이미 충분히 닿을 수 있어 제외했다.
 *
 * Props:
 * - active: 'home' | 'graduation' | 'chat' | 'career' | null
 * - onOpenHome: function
 * - onOpenGraduation: function
 * - onOpenChat: function
 * - onOpenCareer: function
 */
function BottomTabBar({ active, onOpenHome, onOpenGraduation, onOpenChat, onOpenCareer }) {
  return (
    <nav className="bottom-tab-bar" aria-label="주요 화면 이동">
      <button
        type="button"
        className={active === 'home' ? 'bottom-tab active' : 'bottom-tab'}
        onClick={onOpenHome}
        aria-label="홈"
        aria-current={active === 'home' ? 'page' : undefined}
      >
        <IconHome size={21} />
      </button>
      <button
        type="button"
        className={active === 'graduation' ? 'bottom-tab active' : 'bottom-tab'}
        onClick={onOpenGraduation}
        aria-label="졸업요건 진단"
        aria-current={active === 'graduation' ? 'page' : undefined}
      >
        <IconChecklist size={21} />
      </button>
      <button
        type="button"
        className={active === 'chat' ? 'bottom-tab-chat active' : 'bottom-tab-chat'}
        onClick={onOpenChat}
        aria-label="채팅"
        aria-current={active === 'chat' ? 'page' : undefined}
      >
        <IconMessageCircle size={20} />
      </button>
      <button
        type="button"
        className={active === 'career' ? 'bottom-tab active' : 'bottom-tab'}
        onClick={onOpenCareer}
        aria-label="진로 탐색"
        aria-current={active === 'career' ? 'page' : undefined}
      >
        <IconCompass size={21} />
      </button>
      <button type="button" className="bottom-tab bottom-tab-disabled" disabled aria-label="커뮤니티 (준비 중)">
        <IconUsers size={21} />
      </button>
    </nav>
  );
}

export default BottomTabBar;
