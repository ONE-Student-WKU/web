import React, { useState } from 'react';
import { login, signup } from '../api/chatApi';

/**
 * Login Page Component
 *
 * Props:
 * - onLoginSuccess: function
 */
function Login({ onLoginSuccess }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === 'signup') {
        await signup(email, password, name);
      }
      const user = await login(email, password);
      onLoginSuccess(user);
    } catch (err) {
      setError(err.code || 'REQUEST_FAILED');
    }
  };

  return (
    <div className="auth-page">
      <header className="screen-header">
        <span className="screen-title">ONE Student</span>
      </header>

      <div className="auth-body">
        <h2 className="auth-heading">{mode === 'signup' ? '회원가입' : '로그인'}</h2>
        <p className="auth-subheading">
          {mode === 'signup'
            ? '내 학사정보를 바탕으로 답하는 챗봇을 쓰려면 계정이 필요해요.'
            : '내 학사정보를 바탕으로 답하는 챗봇에 로그인하세요.'}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>이메일</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {mode === 'signup' && (
            <div className="auth-field">
              <label>이름</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div className="auth-field">
            <label>비밀번호</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="auth-submit-btn">
            {mode === 'signup' ? '회원가입 후 로그인' : '로그인'}
          </button>
        </form>

        <button type="button" className="auth-toggle-btn" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
          {mode === 'login' ? '계정이 없으신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
        </button>
      </div>
    </div>
  );
}

export default Login;
