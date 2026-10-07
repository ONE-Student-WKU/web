import React from 'react';
import { IconChevronLeft } from '../components/icons.jsx';
import { SUPPORTED_LANGUAGES, useI18n } from '../i18n/I18nContext.jsx';

const FONT_SIZE_VALUES = ['small', 'medium', 'large'];

/**
 * Settings Page
 * 다크/라이트 테마, 기본 글자 크기, 화면 언어 선택.
 * 언어는 테마·글자 크기와 달리 App이 아니라 LanguageProvider(i18n/I18nContext.jsx)가 들고 있어서 props로 받지 않는다.
 *
 * Props:
 * - theme: 'dark' | 'light'
 * - onSetTheme: function
 * - fontSize: 'small' | 'medium' | 'large'
 * - onSetFontSize: function
 * - onGoHome: function
 * - onLanguageChange: function(code) — 선택 사항, 언어를 바꾼 뒤 호출된다(App이 계정에 저장하는 데 씀).
 */
function Settings({ theme, onSetTheme, fontSize, onSetFontSize, onGoHome, onLanguageChange }) {
  const { t, lang, setLang } = useI18n();

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label={t('common.backHome')}>
            <IconChevronLeft />
          </button>
          <span className="screen-title">{t('settings.title')}</span>
        </div>
      </header>

      <div className="courses-body">
        <section className="home-card">
          <p className="home-card-label">{t('settings.theme')}</p>
          <div className="settings-theme-options">
            <button
              className={theme === 'dark' ? 'settings-theme-btn active' : 'settings-theme-btn'}
              onClick={() => onSetTheme('dark')}
            >
              {t('settings.theme.dark')}
            </button>
            <button
              className={theme === 'light' ? 'settings-theme-btn active' : 'settings-theme-btn'}
              onClick={() => onSetTheme('light')}
            >
              {t('settings.theme.light')}
            </button>
          </div>
        </section>

        <section className="home-card">
          <p className="home-card-label">{t('settings.fontSize')}</p>
          <div className="settings-theme-options">
            {FONT_SIZE_VALUES.map((value) => (
              <button
                key={value}
                className={fontSize === value ? 'settings-theme-btn active' : 'settings-theme-btn'}
                onClick={() => onSetFontSize(value)}
              >
                {t(`settings.fontSize.${value}`)}
              </button>
            ))}
          </div>
        </section>

        <section className="home-card">
          <p className="home-card-label">{t('settings.language')}</p>
          <div className="settings-theme-options">
            {SUPPORTED_LANGUAGES.map((option) => (
              <button
                key={option.code}
                className={lang === option.code ? 'settings-theme-btn active' : 'settings-theme-btn'}
                onClick={() => {
                  setLang(option.code);
                  onLanguageChange?.(option.code);
                }}
                lang={option.code}
                aria-pressed={lang === option.code}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="settings-note">{t('settings.language.note')}</p>
        </section>
      </div>
    </div>
  );
}

export default Settings;
