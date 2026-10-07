import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import ko from './locales/ko.js';
import en from './locales/en.js';

/**
 * client/src/i18n/I18nContext.jsx
 * 외부 라이브러리 없이 만든 가벼운 다국어 지원 — 언어 상태(localStorage에 저장) + t() 번역 함수.
 *
 * 번역 키가 선택한 언어에 아직 없으면 한국어(원본)로, 한국어에도 없으면 키 자체를 보여준다 —
 * 화면별로 단계적으로 번역을 늘려가는 중이라, 아직 번역 안 된 화면이 빈 칸이 되지 않게 하려는 장치.
 * 새 언어는 locales/<code>.js를 추가하고 SUPPORTED_LANGUAGES에 한 줄 넣으면 된다.
 */

const DEFAULT_LANGUAGE = 'ko';
const STORAGE_KEY = 'language';

// label은 항상 그 언어 자신의 표기로 — UI 언어가 뭐든 사용자가 자기 언어를 알아볼 수 있어야 한다.
// eslint-disable-next-line react-refresh/only-export-components -- 설정 화면이 목록을 그리는 데 쓰는 상수라 Provider와 같은 파일에 둔다.
export const SUPPORTED_LANGUAGES = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
];

const DICTIONARIES = { ko, en };

function isSupported(code) {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

// 브라우저에 저장된 선택. 저장된 적이 없으면 null(= 사용자가 아직 고른 적 없음).
function readStoredLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isSupported(stored) ? stored : null;
  } catch {
    return null;
  }
}

// 로그인 화면에서 방금 고른 언어 표시 — 로그인하면 계정에 저장된 언어보다 이 선택을 우선해서 계정에 반영한다.
// Google 로그인은 전체 페이지 리다이렉트라 React 상태가 사라지므로 같은 탭에서 살아남는 sessionStorage에 둔다.
const PENDING_KEY = 'language_chosen_before_login';

// eslint-disable-next-line react-refresh/only-export-components -- 로그인 화면 전환기(LanguageSwitcher)가 쓰는 헬퍼라 Provider와 같은 파일에 둔다.
export function markLanguageChosenBeforeLogin(code) {
  try {
    sessionStorage.setItem(PENDING_KEY, code);
  } catch {
    // 저장소를 못 쓰는 환경 — 로그인 후에는 계정에 저장된 언어를 따른다.
  }
}

// 읽으면서 지운다(한 번만 반영). 지원하지 않는 값이거나 없으면 null.
// eslint-disable-next-line react-refresh/only-export-components -- App.jsx가 로그인 직후 한 번 읽는 헬퍼라 Provider와 같은 파일에 둔다.
export function consumeLanguageChosenBeforeLogin() {
  try {
    const value = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return isSupported(value) ? value : null;
  } catch {
    return null;
  }
}

// "{name}" 자리표시자를 params 값으로 치환. 값이 없으면 자리표시자를 그대로 둔다(누락을 눈에 띄게).
function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
}

// eslint-disable-next-line react-refresh/only-export-components -- 컴포넌트 밖(utils/graduation.js)에서도 쓰는 순수 함수라 같은 파일에 둔다.
export function translate(lang, key, params) {
  const template = DICTIONARIES[lang]?.[key] ?? DICTIONARIES[DEFAULT_LANGUAGE][key] ?? key;
  return interpolate(template, params);
}

// 문구 안의 <b>강조</b>를 <strong>으로 바꿔 React 요소로 돌려준다 — 안내문 중간에 굵은 글씨가 끼는 문장을
// 어순이 다른 언어에서도 한 문장 단위로 번역할 수 있게 하려는 용도. 그 외 HTML은 해석하지 않고 글자 그대로
// 둔다(React 요소로만 만들어 HTML을 직접 주입하지 않는다 — XSS 안전).
function renderRich(text) {
  return text
    .split(/(<b>.*?<\/b>)/g)
    .filter(Boolean)
    .map((part, i) =>
      part.startsWith('<b>') && part.endsWith('</b>') ? (
        <strong key={i}>{part.slice(3, -4)}</strong>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      )
    );
}

// Provider 없이 렌더되는 곳(단위 테스트 등)에서도 한국어로 그대로 동작하도록 기본값을 둔다.
const I18nContext = createContext({
  lang: DEFAULT_LANGUAGE,
  languageChosen: false,
  setLang: () => {},
  t: (key, params) => translate(DEFAULT_LANGUAGE, key, params),
  tRich: (key, params) => renderRich(translate(DEFAULT_LANGUAGE, key, params)),
});

export function LanguageProvider({ children }) {
  const [storedLang] = useState(readStoredLanguage);
  const [lang, setLangState] = useState(storedLang || DEFAULT_LANGUAGE);
  // 사용자가 직접 고른(또는 계정에서 받아온) 적이 있는지 — 기본값(한국어)과 구분해야, 고른 적 없는 브라우저의
  // 기본값이 계정에 저장된 언어를 덮어쓰거나 계정에 기본값이 저장되는 일이 없다.
  const [languageChosen, setLanguageChosen] = useState(storedLang !== null);

  useEffect(() => {
    document.documentElement.lang = lang;
    // 고른 적 없는 기본값은 저장하지 않는다 — 저장하면 다음 방문에 "고른 값"으로 읽혀 계정 언어와 헷갈린다.
    if (!languageChosen) return;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // 저장소를 못 쓰는 환경(사생활 보호 모드 등) — 이번 방문 동안만 유지된다.
    }
  }, [lang, languageChosen]);

  const setLang = useCallback((code) => {
    if (isSupported(code)) {
      setLangState(code);
      setLanguageChosen(true);
    }
  }, []);

  const t = useCallback((key, params) => translate(lang, key, params), [lang]);
  const tRich = useCallback((key, params) => renderRich(translate(lang, key, params)), [lang]);

  const value = useMemo(() => ({ lang, languageChosen, setLang, t, tRich }), [lang, languageChosen, setLang, t, tRich]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- Provider와 짝을 이루는 훅이라 의도적으로 같은 파일에 둔다.
export function useI18n() {
  return useContext(I18nContext);
}
