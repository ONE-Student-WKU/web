import React, { useEffect } from 'react';
import { IconX } from './icons.jsx';

/**
 * NavDrawer Component
 * 좌측 상단 메뉴(햄버거) 버튼으로 여는 슬라이드인 내비게이션 패널.
 * 오버레이 클릭 또는 Esc로 닫힘.
 *
 * Props:
 * - open: boolean
 * - onClose: function
 * - onOpenCourses: function
 * - onOpenGraduation: function
 * - onOpenChat: function
 */
function NavDrawer({ open, onClose, onOpenCourses, onOpenGraduation, onOpenChat }) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const go = (action) => {
    onClose();
    action();
  };

  return (
    <>
      <div className={`nav-drawer-overlay ${open ? 'open' : ''}`} onClick={onClose} aria-hidden={!open} />
      <nav className={`nav-drawer ${open ? 'open' : ''}`} aria-label="메뉴" aria-hidden={!open}>
        <div className="nav-drawer-header">
          <span className="screen-title">ONE Student</span>
          <button className="menu-btn" onClick={onClose} aria-label="메뉴 닫기">
            <IconX />
          </button>
        </div>
        <button className="nav-drawer-item" onClick={() => go(onOpenCourses)}>
          과목 관리
        </button>
        <button className="nav-drawer-item" onClick={() => go(onOpenGraduation)}>
          졸업요건 진단
        </button>
        <button className="nav-drawer-item" onClick={() => go(onOpenChat)}>
          ONE AI
        </button>
      </nav>
    </>
  );
}

export default NavDrawer;
