import React from 'react';
import { SUPPORTED_LANGUAGES, useI18n } from '../i18n/I18nContext.jsx';

/**
 * LanguageSwitcher Component
 * 화면 언어를 바꾸는 작은 전환기 — 설정 화면은 로그인해야 열 수 있어서, 로그인 전에도
 * 언어를 바꿀 수 있도록 로그인 화면 헤더에 둔다. 선택은 LanguageProvider가 저장해서
 * 설정 화면의 언어 선택과 같은 값을 공유한다.
 */
function LanguageSwitcher() {
  const { t, lang, setLang } = useI18n();

  return (
    <div className="language-switcher" role="group" aria-label={t('language.switcher')}>
      {SUPPORTED_LANGUAGES.map((option) => (
        <button
          key={option.code}
          type="button"
          lang={option.code}
          className={lang === option.code ? 'language-switcher-btn active' : 'language-switcher-btn'}
          aria-pressed={lang === option.code}
          onClick={() => setLang(option.code)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default LanguageSwitcher;
