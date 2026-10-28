import React, { useEffect, useState } from 'react';
import { deleteAccount, startGoogleReauth, requestDeleteReauthCode, verifyDeleteReauthCode } from '../api/chatApi.js';
import { useI18n } from '../i18n/I18nContext.jsx';

// 이메일 재인증 요청/확인 실패 코드는 서버(server/routes/auth.js)가 내려주는 err.code
// 기준 — Login.jsx의 describeEmailError와 같은 코드 집합을 다루되 문구는 재인증 맥락에 맞춤.
function describeReauthError(code, t) {
  if (code === 'NOT_FOUND') return t('login.err.notFound');
  if (code === 'INVALID_CODE') return t('login.err.invalidCode');
  if (code === 'TOO_MANY_ATTEMPTS') return t('login.err.tooManyAttempts');
  return t('login.err.request');
}

// 재전송 쿨다운(server/services/emailAuthService.js:checkResendAllowed)에 걸리면 서버가
// data.retryAt(ISO 문자열)을 같이 내려준다 — Login.jsx와 동일한 규칙: 1시간 이상 남으면
// h:mm:ss, 아니면 mm:ss.
function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/**
 * AccountDeleteSection
 * 계정 삭제 줄(누르면 펼쳐져 재인증 → 삭제). 프로필 화면과 이용 정지 화면(SuspendedGate.jsx)이 같이 쓴다 —
 * 정지 중에도 계정 삭제는 할 수 있어야 해서(약관 6항) 같은 절차를 그대로 연다. 감싸는 .settings-list는 호출부가 둔다.
 *
 * Props:
 * - user: object — hasGoogleAccount로 재인증 방식(Google 왕복 / 이메일 코드)을 고른다
 * - justReauthenticated: boolean — Google 재인증 왕복 직후(App.jsx가 ?reauth=1 쿼리로 판단)인지.
 *   서버의 재인증 유효 시간(5분)과 별개로, 새로고침하면 다시 false가 되는 프론트 전용 플래그라
 *   실제 삭제 시점엔 서버가 다시 한번 유효성을 검사한다(REAUTH_REQUIRED).
 * - onAccountDeleted: function — 삭제 성공 시(서버에서 세션도 함께 파기됨)
 * - notice: string (선택) — 펼쳤을 때 재인증 안내 위에 덧붙이는 문장(정지 화면의 재가입 제한 안내)
 */
