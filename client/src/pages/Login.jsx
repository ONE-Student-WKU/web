import React, { useEffect, useState } from 'react';
import { startGoogleLogin, requestEmailCode, verifyEmailCode } from '../api/chatApi';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import ConsentCheckbox from '../components/ConsentCheckbox.jsx';
import { IconGoogle } from '../components/icons.jsx';
import { CONSENT_VERSION, readStoredConsent, storeConsent, readStoredNoticeAck, storeNoticeAck } from '../utils/consent.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import BrandTitle from '../components/BrandTitle.jsx';

// 남은 밀리초를 타이머 문구로 바꾼다
//   - 1시간 이상: h:mm:ss (하루 한도에 걸리면 몇 시간씩 남을 수 있어서)
//   - 1시간 미만: m:ss
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

// Google OAuth 콜백은 풀 페이지 리다이렉트로 끝나기 때문에(로그인 성공을 동기 응답으로
// 못 받음) App.jsx가 authError 쿼리 파라미터를 파싱해서 이 컴포넌트에 문구로만 전달한다.
function describeAuthError(code, t) {
  if (code === 'STATE_MISMATCH') return t('login.err.stateMismatch');
  if (code === 'EMAIL_NOT_VERIFIED') return t('login.err.emailNotVerified');
  if (code === 'CONSENT_REQUIRED') return t('login.err.consentRequired');
  if (code === 'INVALID_CREDENTIALS') return t('login.err.generic');
  if (code === 'OAUTH_FAILED') return t('login.err.oauthFailed');
  if (code === 'SIGNUP_BLOCKED') return t('login.err.signupBlocked');
  return t('login.err.generic');
}

// 서버가 보낸 결과 이름표(err.code)에 맞는 문구를 고른다
//   - 모르는 이름표면 기본 문구 "요청에 실패했어요. 잠시 후 다시 시도해주세요."
//   - EMAIL_SEND_FAILED: 기다려도 안 풀리니 Google 로그인을 권하는 문구
function describeEmailError(code, t) {
  if (code === 'INVALID_EMAIL') return t('login.err.invalidEmail');
  if (code === 'CONSENT_REQUIRED') return t('login.err.consentRequired');
  if (code === 'NOT_FOUND') return t('login.err.notFound');
  if (code === 'INVALID_CODE') return t('login.err.invalidCode');
  if (code === 'TOO_MANY_ATTEMPTS') return t('login.err.tooManyAttempts');
  if (code === 'EMAIL_SEND_FAILED') return t('login.err.sendFailed');
  if (code === 'SIGNUP_BLOCKED') return t('login.err.signupBlocked');
  return t('login.err.request');
}

/**
 * Login Page Component
 *
 * Props:
 * - error: string | null — App.jsx가 전달하는 authError 쿼리 코드
 * - onOpenPrivacy / onOpenTerms: function — 개인정보처리방침/이용약관 화면으로 전환
 * - onLoginSuccess: function — 이메일 인증코드 로그인 성공 시 App.jsx가 사용자 상태를 다시 조회하도록 호출
 */
