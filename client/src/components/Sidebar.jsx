import React from 'react';
import AccountMenu from './AccountMenu.jsx';
import { IconChevronLeft } from './icons.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

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
 * - onOpenProfile: function
 */
function Sidebar({ user, onLogout, onGoHome, onOpenSettings, onOpenOnboarding, onOpenProfile }) {
  const { t } = useI18n();
  return (
    <header className="screen-header">
      <div className="screen-header-left">
        {onGoHome && (
          <button className="back-btn" onClick={onGoHome} aria-label={t('common.backHome')}>
            <IconChevronLeft />
          </button>
        )}
        <span className="screen-title">ONE Student</span>
      </div>
      <AccountMenu
        user={user}
        onLogout={onLogout}
        onOpenSettings={onOpenSettings}
        onOpenOnboarding={onOpenOnboarding}
        onOpenProfile={onOpenProfile}
      />
    </header>
  );
}

export default Sidebar;
