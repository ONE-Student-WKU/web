import React, { useState } from 'react';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Chat from './pages/Chat.jsx';
import { logout } from './api/chatApi.js';

/**
 * Main App Component
 * Handles simple routing state (Login/Home/Chat pages)
 */
function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home'); // 'home' | 'chat'

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
        ) : (
          <Home user={user} onLogout={handleLogout} onOpenChat={() => setView('chat')} />
        )}
      </div>
    </div>
  );
}

export default App;
