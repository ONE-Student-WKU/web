import React, { useState } from 'react';
import { updateProfile, changePassword, deleteAccount } from '../api/chatApi.js';
import { IconChevronLeft } from '../components/icons.jsx';

/**
 * Profile Page
 * 개인정보 수정 — 이름 변경, 비밀번호 변경, 계정 삭제(하드 삭제, 되돌릴 수 없음).
 *
 * Props:
 * - user: object
 * - onGoHome: function
 * - onNameChanged: function(name) — App.jsx의 user 상태 동기화용
 * - onAccountDeleted: function — 삭제 성공 시(서버에서 세션도 함께 파기됨) 로그인 화면으로 되돌림
 */
function Profile({ user, onGoHome, onNameChanged, onAccountDeleted }) {
  const [name, setName] = useState(user?.name || '');
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState(null);

  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function handleSaveName(e) {
    e.preventDefault();
    setNameError(null);
    setNameSaved(false);
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('이름을 입력해주세요.');
      return;
    }
    try {
      await updateProfile({ name: trimmed });
      onNameChanged?.(trimmed);
      setNameSaved(true);
    } catch {
      setNameError('저장에 실패했어요.');
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);
    if (newPassword.length < 8) {
      setPasswordError('새 비밀번호는 8자 이상이어야 해요.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('새 비밀번호가 서로 달라요.');
      return;
    }
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(
        err.code === 'INVALID_CURRENT_PASSWORD' ? '현재 비밀번호가 올바르지 않아요.' : '비밀번호 변경에 실패했어요.'
      );
    }
  }

  async function handleDeleteAccount(e) {
    e.preventDefault();
    setDeleteError(null);
    if (!deletePassword) {
      setDeleteError('비밀번호를 입력해주세요.');
      return;
    }
    if (!window.confirm('정말 계정을 삭제할까요? 수강 이력, 대화 기록을 포함한 모든 데이터가 사라지고 되돌릴 수 없어요.')) {
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount(deletePassword);
      onAccountDeleted();
    } catch (err) {
      setDeleteError(err.code === 'INVALID_PASSWORD' ? '비밀번호가 올바르지 않아요.' : '삭제에 실패했어요.');
      setDeleting(false);
    }
  }

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label="홈으로">
            <IconChevronLeft />
          </button>
          <span className="screen-title">개인정보 수정</span>
        </div>
      </header>

      <div className="courses-body">
        <section className="home-card">
          <p className="home-card-label">이름</p>
          <form className="settings-inline-field" onSubmit={handleSaveName}>
            <input
              type="text"
              className="onb-select"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameSaved(false);
              }}
            />
            <button type="submit" className="settings-theme-btn">
              저장
            </button>
          </form>
          {nameError && <p className="home-error">{nameError}</p>}
          {nameSaved && <p className="settings-field-hint">저장했어요.</p>}
        </section>

        <section className="home-card">
          <p className="home-card-label">비밀번호 변경</p>
          <form onSubmit={handleChangePassword}>
            <div className="auth-field">
              <label>현재 비밀번호</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="auth-field">
              <label>새 비밀번호</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            </div>
            <div className="auth-field">
              <label>새 비밀번호 확인</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            {passwordError && <p className="home-error">{passwordError}</p>}
            {passwordSaved && <p className="settings-field-hint">비밀번호를 변경했어요.</p>}
            <button type="submit" className="auth-submit-btn">
              비밀번호 변경
            </button>
          </form>
        </section>

        <section className="home-card profile-danger-zone">
          <p className="home-card-label">계정 삭제</p>
          <p className="settings-field-hint">
            계정을 삭제하면 수강 이력, 대화 기록 등 모든 데이터가 함께 삭제되고 되돌릴 수 없어요.
          </p>
          <form onSubmit={handleDeleteAccount}>
            <div className="auth-field">
              <label>비밀번호 확인</label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                required
              />
            </div>
            {deleteError && <p className="home-error">{deleteError}</p>}
            <button type="submit" className="profile-delete-btn" disabled={deleting}>
              {deleting ? '삭제하는 중...' : '계정 삭제'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

export default Profile;
