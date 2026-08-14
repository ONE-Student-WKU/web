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
    <div className="login-page">
      <h2>원광대학교 AI 챗봇</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label>이메일</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {mode === 'signup' && (
          <div>
            <label>이름</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div>
          <label>비밀번호</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="login-error">{error}</p>}
        <button type="submit">{mode === 'signup' ? '회원가입 후 로그인' : '로그인'}</button>
      </form>
      <button type="button" className="login-mode-toggle" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
        {mode === 'login' ? '계정이 없으신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
      </button>
    </div>
  );
}

export default Login;
