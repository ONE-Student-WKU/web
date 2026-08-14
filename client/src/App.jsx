import React, { useState } from 'react';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Chat from './pages/Chat.jsx';
import CourseManagement from './pages/CourseManagement.jsx';
import GraduationStatus from './pages/GraduationStatus.jsx';
import { logout } from './api/chatApi.js';

/**
 * Main App Component
 * Handles simple routing state (Login/Home/Chat/CourseManagement/GraduationStatus pages)
 */
function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home'); // 'home' | 'chat' | 'courses' | 'graduation'

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
          <Chat user={user} onLogout={handleLogout} onGoHome={() => setView('home')} />
        ) : view === 'courses' ? (
          <CourseManagement user={user} onLogout={handleLogout} onGoHome={() => setView('home')} />
        ) : view === 'graduation' ? (
          <GraduationStatus onLogout={handleLogout} onGoHome={() => setView('home')} />
        ) : (
          <Home
            user={user}
            onLogout={handleLogout}
            onOpenChat={() => setView('chat')}
            onOpenCourses={() => setView('courses')}
            onOpenGraduation={() => setView('graduation')}
          />
        )}
      </div>
    </div>
  );
}

export default App;
