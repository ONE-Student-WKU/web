import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';

const NUDGE_MS = 1800;

/**
 * ConsentCheckbox Component
 * 이용약관·개인정보 수집·이용 동의 체크 — 로그인 폼(Login.jsx)과 로그인 직후 동의 화면(ConsentGate.jsx)이 같이 쓴다.
 * 문구 안의 {terms}/{privacy} 자리에 약관·방침으로 가는 링크 버튼이 들어간다(언어마다 어순이 달라 문장 단위로 번역).
 *
 * Props:
 * - checked: boolean
 * - onChange: function(boolean)
 * - onOpenTerms / onOpenPrivacy: function — 이용약관/개인정보처리방침 화면으로 이동
 * - nudgeKey: number (선택) — 값이 바뀔 때마다(동의 안 한 채 로그인 버튼 등을 눌렀을 때) 이 체크를 눈에 띄게 강조한다.
 *   0이면 강조하지 않는다. 연속으로 눌러도 매번 애니메이션이 다시 시작되도록 숫자의 홀짝으로 애니메이션 이름을 번갈아 쓴다.
 * - nudgeFocus: boolean (선택) — 강조할 때 체크박스로 포커스도 옮길지. 입력 칸을 누르다 강조되는 경우엔 타이핑을 끊지 않도록 false.
 */
function ConsentCheckbox({ checked, onChange, onOpenTerms, onOpenPrivacy, nudgeKey = 0, nudgeFocus = false }) {
  const { t } = useI18n();
  const parts = t('login.consent').split(/(\{terms\}|\{privacy\})/).filter(Boolean);
  const labelRef = useRef(null);
  const inputRef = useRef(null);
  const [nudging, setNudging] = useState(false);

  useEffect(() => {
    if (!nudgeKey) return undefined;
    setNudging(true);
    labelRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    if (nudgeFocus) inputRef.current?.focus({ preventScroll: true });
    const timer = setTimeout(() => setNudging(false), NUDGE_MS);
    return () => clearTimeout(timer);
  }, [nudgeKey]); // eslint-disable-line react-hooks/exhaustive-deps -- nudgeFocus는 누른 순간의 값만 쓰면 된다

  const nudgeClass = nudging && !checked ? ` auth-consent-field--nudge-${nudgeKey % 2 ? 'a' : 'b'}` : '';

  return (
    <label ref={labelRef} className={`auth-consent-field${nudgeClass}`}>
      <input ref={inputRef} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
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
