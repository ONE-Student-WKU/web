import React, { useEffect, useState } from 'react';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Chat from './pages/Chat.jsx';
import CourseManagement from './pages/CourseManagement.jsx';
import GraduationStatus from './pages/GraduationStatus.jsx';
import Settings from './pages/Settings.jsx';
import Onboarding from './pages/Onboarding.jsx';
import { logout } from './api/chatApi.js';

/**
 * Main App Component
 * Handles simple routing state (Login/Home/Chat/CourseManagement/GraduationStatus/Settings/Onboarding pages)
 */
function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home'); // 'home' | 'chat' | 'courses' | 'graduation' | 'settings' | 'onboarding'
  const [theme, setTheme] = useState(
    () => localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  );
  // 홈의 "학년이 다르신가요?" 링크로 설정에 왔을 때만 휴학 학기 수 입력란을 강조 — 계정
  // 메뉴로 평범하게 들어온 경우엔 안 켜지게 별도 플래그로 관리.
  const [highlightLeaveSemesters, setHighlightLeaveSemesters] = useState(false);
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('fontSize') || 'medium');

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
      setUser(null);
      setView('home');
    });
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
          />
        ) : view === 'courses' ? (
          <CourseManagement
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
          />
        ) : view === 'graduation' ? (
          <GraduationStatus
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
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
        ) : (
          <Home
            user={user}
            onLogout={handleLogout}
            onOpenChat={() => setView('chat')}
            onOpenCourses={() => setView('courses')}
            onOpenGraduation={() => setView('graduation')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
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
