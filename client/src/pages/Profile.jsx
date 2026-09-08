import React, { useEffect, useState } from 'react';
import { updateProfile, deleteAccount, startGoogleReauth, getLatestConfirmedRoadmap } from '../api/chatApi.js';
import { IconChevronLeft } from '../components/icons.jsx';
import CareerRoadmapList from '../components/CareerRoadmapList.jsx';

// confirmedRoadmap은 "확정한 진로 없음"도 유효한 응답(null)이라 캐시 없음 마커로 null을
// 못 쓴다 — undefined로 "아직 조회 전"을 구분한다(Home.jsx와 동일한 이유로 재진입 시
// 빈 화면 깜빡임 방지용 모듈 스코프 캐시).
let cachedConfirmedRoadmap;

// Home.jsx의 resetHomeCache와 동일한 이유 — 로그아웃/계정 삭제 시 App.jsx가 호출.
// eslint-disable-next-line react-refresh/only-export-components -- App.jsx가 재사용하는 캐시 리셋 함수라 의도적으로 컴포넌트와 같이 export함.
export function resetProfileCache() {
  cachedConfirmedRoadmap = undefined;
}

/**
 * Profile Page
 * 계정 정보 수정 — 이름 변경, 계정 삭제(하드 삭제, 되돌릴 수 없음). 로그인이 Google OAuth로만
 * 이뤄지므로 비밀번호 변경 기능은 없음 — 계정 삭제는 Google 재인증(step-up)으로 확인한다.
 * 휴학 학기 수는 학과·학번 수정(Onboarding.jsx) 쪽으로 옮겨졌다 — 학과/학번과 서로 얽힌
 * 학적 데이터라 그쪽 요약 화면에서 같이 다루는 게 맞다는 판단(팀 논의, 2026-08-30).
 *
 * Props:
 * - user: object
 * - onGoHome: function
 * - onNameChanged: function(name) — App.jsx의 user 상태 동기화용
 * - onAccountDeleted: function — 삭제 성공 시(서버에서 세션도 함께 파기됨) 로그인 화면으로 되돌림
 * - justReauthenticated: boolean — Google 재인증 왕복 직후(App.jsx가 ?reauth=1 쿼리로 판단)인지.
 *   서버의 재인증 유효 시간(5분)과 별개로, 새로고침하면 다시 false가 되는 프론트 전용 플래그라
 *   실제 삭제 시점엔 서버가 다시 한번 유효성을 검사한다(REAUTH_REQUIRED).
 */
function Profile({ user, onGoHome, onNameChanged, onAccountDeleted, justReauthenticated }) {
  const [name, setName] = useState(user?.name || '');
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState(null);

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

  async function handleDeleteAccount(e) {
    e.preventDefault();
    setDeleteError(null);
    if (!window.confirm('정말 계정을 삭제할까요? 수강 이력, 대화 기록을 포함한 모든 데이터가 사라지고 되돌릴 수 없어요.')) {
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount();
      onAccountDeleted();
    } catch (err) {
      setDeleteError(
        err.code === 'REAUTH_REQUIRED' ? '재인증이 만료됐어요. 다시 로그인해서 확인해주세요.' : '삭제에 실패했어요.'
      );
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
          <span className="screen-title">계정 정보 수정</span>
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

        <section className="home-card profile-danger-zone">
          <p className="home-card-label">계정 삭제</p>
          <p className="settings-field-hint">
            계정을 삭제하면 수강 이력, 대화 기록 등 모든 데이터가 함께 삭제되고 되돌릴 수 없어요.
          </p>
          {!justReauthenticated ? (
            <button type="button" className="settings-theme-btn" onClick={startGoogleReauth}>
              다시 로그인해서 확인
            </button>
          ) : (
            <form onSubmit={handleDeleteAccount}>
              {deleteError && <p className="home-error">{deleteError}</p>}
              <button type="submit" className="profile-delete-btn" disabled={deleting}>
                {deleting ? '삭제하는 중...' : '계정 삭제'}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

export default Profile;
