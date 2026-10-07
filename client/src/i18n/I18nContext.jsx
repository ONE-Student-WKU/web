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

function readStoredLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isSupported(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
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
  setLang: () => {},
  t: (key, params) => translate(DEFAULT_LANGUAGE, key, params),
  tRich: (key, params) => renderRich(translate(DEFAULT_LANGUAGE, key, params)),
});

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(readStoredLanguage);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // 저장소를 못 쓰는 환경(사생활 보호 모드 등) — 이번 방문 동안만 유지된다.
    }
  }, [lang]);

  const setLang = useCallback((code) => {
    if (isSupported(code)) setLangState(code);
  }, []);

  const t = useCallback((key, params) => translate(lang, key, params), [lang]);
  const tRich = useCallback((key, params) => renderRich(translate(lang, key, params)), [lang]);

  const value = useMemo(() => ({ lang, setLang, t, tRich }), [lang, setLang, t, tRich]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- Provider와 짝을 이루는 훅이라 의도적으로 같은 파일에 둔다.
export function useI18n() {
  return useContext(I18nContext);
}
