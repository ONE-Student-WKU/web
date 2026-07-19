import React from 'react';

/**
 * Sidebar Component
 * Displays chat history list, user profile summary, and navigation.
 * 
 * Props:
 * - user: object
 * - onLogout: function
 */
function Sidebar({ user, onLogout }) {
  // TODO: Add sidebar content such as session list or mock portal quicklinks
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h3>원광대학교 AI 챗</h3>
      </div>
      <div className="user-profile">
        <p>{user?.name || '사용자'} 님</p>
        <p>학번: {user?.studentId || 'N/A'}</p>
      </div>
      <div className="sidebar-menu">
        {/* Navigation / Chat history items will go here */}
      </div>
      <button className="logout-btn" onClick={onLogout}>
        로그아웃
      </button>
    </aside>
  );
}

export default Sidebar;
