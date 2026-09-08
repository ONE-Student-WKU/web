import React from 'react';
import { startGoogleLogin } from '../api/chatApi';

// Google OAuth 콜백은 풀 페이지 리다이렉트로 끝나기 때문에(로그인 성공을 동기 응답으로
// 못 받음) App.jsx가 authError 쿼리 파라미터를 파싱해서 이 컴포넌트에 문구로만 전달한다.
function describeAuthError(code) {
  if (code === 'STATE_MISMATCH') return '로그인 요청이 만료됐어요. 다시 시도해주세요.';
  if (code === 'EMAIL_NOT_VERIFIED') return '이메일이 인증되지 않은 구글 계정이에요. 다른 계정으로 시도해주세요.';
  if (code === 'INVALID_CREDENTIALS') return '로그인에 실패했어요. 잠시 후 다시 시도해주세요.';
  if (code === 'OAUTH_FAILED') return '구글 로그인에 실패했어요. 잠시 후 다시 시도해주세요.';
  return '로그인에 실패했어요. 잠시 후 다시 시도해주세요.';
}

/**
 * Login Page Component
 *
 * Props:
 * - error: string | null — App.jsx가 전달하는 authError 쿼리 코드
 * - onOpenPrivacy / onOpenTerms: function — 개인정보처리방침/이용약관 화면으로 전환
 */
function Login({ error, onOpenPrivacy, onOpenTerms }) {
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
