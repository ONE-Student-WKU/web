import React, { useEffect, useState } from 'react';
import { IconUser } from './icons.jsx';

/**
 * AccountMenu Component
 * 아바타 버튼 — 클릭하면 설정/온보딩 재설정/로그아웃 드롭다운을 연다.
 * 모든 화면 헤더(Home/Sidebar/CourseManagement/GraduationStatus)에서 공유.
 *
 * Props:
 * - user: object
 * - onLogout: function
 * - onOpenSettings: function
 */
function AccountMenu({ user, onLogout, onOpenSettings }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  return (
    <div className="account-menu" onClick={(e) => e.stopPropagation()}>
      <button
        className="avatar-btn"
        onClick={() => setOpen((v) => !v)}
        title={user?.name ? `${user.name} · 계정 메뉴` : '계정 메뉴'}
      >
        <IconUser />
      </button>
      {open && (
        <div className="account-menu-dropdown">
          <button
            className="account-menu-item"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            설정
          </button>
          <button className="account-menu-item" disabled title="준비 중인 기능이에요">
            온보딩 재설정
          </button>
          <div className="account-menu-divider" />
          <button
            className="account-menu-item danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}

export default AccountMenu;
