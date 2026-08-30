import React, { useEffect, useState } from 'react';
import { getMe, updateProfile, changePassword, deleteAccount, getLatestConfirmedRoadmap } from '../api/chatApi.js';
import { IconChevronLeft } from '../components/icons.jsx';
import CareerRoadmapList from '../components/CareerRoadmapList.jsx';

// Home.jsx와 동일한 이유(재진입 시 빈 화면 깜빡임 방지)로 모듈 스코프에 캐시해둔다.
let cachedLeaveSemesters = null;

// confirmedRoadmap은 "확정한 진로 없음"도 유효한 응답(null)이라 leaveSemesters처럼
// null을 "캐시 없음" 마커로 못 쓴다 — undefined로 "아직 조회 전"을 구분한다.
let cachedConfirmedRoadmap;

// Home.jsx의 resetHomeCache와 동일한 이유 — 로그아웃/계정 삭제 시 App.jsx가 호출.
export function resetProfileCache() {
  cachedLeaveSemesters = null;
  cachedConfirmedRoadmap = undefined;
}

/**
 * Profile Page
 * 개인정보 수정 — 이름 변경, 휴학 학기 수(학년 계산 보정용), 비밀번호 변경,
 * 계정 삭제(하드 삭제, 되돌릴 수 없음).
 *
 * Props:
 * - user: object
 * - onGoHome: function
 * - onNameChanged: function(name) — App.jsx의 user 상태 동기화용
 * - onAccountDeleted: function — 삭제 성공 시(서버에서 세션도 함께 파기됨) 로그인 화면으로 되돌림
 * - highlightLeaveSemesters: boolean — 홈의 "학년이 다르신가요?" 링크로 들어왔을 때만 true,
 *   휴학 학기 수 카드에 강조 애니메이션을 준다.
 */
function Profile({ user, onGoHome, onNameChanged, onAccountDeleted, highlightLeaveSemesters }) {
  const [name, setName] = useState(user?.name || '');
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState(null);

  const [leaveSemesters, setLeaveSemesters] = useState(cachedLeaveSemesters ?? '');
  const [leaveSemestersLoading, setLeaveSemestersLoading] = useState(cachedLeaveSemesters === null);
  const [leaveSemestersSaved, setLeaveSemestersSaved] = useState(false);
  const [leaveSemestersError, setLeaveSemestersError] = useState(null);

  useEffect(() => {
    getMe()
      .then((data) => {
        const value = String(data.leaveSemesters ?? 0);
        setLeaveSemesters(value);
        cachedLeaveSemesters = value;
      })
      .catch(() => setLeaveSemestersError('정보를 불러오지 못했어요.'))
      .finally(() => setLeaveSemestersLoading(false));
  }, []);

  // "다시 진단하기"로 새 진로 탐색 세션을 시작하면 이전에 확정한 로드맵을 다시 볼 방법이
  // 없어지는 문제(실사용 피드백) — 세션 상태와 무관하게 가장 최근 확정 결과를 여기서 보여준다.
  const [confirmedRoadmap, setConfirmedRoadmap] = useState(cachedConfirmedRoadmap ?? null);
  const [confirmedRoadmapLoading, setConfirmedRoadmapLoading] = useState(cachedConfirmedRoadmap === undefined);
  const [roadmapExpanded, setRoadmapExpanded] = useState(false);

  useEffect(() => {
    getLatestConfirmedRoadmap()
      .then((data) => {
        setConfirmedRoadmap(data);
        cachedConfirmedRoadmap = data;
      })
      .catch(() => {
        setConfirmedRoadmap(null);
        cachedConfirmedRoadmap = null;
      })
      .finally(() => setConfirmedRoadmapLoading(false));
  }, []);

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

  async function handleSaveLeaveSemesters() {
    setLeaveSemestersError(null);
    setLeaveSemestersSaved(false);
    const value = Number(leaveSemesters);
    if (!Number.isInteger(value) || value < 0) {
      setLeaveSemestersError('0 이상의 정수를 입력해주세요.');
      return;
    }
    try {
      await updateProfile({ leaveSemesters: value });
      setLeaveSemestersSaved(true);
    } catch {
      setLeaveSemestersError('저장에 실패했어요.');
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

        {confirmedRoadmapLoading ? (
          <section className="home-card">
            <p className="home-card-label">확정한 진로</p>
            <div className="skeleton skeleton-text skeleton-row" style={{ height: 38 }} />
          </section>
        ) : (
          confirmedRoadmap && (
            <section className="home-card">
              <p className="home-card-label">확정한 진로</p>
              <div className="settings-inline-field">
                <span className="profile-career-name">{confirmedRoadmap.confirmedCareer}</span>
                <button className="settings-theme-btn" onClick={() => setRoadmapExpanded((v) => !v)}>
                  {roadmapExpanded ? '로드맵 접기' : '로드맵 보기'}
                </button>
              </div>
              {roadmapExpanded && (
                <div className="profile-roadmap-list">
                  <CareerRoadmapList roadmap={confirmedRoadmap.roadmap} />
                </div>
              )}
            </section>
          )
        )}

        <section className={highlightLeaveSemesters ? 'home-card settings-highlight' : 'home-card'}>
          <p className="home-card-label">휴학 학기 수</p>
          <p className="settings-field-hint">
            입학년도만으로는 휴학 여부를 알 수 없어 홈 화면의 학년 표시가 실제보다 높게 나올 수 있어요.
            누적 휴학 학기 수를 입력하면 보정해요.
          </p>
          {leaveSemestersLoading ? (
            <div className="skeleton skeleton-text skeleton-row" style={{ height: 38 }} />
          ) : (
            <div className="settings-inline-field">
              <input
                type="number"
                min="0"
                step="1"
                className="onb-select"
                value={leaveSemesters}
                onChange={(e) => {
                  setLeaveSemesters(e.target.value);
                  setLeaveSemestersSaved(false);
                }}
              />
              <button className="settings-theme-btn" onClick={handleSaveLeaveSemesters}>
                저장
              </button>
            </div>
          )}
          {leaveSemestersError && <p className="home-error">{leaveSemestersError}</p>}
          {leaveSemestersSaved && <p className="settings-field-hint">저장했어요.</p>}
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
