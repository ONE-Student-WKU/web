import React from 'react';
import { IconChevronLeft, IconCheck } from '../components/icons.jsx';
import { SUPPORTED_LANGUAGES, useI18n } from '../i18n/I18nContext.jsx';

const THEME_VALUES = ['light', 'dark'];
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

      {/* 고르면 어떻게 보일지 바로 알 수 있게 — 테마는 화면 미리보기, 글자 크기는 실제 크기의 "가", 언어는 체크 목록(2026-10-22 개편). */}
      <div className="courses-body community-body">
        <div className="settings-page">
          <section className="settings-group">
            <p className="settings-group-title" id="settings-theme">
              {t('settings.theme')}
            </p>
            <div className="settings-panel">
              <div className="settings-themes" role="group" aria-labelledby="settings-theme">
                {THEME_VALUES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={theme === value ? 'settings-theme-card active' : 'settings-theme-card'}
                    aria-pressed={theme === value}
                    onClick={() => onSetTheme(value)}
                  >
                    <span className={`settings-theme-preview settings-theme-preview--${value}`} aria-hidden="true">
                      <i className="strong" />
                      <i />
                      <i />
                    </span>
                    {t(`settings.theme.${value}`)}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="settings-group">
            <p className="settings-group-title" id="settings-font">
              {t('settings.fontSize')}
            </p>
            <div className="settings-panel">
              <div className="settings-fonts" role="group" aria-labelledby="settings-font">
                {FONT_SIZE_VALUES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={fontSize === value ? 'settings-font-card active' : 'settings-font-card'}
                    aria-pressed={fontSize === value}
                    onClick={() => onSetFontSize(value)}
                  >
                    <b className={`settings-font-sample settings-font-sample--${value}`} aria-hidden="true">
                      {t('settings.fontSize.sample')}
                    </b>
                    <span>{t(`settings.fontSize.${value}`)}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="settings-group">
            <p className="settings-group-title">{t('settings.language')}</p>
            <div className="settings-list">
              {SUPPORTED_LANGUAGES.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  className="settings-row"
                  onClick={() => {
                    setLang(option.code);
                    onLanguageChange?.(option.code);
                  }}
                  lang={option.code}
                  aria-pressed={lang === option.code}
                >
                  <span>{option.label}</span>
                  {lang === option.code && (
                    <span className="settings-check">
                      <IconCheck size={11} />
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p className="settings-group-note">{t('settings.language.note')}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default Settings;
