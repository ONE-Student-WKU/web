import React, { useState } from 'react';
import { startGoogleLogin, requestEmailCode, verifyEmailCode } from '../api/chatApi';

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
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState(null);

  const handleRequestCode = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setEmailError(null);
    try {
      await requestEmailCode(email.trim());
      setStep('code');
    } catch (err) {
      setEmailError(describeEmailError(err.code));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setEmailError(null);
    try {
      // 이메일 앱에서 코드를 복사해 붙여넣을 때 앞뒤에 공백/줄바꿈이 섞여 들어오는 경우가
      // 있어(눈으로는 똑같아 보여도 해시 비교가 실패함), 항상 trim 후 전송한다.
      await verifyEmailCode(email.trim(), code.trim());
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

        <button type="button" className="auth-submit-btn" onClick={startGoogleLogin}>
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
            <button type="submit" className="auth-submit-btn auth-submit-btn--secondary" disabled={submitting}>
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
            <button type="submit" className="auth-submit-btn auth-submit-btn--secondary" disabled={submitting}>
              {submitting ? '확인 중...' : '로그인'}
            </button>
            <button
              type="button"
              className="auth-toggle-link auth-toggle-link--block"
              onClick={() => {
                setStep('email');
                setCode('');
                setEmailError(null);
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
