import React, { useState } from 'react';

/**
 * Login Page Component
 * Renders the portal/intranet mock login page.
 * 
 * Props:
 * - onLoginSuccess: function
 */
function Login({ onLoginSuccess }) {
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    // TODO: Connect with backend authentication api (auth.js route)
    // Mocking success for boilerplate
    onLoginSuccess({ studentId, name: '홍길동' });
  };

  return (
    <div className="login-page">
      <h2>원광대학교 웹정보서비스 로그인</h2>
      <form onSubmit={handleLogin}>
        <div>
          <label>학번</label>
          <input
            type="text"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            required
          />
        </div>
        <div>
          <label>비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit">로그인</button>
      </form>
    </div>
  );
}

export default Login;
