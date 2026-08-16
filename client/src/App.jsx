import React, { useEffect, useRef, useState } from 'react';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Chat from './pages/Chat.jsx';
import CourseManagement from './pages/CourseManagement.jsx';
import GraduationStatus from './pages/GraduationStatus.jsx';
import Settings from './pages/Settings.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Profile from './pages/Profile.jsx';
import { logout } from './api/chatApi.js';

/**
 * Main App Component
 * Handles simple routing state (Login/Home/Chat/CourseManagement/GraduationStatus/Settings/Onboarding/Profile pages)
 */
function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home'); // 'home' | 'chat' | 'courses' | 'graduation' | 'settings' | 'onboarding' | 'profile'
  const [theme, setTheme] = useState(
    () => localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  );
  // 홈의 "학년이 다르신가요?" 링크로 설정에 왔을 때만 휴학 학기 수 입력란을 강조 — 계정
  // 메뉴로 평범하게 들어온 경우엔 안 켜지게 별도 플래그로 관리.
  const [highlightLeaveSemesters, setHighlightLeaveSemesters] = useState(false);
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('fontSize') || 'medium');

  // 모바일에서 뒤로가기(제스처/버튼)를 누르면 앱을 벗어나 이전 브라우저 페이지로
  // 나가버리는 문제 방지: 화면 전환마다 히스토리 항목을 쌓아서, 뒤로가기를
  // 누르면 브라우저를 떠나기 전에 앱 내부 화면을 먼저 오가도록 함.
  // 로그인 성공 시점의 화면이 "루트"가 되도록 replaceState로 시작하고,
  // 이후 화면 전환은 pushState로 쌓는다. popstate(뒤로/앞으로가기)로 들어온
  // 변경은 다시 push하지 않도록 skipHistoryPush로 구분한다.
  const skipHistoryPush = useRef(true);

  useEffect(() => {
    function handlePopState(event) {
      skipHistoryPush.current = true;
      setView(event.state?.view || 'home');
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (skipHistoryPush.current) {
      window.history.replaceState({ view }, '');
      skipHistoryPush.current = false;
      return;
    }
    window.history.pushState({ view }, '');
  }, [view, user]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.fontSize = fontSize;
    localStorage.setItem('fontSize', fontSize);
  }, [fontSize]);

  const handleLogout = () => {
    logout().finally(() => {
      skipHistoryPush.current = true;
      setUser(null);
      setView('home');
    });
  };

  // 계정 삭제는 서버(DELETE /api/me)에서 이미 세션을 파기하므로 /auth/logout을 다시 부를 필요는 없음.
  const handleAccountDeleted = () => {
    skipHistoryPush.current = true;
    setUser(null);
    setView('home');
  };

  return (
    <div className="app-container">
      <div className="app-frame">
        {!user ? (
          <Login
            onLoginSuccess={(userData) => {
              setUser(userData);
              setView(userData.onboardingCompleted ? 'home' : 'onboarding');
            }}
          />
        ) : view === 'chat' ? (
          <Chat
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
          />
        ) : view === 'courses' ? (
          <CourseManagement
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
          />
        ) : view === 'graduation' ? (
          <GraduationStatus
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
          />
        ) : view === 'settings' ? (
          <Settings
            theme={theme}
            onSetTheme={setTheme}
            fontSize={fontSize}
            onSetFontSize={setFontSize}
            highlightLeaveSemesters={highlightLeaveSemesters}
            onGoHome={() => {
              setHighlightLeaveSemesters(false);
              setView('home');
            }}
          />
        ) : view === 'onboarding' ? (
          <Onboarding
            user={user}
            onDone={() => {
              setUser((u) => ({ ...u, onboardingCompleted: true }));
              setView('home');
            }}
            onSkip={() => setView('home')}
          />
        ) : view === 'profile' ? (
          <Profile
            user={user}
            onGoHome={() => setView('home')}
            onNameChanged={(name) => setUser((u) => ({ ...u, name }))}
            onAccountDeleted={handleAccountDeleted}
          />
        ) : (
          <Home
            user={user}
            onLogout={handleLogout}
            onOpenChat={() => setView('chat')}
            onOpenCourses={() => setView('courses')}
            onOpenGraduation={() => setView('graduation')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
            onOpenLeaveSettings={() => {
              setHighlightLeaveSemesters(true);
              setView('settings');
            }}
          />
        )}
      </div>
    </div>
  );
}

export default App;
