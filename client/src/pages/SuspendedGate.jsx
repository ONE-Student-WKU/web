import React, { useState } from 'react';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import BrandTitle from '../components/BrandTitle.jsx';
import AccountDeleteSection from '../components/AccountDeleteSection.jsx';
import { submitAppeal } from '../api/chatApi.js';
import { useI18n } from '../i18n/I18nContext.jsx';

// 서버(server/services/appealService.js)와 같은 길이 제한.
const APPEAL_MAX_LENGTH = 2000;

// 정지가 끝나는 시각 — 날짜만 쓰면 "오늘까지"인지 헷갈려서 시:분까지 보여준다(제재는 건 시각부터 n일 뒤에 끝난다).
function formatEndsAt(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(value) {
  const d = new Date(value);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * SuspendedGate Page
 * 서비스 전체 이용 정지(#457) 중인 계정이 로그인하면 다른 화면 대신 이 화면만 본다(App.jsx — 동의 화면보다 먼저).
 * 약관 6항대로 정지 사유·기간 확인, 이의 제기, 로그아웃, 계정 삭제만 할 수 있고, 서버도 그 밖의 요청을 막는다
 * (server/middleware/accountSuspension.js). 사유·이의·운영팀 답변은 사람이 쓴 글이라 번역하지 않고 그대로 보여준다.
 *
 * 이의 제기는 정지 한 번에 1건 — 문의하기가 막혀 있어 이 화면이 유일한 서비스 안 통로다. 문의함에 들어가고, 운영팀 답변이
 * 이 화면에 보인다(server/services/appealService.js).
 *
 * Props:
 * - user: object — 계정 삭제 재인증 방식 판단용(hasGoogleAccount)
 * - suspension: { reason, endsAt, appeal } — endsAt이 null이면 영구 정지, appeal은 보낸 이의({ content, createdAt, reply }) 또는 null
 * - onLogout / onAccountDeleted: function
 * - justReauthenticated: boolean — Google 재인증 왕복 직후면 계정 삭제를 펼친 채로 보여준다
 */
function SuspendedGate({ user, suspension, onLogout, onAccountDeleted, justReauthenticated }) {
  const { t } = useI18n();
  const permanent = !suspension.endsAt;
  const [appeal, setAppeal] = useState(suspension.appeal || null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [appealError, setAppealError] = useState(null);

  async function handleAppeal(e) {
    e.preventDefault();
    if (sending || !draft.trim()) return;
    setSending(true);
    setAppealError(null);
    try {
      setAppeal(await submitAppeal(draft.trim()));
    } catch (err) {
      setAppealError(err.code === 'APPEAL_EXISTS' ? t('suspended.err.appealExists') : t('suspended.err.appeal'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="auth-page">
      <header className="screen-header">
        <BrandTitle />
        <LanguageSwitcher />
      </header>

      <div className="auth-body">
        <h2 className="auth-heading">{t('suspended.title')}</h2>
        <p className="auth-subheading">{permanent ? t('suspended.bodyPermanent') : t('suspended.body')}</p>

        <dl className="post-facts suspended-facts">
          <div className="post-fact post-fact--wide">
            <dt>{t('suspended.reason')}</dt>
            <dd>{suspension.reason}</dd>
          </div>
          <div className="post-fact post-fact--wide">
            <dt>{t('suspended.period')}</dt>
            <dd>{permanent ? t('suspended.permanent') : t('suspended.until', { date: formatEndsAt(suspension.endsAt) })}</dd>
          </div>
          {/* 보낸 이의는 같은 목록에 이어 붙인다 — 목록을 둘로 나누면 구분선이 겹쳐 보인다. */}
          {appeal && (
            <>
              <div className="post-fact post-fact--wide">
                <dt>{t('suspended.appealSent', { date: formatDate(appeal.createdAt) })}</dt>
                <dd>{appeal.content}</dd>
              </div>
              <div className="post-fact post-fact--wide">
                <dt>{t('suspended.appealReply')}</dt>
                <dd>{appeal.reply || t('suspended.appealWaiting')}</dd>
              </div>
            </>
          )}
        </dl>

        {!appeal && (
          <form className="auth-field suspended-appeal" onSubmit={handleAppeal}>
            <label htmlFor="suspension-appeal">{t('suspended.appealLabel')}</label>
            <textarea
              id="suspension-appeal"
              rows={3}
              maxLength={APPEAL_MAX_LENGTH}
              placeholder={t('suspended.appealPlaceholder')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <p className="settings-help">{t('suspended.appealHint')}</p>
            {appealError && <p className="home-error">{appealError}</p>}
            <button type="submit" className="post-btn post-btn--outline post-btn--block" disabled={sending || !draft.trim()}>
              {sending ? t('suspended.appealSending') : t('suspended.appealSend')}
            </button>
          </form>
        )}

        <button type="button" className="auth-submit-btn" onClick={onLogout}>
          {t('suspended.logout')}
        </button>
        <div className="settings-list suspended-delete">
          <AccountDeleteSection
            user={user}
            justReauthenticated={justReauthenticated}
            onAccountDeleted={onAccountDeleted}
            notice={t('suspended.deleteNotice')}
          />
        </div>
      </div>
    </div>
  );
}

export default SuspendedGate;
