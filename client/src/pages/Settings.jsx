import React from 'react';

/**
 * Settings Page
 * 다크/라이트 테마 선택.
 *
 * Props:
 * - theme: 'dark' | 'light'
 * - onSetTheme: function
 * - onGoHome: function
 */
function Settings({ theme, onSetTheme, onGoHome }) {
  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label="홈으로">
            ‹
          </button>
          <span className="screen-title">설정</span>
        </div>
      </header>

      <div className="courses-body">
        <section className="home-card">
          <p className="home-card-label">테마</p>
          <div className="settings-theme-options">
            <button
              className={theme === 'dark' ? 'settings-theme-btn active' : 'settings-theme-btn'}
              onClick={() => onSetTheme('dark')}
            >
              다크
            </button>
            <button
              className={theme === 'light' ? 'settings-theme-btn active' : 'settings-theme-btn'}
              onClick={() => onSetTheme('light')}
            >
              라이트
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Settings;
