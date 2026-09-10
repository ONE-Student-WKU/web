import React, { useEffect, useState } from 'react';
import {
  updateProfile,
  deleteAccount,
  startGoogleReauth,
  requestDeleteReauthCode,
  verifyDeleteReauthCode,
  getLatestConfirmedRoadmap,
} from '../api/chatApi.js';
import { IconChevronLeft } from '../components/icons.jsx';
import CareerRoadmapList from '../components/CareerRoadmapList.jsx';

// 이메일 재인증 요청/확인 실패 코드는 서버(server/routes/auth.js)가 내려주는 err.code
// 기준 — Login.jsx의 describeEmailError와 같은 코드 집합을 다루되 문구는 재인증 맥락에 맞춤.
function describeReauthError(code) {
  if (code === 'NOT_FOUND') return '인증코드를 다시 요청해주세요.';
  if (code === 'INVALID_CODE') return '인증코드가 올바르지 않아요.';
  if (code === 'TOO_MANY_ATTEMPTS') return '시도 횟수를 초과했어요. 인증코드를 다시 요청해주세요.';
  return '요청에 실패했어요. 잠시 후 다시 시도해주세요.';
}

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

  // 이메일 OTP 전용 계정(user.hasGoogleAccount === false)의 삭제 재인증 — 구글처럼 풀 페이지
  // 왕복이 아니라 이 화면 안에서 코드 요청/확인이 끝나므로, justReauthenticated(구글 재인증
  // 전용 플래그)와 별개로 로컬 상태로 관리한다. 둘 중 하나만 true여도 삭제 폼을 보여준다.
  const [emailReauthStep, setEmailReauthStep] = useState('idle'); // 'idle' | 'code'
  const [emailReauthCode, setEmailReauthCode] = useState('');
  const [emailReauthError, setEmailReauthError] = useState(null);
  const [emailReauthSubmitting, setEmailReauthSubmitting] = useState(false);
  const [emailReauthenticated, setEmailReauthenticated] = useState(false);

  async function handleRequestEmailReauthCode() {
    setEmailReauthError(null);
    setEmailReauthSubmitting(true);
    try {
      await requestDeleteReauthCode();
      setEmailReauthStep('code');
    } catch {
      setEmailReauthError('인증코드 발송에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setEmailReauthSubmitting(false);
    }
  }

  async function handleVerifyEmailReauthCode(e) {
    e.preventDefault();
    setEmailReauthError(null);
    setEmailReauthSubmitting(true);
    try {
      await verifyDeleteReauthCode(emailReauthCode.trim());
      setEmailReauthenticated(true);
    } catch (err) {
      setEmailReauthError(describeReauthError(err.code));
    } finally {
      setEmailReauthSubmitting(false);
    }
  }

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
          {justReauthenticated || emailReauthenticated ? (
            <form onSubmit={handleDeleteAccount}>
              {deleteError && <p className="home-error">{deleteError}</p>}
              <button type="submit" className="profile-delete-btn" disabled={deleting}>
                {deleting ? '삭제하는 중...' : '계정 삭제'}
              </button>
            </form>
          ) : user?.hasGoogleAccount ? (
            <button type="button" className="settings-theme-btn" onClick={startGoogleReauth}>
              다시 로그인해서 확인
            </button>
          ) : emailReauthStep === 'idle' ? (
            <>
              {emailReauthError && <p className="home-error">{emailReauthError}</p>}
              <button
                type="button"
                className="settings-theme-btn"
                onClick={handleRequestEmailReauthCode}
                disabled={emailReauthSubmitting}
              >
                {emailReauthSubmitting ? '전송 중...' : '인증코드 받고 확인'}
              </button>
            </>
          ) : (
            <form onSubmit={handleVerifyEmailReauthCode}>
              <p className="settings-field-hint">가입한 이메일로 인증코드를 보냈어요. 15분 이내에 입력해주세요.</p>
              <div className="settings-inline-field">
                <input
                  type="text"
                  className="onb-select"
                  inputMode="numeric"
                  placeholder="6자리 숫자"
                  value={emailReauthCode}
                  onChange={(e) => setEmailReauthCode(e.target.value)}
                  required
                />
                <button type="submit" className="settings-theme-btn" disabled={emailReauthSubmitting}>
                  {emailReauthSubmitting ? '확인 중...' : '확인'}
                </button>
              </div>
              {emailReauthError && <p className="home-error">{emailReauthError}</p>}
              <button
                type="button"
                className="settings-theme-btn"
                onClick={handleRequestEmailReauthCode}
                disabled={emailReauthSubmitting}
              >
                인증코드 다시 받기
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

export default Profile;
