import React, { useState } from 'react';
import Login from './pages/Login.jsx';
import Chat from './pages/Chat.jsx';

/**
 * Main App Component
 * Handles simple routing state (Login/Chat pages)
 */
function App() {
  const [user, setUser] = useState(null);

  return (
    <div className="app-container">
      {user ? (
        <Chat user={user} onLogout={() => setUser(null)} />
      ) : (
        <Login onLoginSuccess={(userData) => setUser(userData)} />
      )}
    </div>
  );
}

export default App;
