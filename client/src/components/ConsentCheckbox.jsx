import React from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * ConsentCheckbox Component
 * 이용약관·개인정보 수집·이용 동의 체크 — 로그인 폼(Login.jsx)과 로그인 직후 동의 화면(ConsentGate.jsx)이 같이 쓴다.
 * 문구 안의 {terms}/{privacy} 자리에 약관·방침으로 가는 링크 버튼이 들어간다(언어마다 어순이 달라 문장 단위로 번역).
 *
 * Props:
 * - checked: boolean
 * - onChange: function(boolean)
 * - onOpenTerms / onOpenPrivacy: function — 이용약관/개인정보처리방침 화면으로 이동
 */
function ConsentCheckbox({ checked, onChange, onOpenTerms, onOpenPrivacy }) {
  const { t } = useI18n();
  const parts = t('login.consent').split(/(\{terms\}|\{privacy\})/).filter(Boolean);

  return (
    <label className="auth-consent-field">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {parts.map((part, i) => {
          if (part === '{terms}') {
            return (
              <button key={i} type="button" className="auth-toggle-link auth-consent-link" onClick={onOpenTerms}>
                {t('login.terms')}
              </button>
            );
          }
          if (part === '{privacy}') {
            return (
              <button key={i} type="button" className="auth-toggle-link auth-consent-link" onClick={onOpenPrivacy}>
                {t('login.privacy')}
              </button>
            );
          }
          return <React.Fragment key={i}>{part}</React.Fragment>;
        })}
      </span>
    </label>
  );
}

export default ConsentCheckbox;
