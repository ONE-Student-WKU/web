import React, { useState } from 'react';
import ConsentCheckbox from '../components/ConsentCheckbox.jsx';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { acceptConsent } from '../api/chatApi.js';
import { CONSENT_VERSION, storeConsent } from '../utils/consent.js';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * ConsentGate Page
 * 이용약관·개인정보 수집·이용 동의 기록이 없거나 옛 버전인 계정에게 로그인 직후 한 번 보여주는 화면.
 * 새 로그인은 로그인 폼의 필수 동의로 이미 기록되므로, 이 화면은 주로 폼을 거치지 않고 세션이 복원된 기존 계정이 본다.
 * 동의하지 않으면 서비스를 쓸 수 없고(나가기 = 로그아웃), 동의 전에는 다른 화면에 들어가지 못한다(App.jsx).
 *
 * Props:
 * - onAccepted: function — 동의가 서버에 기록된 뒤 호출
 * - onDecline: function — 동의하지 않고 나가기(로그아웃)
 * - onOpenPrivacy / onOpenTerms: function
 */
function ConsentGate({ onAccepted, onDecline, onOpenPrivacy, onOpenTerms }) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const handleAccept = async () => {
    setSaving(true);
    setError(false);
    try {
      await acceptConsent(CONSENT_VERSION);
      storeConsent(true);
      onAccepted();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-page">
      <header className="screen-header">
        <span className="screen-title">ONE Student</span>
        <LanguageSwitcher />
      </header>

      <div className="auth-body">
        <h2 className="auth-heading">{t('consent.title')}</h2>
        <p className="auth-subheading">{t('consent.body')}</p>

        <ConsentCheckbox checked={checked} onChange={setChecked} onOpenTerms={onOpenTerms} onOpenPrivacy={onOpenPrivacy} />

        {error && <p className="auth-error">{t('consent.err')}</p>}

        <button type="button" className="auth-submit-btn" onClick={handleAccept} disabled={!checked || saving}>
          {saving ? t('consent.saving') : t('consent.agree')}
        </button>
        <button type="button" className="auth-toggle-link auth-toggle-link--block" onClick={onDecline} disabled={saving}>
          {t('consent.decline')}
        </button>
      </div>
    </div>
  );
}

export default ConsentGate;
