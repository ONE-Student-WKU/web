import React, { useEffect, useState } from 'react';
import { startGoogleLogin, requestEmailCode, verifyEmailCode } from '../api/chatApi';

// 재전송 쿨다운(server/services/emailAuthService.js:checkResendAllowed)에 걸리면 서버가
// data.retryAt(ISO 문자열)을 같이 내려준다 — 일일 한도까지 걸리면 몇 시간 단위로 남을 수
// 있어서(예: 832분) mm:ss만으로는 얼마나 기다려야 하는지 가늠이 안 된다 — 1시간 이상이면
// h:mm:ss로, 아니면 기존처럼 mm:ss로 보여준다.
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
function describeAuthError(code) {
  if (code === 'STATE_MISMATCH') return '로그인 요청이 만료됐어요. 다시 시도해주세요.';
  if (code === 'EMAIL_NOT_VERIFIED') return '이메일이 인증되지 않은 구글 계정이에요. 다른 계정으로 시도해주세요.';
  if (code === 'INVALID_CREDENTIALS') return '로그인에 실패했어요. 잠시 후 다시 시도해주세요.';
  if (code === 'OAUTH_FAILED') return '구글 로그인에 실패했어요. 잠시 후 다시 시도해주세요.';
  return '로그인에 실패했어요. 잠시 후 다시 시도해주세요.';
}

// 이메일 인증코드 요청/확인 실패 코드는 서버(server/routes/auth.js)가 내려주는 err.code 기준.
function describeEmailError(code) {
  if (code === 'INVALID_EMAIL') return '이메일 주소를 다시 확인해주세요.';
  if (code === 'NOT_FOUND') return '인증코드를 다시 요청해주세요.';
  if (code === 'INVALID_CODE') return '인증코드가 올바르지 않아요.';
  if (code === 'TOO_MANY_ATTEMPTS') return '시도 횟수를 초과했어요. 인증코드를 다시 요청해주세요.';
  return '요청에 실패했어요. 잠시 후 다시 시도해주세요.';
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
  // 이메일 로그인은 이메일 입력 → 코드 입력 2단계. 구글 로그인(풀 페이지 리다이렉트)과는
  // 독립적으로 이 컴포넌트 안에서만 상태를 갖는다.
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
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

  // RESEND_COOLDOWN 응답은 일반 에러 문구 대신 타이머로 안내한다 — describeEmailError의
  // 기본 문구("잠시 후 다시 시도")로는 얼마나 기다려야 하는지 알 수 없어 계속 눌러보게 됨.
  function handleEmailRequestError(err) {
    if (err.code === 'RESEND_COOLDOWN' && err.data?.retryAt) {
      setRetryAt(new Date(err.data.retryAt).getTime());
      setNow(Date.now());
      setEmailError(null);
    } else {
      setEmailError(describeEmailError(err.code));
    }
  }

  const handleRequestCode = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setEmailError(null);
    try {
      await requestEmailCode(email.trim());
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
      await requestEmailCode(email.trim());
      setResent(true);
    } catch (err) {
      handleEmailRequestError(err);
    } finally {
      setResending(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setEmailError(null);
    try {
      // 이메일 앱에서 코드를 복사해 붙여넣을 때 앞뒤에 공백/줄바꿈이 섞여 들어오는 경우가
      // 있어(눈으로는 똑같아 보여도 해시 비교가 실패함), 항상 trim 후 전송한다.
      await verifyEmailCode(email.trim(), code.trim(), remember);
      await onLoginSuccess();
    } catch (err) {
      setEmailError(describeEmailError(err.code));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <header className="screen-header">
        <span className="screen-title">ONE Student</span>
      </header>

      <div className="auth-body">
        <h2 className="auth-heading">로그인</h2>
        <p className="auth-subheading">원광대 학생의 입학부터 졸업까지, 학업과 진로를 연결하는 학생 생활 통합 서비스</p>

        {error && <p className="auth-error">{describeAuthError(error)}</p>}

        <label className="auth-remember-field">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          로그인 상태 유지
        </label>

        <button type="button" className="auth-submit-btn" onClick={() => startGoogleLogin(remember)}>
          Google로 로그인
        </button>

        <div className="auth-divider">또는</div>

        {step === 'email' ? (
          <form onSubmit={handleRequestCode}>
            <div className="auth-field">
              <label htmlFor="login-email">이메일 주소</label>
              <input
                id="login-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {emailError && <p className="auth-error">{emailError}</p>}
            {retryAt && (
              <p className="settings-field-hint">{formatCountdown(cooldownRemainingMs)} 후 다시 요청할 수 있어요.</p>
            )}
            <button
              type="submit"
              className="auth-submit-btn auth-submit-btn--secondary"
              disabled={submitting || !!retryAt}
            >
              {submitting ? '전송 중...' : '인증코드 받기'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode}>
            <p className="auth-code-hint">{email}로 인증코드를 보냈어요. 15분 이내에 입력해주세요.</p>
            <div className="auth-field">
              <label htmlFor="login-code">인증코드</label>
              <input
                id="login-code"
                type="text"
                inputMode="numeric"
                placeholder="6자리 숫자"
                value={code}
                onChange={(e) => setCode(e.target.value)}
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
              인증코드를 다시 보냈어요.
            </p>
            <button type="submit" className="auth-submit-btn auth-submit-btn--secondary" disabled={submitting}>
              {submitting ? '확인 중...' : '로그인'}
            </button>
            <button
              type="button"
              className="auth-toggle-link auth-toggle-link--block"
              onClick={handleResendCode}
              disabled={resending || !!retryAt}
            >
              {resending
                ? '재전송 중...'
                : retryAt
                  ? `${formatCountdown(cooldownRemainingMs)} 후 재전송 가능`
                  : '인증코드 재전송'}
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
              이메일 다시 입력하기
            </button>
          </form>
        )}

        <p className="auth-toggle-text">
          <button type="button" className="auth-toggle-link" onClick={onOpenPrivacy}>
            개인정보처리방침
          </button>
          {' · '}
          <button type="button" className="auth-toggle-link" onClick={onOpenTerms}>
            이용약관
          </button>
        </p>
      </div>
    </div>
  );
}

export default Login;
