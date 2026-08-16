import React from 'react';
import { IconChevronLeft } from '../components/icons.jsx';

const FONT_SIZE_OPTIONS = [
  { value: 'small', label: '작게' },
  { value: 'medium', label: '보통' },
  { value: 'large', label: '크게' },
];

/**
 * Settings Page
 * 다크/라이트 테마, 기본 글자 크기 선택.
 *
 * Props:
 * - theme: 'dark' | 'light'
 * - onSetTheme: function
 * - fontSize: 'small' | 'medium' | 'large'
 * - onSetFontSize: function
 * - onGoHome: function
 */
function Settings({ theme, onSetTheme, fontSize, onSetFontSize, onGoHome }) {
  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label="홈으로">
            <IconChevronLeft />
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

        <section className="home-card">
          <p className="home-card-label">글자 크기</p>
          <div className="settings-theme-options">
            {FONT_SIZE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={fontSize === option.value ? 'settings-theme-btn active' : 'settings-theme-btn'}
                onClick={() => onSetFontSize(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default Settings;