function Login({ error, onOpenPrivacy, onOpenTerms, onLoginSuccess }) {
  const { t } = useI18n();
  // 이메일 로그인은 이메일 입력 → 코드 입력 2단계. 구글 로그인(풀 페이지 리다이렉트)과는
  // 독립적으로 이 컴포넌트 안에서만 상태를 갖는다.
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  // 이용약관·개인정보 수집·이용 동의(필수) — 체크하기 전에는 Google/이메일 로그인 버튼을 모두 막는다. 이 브라우저에서 현재 버전에
  // 이미 동의했으면 처음부터 체크돼 있다(약관 링크를 보러 갔다 와도 유지된다). 서버에도 같은 검사가 있다(routes/auth.js).
  const [termsAgreed, setTermsAgreed] = useState(readStoredConsent);
  const handleConsentChange = (checked) => {
    setTermsAgreed(checked);
    storeConsent(checked);
  };
  // "[필수] 학교 공식 서비스가 아님" 확인 — 약관 동의와 함께 둘 다 체크해야 로그인 버튼이 열린다(교육혁신과 통화 2026-10-26).
  // 학생이 학교가 만든 앱으로 오해하지 않게 하려는 화면 단계의 확인이라 서버에는 보내지 않는다.
  const [noticeAcked, setNoticeAcked] = useState(readStoredNoticeAck);
  const handleNoticeChange = (checked) => {
    setNoticeAcked(checked);
    storeNoticeAck(checked);
  };
  const consented = termsAgreed && noticeAcked;
  // 동의하지 않은 채 로그인 버튼이나 입력 칸을 누르면 막기만 하지 않고, 어떤 항목이 빠졌는지 동의 체크를 강조해서 알려준다.
  // 버튼은 disabled가 아니라 aria-disabled로 둬야 클릭 자체가 들어와 이 안내를 띄울 수 있다(disabled 버튼은 클릭 이벤트가 없다).
  // focus: 버튼을 눌렀을 땐 체크박스로 포커스도 옮기고, 입력 칸에 포커스가 간 경우엔 타이핑을 끊지 않으려고 옮기지 않는다.
  const [consentNudge, setConsentNudge] = useState({ key: 0, focus: false });
  const blockWithoutConsent = ({ focus }) => {
    if (consented) return false;
    setConsentNudge((n) => ({ key: n.key + 1, focus }));
    return true;
  };
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  // 쿨다운 타이머에 쓰는 값 (useState: 값 하나의 처음 값을 정하고 [값, 바꾸는 함수]를 돌려준다)
  //   - retryAt: 다시 요청할 수 있는 시각(ms). 서버가 429 RESEND_COOLDOWN과 함께 보낸 data.retryAt. 처음엔 null
  //   - now: 지금 시각. 아래 타이머가 1초마다 바꾼다
  //   - setRetryAt · setNow: 값이 아니라 그 값을 바꾸는 함수
  const [retryAt, setRetryAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  // retryAt이 있는 동안 1초마다 now를 바꿔 화면을 다시 그린다 (타이머)
  //   - [retryAt]: 의존성 배열(대괄호). 처음 그릴 때와 retryAt의 값이 바뀔 때마다 실행된다
  //   - 화면은 값이 바뀌어서 다시 그려지고, useEffect는 그린 뒤에 돈다
  //   - 정리 함수(clearInterval): retryAt이 바뀌거나 Login 화면이 사라질 때(언마운트) 지난 타이머를 끈다
  //   - retryAt이 null이면 아무것도 하지 않고 끝낸다 → 새 타이머를 만들지 않는다
  useEffect(() => {
    if (!retryAt) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [retryAt]);

  // 남은 밀리초 = 다시 요청할 수 있는 시각 − 지금
  //   - 삼항 연산자(조건 ? 참일 때 : 거짓일 때): retryAt이 있으면 계산, 없으면(null) 0
  //   - 함정: retryAt은 앱 서버 시계로 만든 시각이고 now는 브라우저 시계다
  //   - 학생 컴퓨터 시계가 틀리면 타이머도 그만큼 틀린다
  const cooldownRemainingMs = retryAt ? retryAt - now : 0;

  // 남은 시간이 0 이하가 되면 retryAt을 지운다 → 버튼이 다시 열리고 위의 타이머가 멈춘다
  useEffect(() => {
    if (retryAt && cooldownRemainingMs <= 0) setRetryAt(null);
  }, [cooldownRemainingMs, retryAt]);

  // 코드 받기 · 재전송 실패 처리
  //   - 쿨다운(RESEND_COOLDOWN)이고 retryAt이 있으면: 문구 대신 타이머 (얼마나 기다릴지 보여 줘서 계속 눌러 보지 않게)
  //   - err.data?.retryAt: data가 있으면 retryAt을 꺼내고, 없으면 에러 없이 undefined (다른 값으로 대체하는 게 아님)
  //   - 그 밖의 실패: describeEmailError가 고른 문구를 emailError에 넣어 화면에 띄운다
  function handleEmailRequestError(err) {
    if (err.code === 'RESEND_COOLDOWN' && err.data?.retryAt) {
      setRetryAt(new Date(err.data.retryAt).getTime());
      setNow(Date.now());
      setEmailError(null);
    } else {
      setEmailError(describeEmailError(err.code, t));
    }
  }

  const handleRequestCode = async (e) => {
    e.preventDefault();
    if (blockWithoutConsent({ focus: true })) return;
    setSubmitting(true);
    setEmailError(null);
    try {
      await requestEmailCode(email.trim(), CONSENT_VERSION);
      setStep('code');
    } catch (err) {
      handleEmailRequestError(err);
    } finally {
      setSubmitting(false);
    }
  };

  // 코드 입력 화면에서 벗어나지 않고 재전송 — 기존엔 이메일 입력 단계로 되돌아갔다가 다시
  // 제출해야만 재요청이 가능했음(2클릭). 서버의 재전송 쿨다운/일일 한도가 남용을 막아준다.
  const handleResendCode = async () => {
    setResending(true);
    setEmailError(null);
    setResent(false);
    try {
      await requestEmailCode(email.trim(), CONSENT_VERSION);
      setResent(true);
    } catch (err) {
      handleEmailRequestError(err);
    } finally {
      setResending(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    if (blockWithoutConsent({ focus: true })) return;
    setSubmitting(true);
    setEmailError(null);
    try {
      // 이메일 앱에서 코드를 복사해 붙여넣을 때 앞뒤에 공백/줄바꿈이 섞여 들어오는 경우가
      // 있어(눈으로는 똑같아 보여도 해시 비교가 실패함), 항상 trim 후 전송한다.
      await verifyEmailCode(email.trim(), code.trim(), remember, CONSENT_VERSION);
      await onLoginSuccess();
    } catch (err) {
      setEmailError(describeEmailError(err.code, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <header className="screen-header">
        <BrandTitle />
        <LanguageSwitcher />
      </header>

      <div className="auth-body">
        <p className="auth-unofficial-badge">{t('login.unofficialBadge')}</p>
        <h2 className="auth-heading">{t('login.title')}</h2>
        <p className="auth-subheading">{t('login.subtitle')}</p>

        {error && <p className="auth-error">{describeAuthError(error, t)}</p>}

        <label className="auth-remember-field">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t('login.remember')}
        </label>

        <ConsentCheckbox
          checked={termsAgreed}
          onChange={handleConsentChange}
          onOpenTerms={onOpenTerms}
          onOpenPrivacy={onOpenPrivacy}
          nudgeKey={consentNudge.key}
          nudgeFocus={consentNudge.focus && !termsAgreed}
        />
        <ConsentCheckbox
          checked={noticeAcked}
          onChange={handleNoticeChange}
          textKey="login.unofficialAck"
          nudgeKey={consentNudge.key}
          nudgeFocus={consentNudge.focus && termsAgreed}
        />

        <button
          type="button"
          className="auth-submit-btn auth-submit-btn--secondary auth-google-btn"
          onClick={() => {
            if (blockWithoutConsent({ focus: true })) return;
            startGoogleLogin(remember, CONSENT_VERSION);
          }}
          aria-disabled={!consented}
        >
          <IconGoogle />
          {t('login.google')}
        </button>
        {!consented && (
          <p
            className={`settings-field-hint auth-consent-needed${consentNudge.key ? ' auth-consent-needed--alert' : ''}`}
            aria-live="polite"
          >
            {t('login.consentNeeded')}
          </p>
        )}

        <div className="auth-divider">{t('login.or')}</div>

        {step === 'email' ? (
          <form onSubmit={handleRequestCode}>
            <div className="auth-field">
              <label htmlFor="login-email">{t('login.email')}</label>
              <input
                id="login-email"
                type="email"
                placeholder={t('login.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => blockWithoutConsent({ focus: false })}
                required
              />
            </div>
            {emailError && <p className="auth-error">{emailError}</p>}
            {retryAt && (
              <p className="settings-field-hint">{t('login.cooldown', { time: formatCountdown(cooldownRemainingMs) })}</p>
            )}

            {/* retryAt이 있으면 버튼을 잠근다
                - !!retryAt: 이중 부정으로 불리언 변환 (숫자 → true, null → false. Boolean(값)과 같음) */}
            <button
              type="submit"
              className="auth-submit-btn auth-submit-btn--secondary"
              disabled={submitting || !!retryAt}
              aria-disabled={!consented || submitting || !!retryAt}
            >
              {submitting ? t('login.sending') : t('login.sendCode')}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode}>
            <p className="auth-code-hint">{t('login.codeSent', { email })}</p>
            <div className="auth-field">
              <label htmlFor="login-code">{t('login.code')}</label>
              <input
                id="login-code"
                type="text"
                inputMode="numeric"
                placeholder={t('login.codePlaceholder')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onFocus={() => blockWithoutConsent({ focus: false })}
                required
              />
            </div>
            {emailError && <p className="auth-error">{emailError}</p>}
            {/* .auth-body가 justify-content: center라 이 줄이 조건부로 있다 없다 하면 폼 전체
                높이가 바뀌어 재중앙정렬되면서 위쪽 코드 입력란까지 흔들려 보인다(실사용
                피드백) — 항상 렌더링해서 자리를 고정해두고 visibility만 토글한다. */}
            <p
              className="settings-field-hint"
              style={{ visibility: resent && !retryAt ? 'visible' : 'hidden' }}
              aria-hidden={!(resent && !retryAt)}
            >
              {t('login.codeResent')}
            </p>
            <button
              type="submit"
              className="auth-submit-btn auth-submit-btn--secondary"
              disabled={submitting}
              aria-disabled={!consented || submitting}
            >
              {submitting ? t('login.verifying') : t('login.submit')}
            </button>
            <button
              type="button"
              className="auth-toggle-link auth-toggle-link--block"
              onClick={handleResendCode}
              disabled={resending || !!retryAt}
            >
              {resending
                ? t('login.resending')
                : retryAt
                  ? t('login.resendWait', { time: formatCountdown(cooldownRemainingMs) })
                  : t('login.resend')}
            </button>
            <button
              type="button"
              className="auth-toggle-link auth-toggle-link--block"
              onClick={() => {
                setStep('email');
                setCode('');
                setEmailError(null);
                setResent(false);
                setRetryAt(null);
              }}
            >
              {t('login.retypeEmail')}
            </button>
          </form>
        )}

        <p className="auth-toggle-text">
          <button type="button" className="auth-toggle-link" onClick={onOpenPrivacy}>
            {t('login.privacy')}
          </button>
          {' · '}
          <button type="button" className="auth-toggle-link" onClick={onOpenTerms}>
            {t('login.terms')}
          </button>
        </p>
      </div>
    </div>
  );
}

export default Login;