function AccountDeleteSection({ user, justReauthenticated, onAccountDeleted, notice = null }) {
  const { t } = useI18n();
  const [deleteError, setDeleteError] = useState(null);
  // 계정 삭제 줄을 눌러 펼쳤는지 — 재인증 왕복 직후(justReauthenticated)에는 펼친 채로 돌아온다.
  const [deleteOpen, setDeleteOpen] = useState(Boolean(justReauthenticated));
  const [deleting, setDeleting] = useState(false);

  // 이메일 OTP 전용 계정(user.hasGoogleAccount === false)의 삭제 재인증 — 구글처럼 풀 페이지
  // 왕복이 아니라 이 화면 안에서 코드 요청/확인이 끝나므로, justReauthenticated(구글 재인증
  // 전용 플래그)와 별개로 로컬 상태로 관리한다. 둘 중 하나만 true여도 삭제 폼을 보여준다.
  const [emailReauthStep, setEmailReauthStep] = useState('idle'); // 'idle' | 'code'
  const [emailReauthCode, setEmailReauthCode] = useState('');
  const [emailReauthError, setEmailReauthError] = useState(null);
  const [emailReauthSubmitting, setEmailReauthSubmitting] = useState(false);
  const [emailReauthenticated, setEmailReauthenticated] = useState(false);
  // 재전송 쿨다운 마감 시각(ms epoch) — 서버가 429 RESEND_COOLDOWN으로 내려주는 data.retryAt.
  const [retryAt, setRetryAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!retryAt) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [retryAt]);

  const cooldownRemainingMs = retryAt ? retryAt - now : 0;
  useEffect(() => {
    if (retryAt && cooldownRemainingMs <= 0) setRetryAt(null);
  }, [cooldownRemainingMs, retryAt]);

  async function handleRequestEmailReauthCode() {
    setEmailReauthError(null);
    setEmailReauthSubmitting(true);
    try {
      await requestDeleteReauthCode();
      setEmailReauthStep('code');
    } catch (err) {
      if (err.code === 'RESEND_COOLDOWN' && err.data?.retryAt) {
        setRetryAt(new Date(err.data.retryAt).getTime());
        setNow(Date.now());
        setEmailReauthStep('code'); // 이미 코드를 받은 적이 있다는 뜻 — 코드 입력 화면 유지
      } else {
        setEmailReauthError(t('profile.reauth.sendFailed'));
      }
    } finally {
      setEmailReauthSubmitting(false);
    }
  }

  async function handleVerifyEmailReauthCode(e) {
    e.preventDefault();
    setEmailReauthError(null);
    setEmailReauthSubmitting(true);
    try {
      await verifyDeleteReauthCode(emailReauthCode.trim());
      setEmailReauthenticated(true);
    } catch (err) {
      setEmailReauthError(describeReauthError(err.code, t));
    } finally {
      setEmailReauthSubmitting(false);
    }
  }

  async function handleDeleteAccount(e) {
    e.preventDefault();
    setDeleteError(null);
    if (!window.confirm(t('profile.delete.confirm'))) {
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount();
      onAccountDeleted();
    } catch (err) {
      setDeleteError(
        err.code === 'REAUTH_REQUIRED' ? t('profile.delete.reauthExpired') : t('profile.delete.failed')
      );
      setDeleting(false);
    }
  }

  if (!deleteOpen) {
    return (
      <button type="button" className="settings-row settings-row--danger" onClick={() => setDeleteOpen(true)}>
        {t('profile.delete.title')}
      </button>
    );
  }

  return (
    <div className="settings-row settings-row--stack">
      <span className="settings-row-danger-title">{t('profile.delete.title')}</span>
      {notice && <p className="settings-help">{notice}</p>}
      {justReauthenticated || emailReauthenticated ? (
        <form onSubmit={handleDeleteAccount}>
          {deleteError && <p className="home-error">{deleteError}</p>}
          <button type="submit" className="post-btn post-btn--danger post-btn--block" disabled={deleting}>
            {deleting ? t('profile.delete.deleting') : t('profile.delete.title')}
          </button>
        </form>
      ) : user?.hasGoogleAccount ? (
        <>
          <p className="settings-help">{t('profile.reauth.googleHint')}</p>
          <button type="button" className="post-btn post-btn--outline post-btn--block" onClick={startGoogleReauth}>
            {t('profile.reauth.google')}
          </button>
        </>
      ) : emailReauthStep === 'idle' ? (
        <>
          <p className="settings-help">{t('profile.reauth.emailHint')}</p>
          {emailReauthError && <p className="home-error">{emailReauthError}</p>}
          <button
            type="button"
            className="post-btn post-btn--outline post-btn--block"
            onClick={handleRequestEmailReauthCode}
            disabled={emailReauthSubmitting || !!retryAt}
          >
            {emailReauthSubmitting
              ? t('profile.reauth.sending')
              : retryAt
                ? t('profile.reauth.retryIn', { time: formatCountdown(cooldownRemainingMs) })
                : t('profile.reauth.getCode')}
          </button>
        </>
      ) : (
        <form onSubmit={handleVerifyEmailReauthCode} className="settings-stack">
          <p className="settings-help">{t('profile.reauth.codeSent')}</p>
          <div className="settings-inline">
            <input
              type="text"
              inputMode="numeric"
              aria-label={t('login.codePlaceholder')}
              placeholder={t('login.codePlaceholder')}
              value={emailReauthCode}
              onChange={(e) => setEmailReauthCode(e.target.value)}
              required
            />
            <button type="submit" className="post-btn post-btn--ink" disabled={emailReauthSubmitting}>
              {emailReauthSubmitting ? t('login.verifying') : t('profile.reauth.confirm')}
            </button>
          </div>
          {emailReauthError && <p className="home-error">{emailReauthError}</p>}
          <button type="button" className="settings-text-btn" onClick={handleRequestEmailReauthCode} disabled={emailReauthSubmitting || !!retryAt}>
            {retryAt ? t('profile.reauth.resendWait', { time: formatCountdown(cooldownRemainingMs) }) : t('profile.reauth.resend')}
          </button>
        </form>
      )}
    </div>
  );
}

export default AccountDeleteSection;
