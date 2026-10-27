import React, { useState } from 'react';
import { acknowledgeWarning } from '../api/chatApi.js';
import { useI18n } from '../i18n/I18nContext.jsx';

function formatDate(value) {
  const d = new Date(value);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * WarningNotice
 * 관리자가 보낸 경고(약관 6항)를 다음 접속 때 한 번 보여주는 팝업. 기능은 막지 않고, [확인]을 누르면 기록하고 닫힌다.
 * 아직 확인하지 않은 경고가 더 있으면 서버가 다음 것을 돌려줘서 이어서 보여준다. 사유는 관리자가 쓴 글이라 번역하지 않는다.
 * 경고는 기능을 막지 않으니 이의는 문의하기로 받는다(정지 중 이의는 SuspendedGate.jsx의 이의 제기 칸).
 *
 * Props:
 * - warning: { id, reason, createdAt }
 * - onDone: function(nextWarning | null) — 확인 뒤 다음 경고(없으면 null)
 */
function WarningNotice({ warning, onDone }) {
  const { t } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      onDone(await acknowledgeWarning(warning.id));
    } catch {
      setError(t('warning.err.ack'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="career-confirm-overlay">
      <div className="career-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="warning-notice-title">
        <p className="admin-post-title" id="warning-notice-title">
          {t('warning.title')}
        </p>
        <p className="settings-help">{t('warning.body')}</p>
        <dl className="post-facts">
          <div className="post-fact post-fact--wide">
            <dt>{t('warning.reason')}</dt>
            <dd>{warning.reason}</dd>
          </div>
          <div className="post-fact post-fact--wide">
            <dt>{t('warning.date')}</dt>
            <dd>{formatDate(warning.createdAt)}</dd>
          </div>
        </dl>
        <p className="settings-help">{t('warning.appeal')}</p>
        {error && <p className="home-error">{error}</p>}
        <button type="button" className="auth-submit-btn" onClick={handleConfirm} disabled={submitting}>
          {t('warning.confirm')}
        </button>
      </div>
    </div>
  );
}

export default WarningNotice;
