import React, { useEffect, useState } from 'react';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Chat from './pages/Chat.jsx';
import CourseManagement from './pages/CourseManagement.jsx';
import GraduationStatus from './pages/GraduationStatus.jsx';
import Settings from './pages/Settings.jsx';
import { logout } from './api/chatApi.js';

/**
 * Main App Component
 * Handles simple routing state (Login/Home/Chat/CourseManagement/GraduationStatus/Settings pages)
 */
function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home'); // 'home' | 'chat' | 'courses' | 'graduation' | 'settings'
  const [theme, setTheme] = useState(
    () => localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

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
          <Login onLoginSuccess={(userData) => setUser(userData)} />
        ) : view === 'chat' ? (
          <Chat
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
          />
        ) : view === 'courses' ? (
          <CourseManagement
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
          />
        ) : view === 'graduation' ? (
          <GraduationStatus
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
          />
        ) : view === 'settings' ? (
          <Settings theme={theme} onSetTheme={setTheme} onGoHome={() => setView('home')} />
        ) : (
          <Home
            user={user}
            onLogout={handleLogout}
            onOpenChat={() => setView('chat')}
            onOpenCourses={() => setView('courses')}
            onOpenGraduation={() => setView('graduation')}
            onOpenSettings={() => setView('settings')}
          />
        )}
      </div>
    </div>
  );
}

export default App;
