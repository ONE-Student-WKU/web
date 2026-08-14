import React from 'react';
import AccountMenu from './AccountMenu.jsx';

/**
 * Sidebar Component
 * Compact top bar for the Chat screen (mobile-frame layout — no room for a side column).
 *
 * Props:
 * - user: object
 * - onLogout: function
 * - onGoHome: function
 * - onOpenSettings: function
 * - onOpenOnboarding: function
 */
function Sidebar({ user, onLogout, onGoHome, onOpenSettings, onOpenOnboarding }) {
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
      <AccountMenu
        user={user}
        onLogout={onLogout}
        onOpenSettings={onOpenSettings}
        onOpenOnboarding={onOpenOnboarding}
      />
    </header>
  );
}

export default Sidebar;
