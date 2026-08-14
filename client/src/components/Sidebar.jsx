import React from 'react';
import { IconUser } from './icons.jsx';

/**
 * Sidebar Component
 * Compact top bar for the Chat screen (mobile-frame layout — no room for a side column).
 *
 * Props:
 * - user: object
 * - onLogout: function
 * - onGoHome: function
 */
function Sidebar({ user, onLogout, onGoHome }) {
  return (
    <header className="screen-header">
      <div className="screen-header-left">
        {onGoHome && (
          <button className="back-btn" onClick={onGoHome} aria-label="홈으로">
            ‹
          </button>
        )}
        <span className="screen-title">ONE Student</span>
      </div>
      <button className="avatar-btn" onClick={onLogout} title={user?.name ? `${user.name} · 로그아웃` : '로그아웃'}>
        <IconUser />
      </button>
    </header>
  );
}

export default Sidebar;
