import React, { useEffect, useState } from 'react';
import { IconSettings } from './icons.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import { useAdminPending } from '../utils/adminPending.js';

/**
 * AccountMenu Component
 * 톱니바퀴 버튼 — 클릭하면 설정/학과·학번 수정/로그아웃 드롭다운을 연다(사람 모양은 계정 정보 화면의 내 계정 표시로 옮김, 2026-10-27 피드백).
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
 * 관리자 계정은 처리할 일(신고·문의·승인 대기)이 1건 이상이면 아바타에 빨간 점, "관리자" 줄에 건수가 붙는다(utils/adminPending.js).
 */
function AccountMenu({ user, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile, onOpenAdmin, onOpenInquiry }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pending = useAdminPending(user?.role === 'admin');
  const pendingTotal = pending?.total || 0;
  const menuLabel = user?.name ? t('account.menuNamed', { name: user.name }) : t('account.menu');

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
        title={menuLabel}
        aria-label={pendingTotal > 0 ? `${menuLabel}, ${t('account.adminPending', { n: pendingTotal })}` : undefined}
      >
        <IconSettings />
      </button>
      {pendingTotal > 0 && <span className="account-avatar-dot" aria-hidden="true" />}
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
                aria-label={pendingTotal > 0 ? `${t('account.admin')}, ${t('account.adminPending', { n: pendingTotal })}` : undefined}
              >
                {t('account.admin')}
                {pendingTotal > 0 && (
                  <span className="account-menu-count" aria-hidden="true">
                    {pendingTotal > 99 ? '99+' : pendingTotal}
                  </span>
                )}
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
