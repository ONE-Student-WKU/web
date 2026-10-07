import React, { useEffect, useState } from 'react';
import { IconUser } from './icons.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * AccountMenu Component
 * 아바타 버튼 — 클릭하면 설정/학과·학번 수정/로그아웃 드롭다운을 연다.
 * 모든 화면 헤더(Home/Sidebar/CourseManagement/GraduationStatus)에서 공유.
 *
 * Props:
 * - user: object
 * - onLogout: function
 * - onOpenSettings: function
 * - onOpenOnboarding: function
 * - onOpenProfile: function
 * - onOpenAdmin: function (선택) — user.role === 'admin'일 때만 "관리자" 항목을 보여준다.
 * - onOpenInquiry: function (선택) — "문의하기" 항목을 보여준다.
 *   어느 화면에서 문제를 겪었든 그 자리에서 바로 관리자/문의하기로 갈 수 있어야 해서, 이
 *   메뉴를 쓰는 모든 화면(Home/Community/CourseManagement/GraduationStatus/
 *   CareerExploration/Admin)에서 둘 다 연결돼 있음.
 */
function AccountMenu({ user, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile, onOpenAdmin, onOpenInquiry }) {
  const { t } = useI18n();
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
        title={user?.name ? t('account.menuNamed', { name: user.name }) : t('account.menu')}
      >
        <IconUser />
      </button>
      {open && (
        <div className="account-menu-dropdown">
          {user?.role === 'admin' && onOpenAdmin && (
            <>
              <button
                className="account-menu-item account-menu-item-admin"
                onClick={() => {
                  setOpen(false);
                  onOpenAdmin();
                }}
              >
                {t('account.admin')}
              </button>
              <div className="account-menu-divider" />
            </>
          )}
          <button
            className="account-menu-item"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            {t('account.settings')}
          </button>
          <button
            className="account-menu-item"
            onClick={() => {
              setOpen(false);
              onOpenOnboarding();
            }}
          >
            {t('account.editDepartment')}
          </button>
          <button
            className="account-menu-item"
            onClick={() => {
              setOpen(false);
              onOpenProfile();
            }}
          >
            {t('account.editProfile')}
          </button>
          {onOpenInquiry && (
            <button
              className="account-menu-item"
              onClick={() => {
                setOpen(false);
                onOpenInquiry();
              }}
            >
              {t('account.inquiry')}
            </button>
          )}
          <div className="account-menu-divider" />
          <button
            className="account-menu-item danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            {t('account.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

export default AccountMenu;
