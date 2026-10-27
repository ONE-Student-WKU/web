import React, { useEffect, useState } from 'react';
import {
  updateProfile,
  getLatestConfirmedRoadmap,
} from '../api/chatApi.js';
import { IconChevronLeft, IconUser } from '../components/icons.jsx';
import CareerRoadmapList from '../components/CareerRoadmapList.jsx';
import AccountDeleteSection from '../components/AccountDeleteSection.jsx';
import { readCache, writeCache, clearCache } from '../utils/sessionCache.js';
import { useI18n } from '../i18n/I18nContext.jsx';

// confirmedRoadmap은 "확정한 진로 없음"도 유효한 응답(null)이라 캐시 없음 마커로 null을
// 못 쓴다 — undefined로 "아직 조회 전"을 구분한다(Home.jsx와 동일한 이유로 재진입 시
// 빈 화면 깜빡임 방지용 모듈 스코프 캐시). sessionStorage는 JSON이라 undefined를 그대로
// 못 담으므로 { value }로 한 번 감싸서 저장하고, 꺼낼 때 감싼 적이 있었는지(=조회한 적
// 있는지)로 undefined와 null을 구분한다.
const cachedRoadmapWrapper = readCache('profile_confirmedRoadmap');
let cachedConfirmedRoadmap = cachedRoadmapWrapper === null ? undefined : cachedRoadmapWrapper.value;

// Home.jsx의 resetHomeCache와 동일한 이유 — 로그아웃/계정 삭제 시 App.jsx가 호출.
// eslint-disable-next-line react-refresh/only-export-components -- App.jsx가 재사용하는 캐시 리셋 함수라 의도적으로 컴포넌트와 같이 export함.
export function resetProfileCache() {
  cachedConfirmedRoadmap = undefined;
  clearCache('profile_confirmedRoadmap');
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
 * - onOpenOnboarding: function (선택) — "학과·학번 수정하기" 줄에서 학과·학번 수정 화면을 연다.
 * - justReauthenticated: boolean — Google 재인증 왕복 직후(App.jsx가 ?reauth=1 쿼리로 판단)인지.
 *   서버의 재인증 유효 시간(5분)과 별개로, 새로고침하면 다시 false가 되는 프론트 전용 플래그라
 *   실제 삭제 시점엔 서버가 다시 한번 유효성을 검사한다(REAUTH_REQUIRED).
 */
function Profile({ user, onGoHome, onNameChanged, onAccountDeleted, justReauthenticated, onOpenOnboarding }) {
  const { t } = useI18n();
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
        writeCache('profile_confirmedRoadmap', { value: data });
      })
      .catch(() => {
        setConfirmedRoadmap(null);
        cachedConfirmedRoadmap = null;
        writeCache('profile_confirmedRoadmap', { value: null });
      })
      .finally(() => setConfirmedRoadmapLoading(false));
  }, []);

  async function handleSaveName(e) {
    e.preventDefault();
    setNameError(null);
    setNameSaved(false);
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('profile.err.nameRequired'));
      return;
    }
    try {
      await updateProfile({ name: trimmed });
      onNameChanged?.(trimmed);
      setNameSaved(true);
    } catch (err) {
      if (err.code === 'DUPLICATE_NAME') setNameError(t('profile.err.duplicateName'));
      else if (err.code === 'RESERVED_NAME') setNameError(t('profile.err.reservedName'));
      else if (err.code === 'INVALID_NAME') setNameError(t('profile.err.nameInvalid'));
      else if (err.code === 'NAME_CONTACT_INFO') setNameError(t('profile.err.nameContactInfo'));
      else if (err.code === 'NAME_TOO_LONG') setNameError(t('profile.err.nameTooLong'));
      else setNameError(t('profile.err.saveFailed'));
    }
  }

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label={t('common.backHome')}>
            <IconChevronLeft />
          </button>
          <span className="screen-title">{t('profile.title')}</span>
        </div>
      </header>

      {/* 휴대폰 설정 화면처럼 맨 위에 내 계정, 아래에 묶음 목록(2026-10-22 개편). 계정 삭제는 맨 아래 한 줄을 눌러야 펼쳐진다. */}
      <div className="courses-body community-body">
        <div className="settings-page">
          <div className="profile-id">
            <span className="profile-id-avatar" aria-hidden="true">
              <IconUser size={28} />
            </span>
            <div className="profile-id-text">
              <b>{user?.name}</b>
              {(user?.department || user?.admissionYear) && (
                <span>{[user?.department, user?.admissionYear && t('profile.cohort', { year: user.admissionYear })].filter(Boolean).join(' · ')}</span>
              )}
            </div>
          </div>

          <section className="settings-group">
            <p className="settings-group-title">{t('profile.group.profile')}</p>
            <div className="settings-list">
              <form className="settings-row settings-row--stack" onSubmit={handleSaveName}>
                <label htmlFor="profile-name">{t('profile.name')}</label>
                <div className="settings-inline">
                  <input
                    id="profile-name"
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameSaved(false);
                    }}
                  />
                  <button type="submit" className="post-btn post-btn--ink" disabled={name.trim() === (user?.name || '')}>
                    {t('profile.save')}
                  </button>
                </div>
                {nameError ? (
                  <p className="home-error">{nameError}</p>
                ) : nameSaved ? (
                  <p className="settings-help settings-help--ok">{t('profile.saved')}</p>
                ) : (
                  <p className="settings-help">{t('profile.nameHelp')}</p>
                )}
              </form>

              {onOpenOnboarding && (
                <button type="button" className="settings-row" onClick={onOpenOnboarding}>
                  <span>{t('profile.dept')}</span>
                  <span className="settings-row-value">
                    {t('profile.deptEdit')}
                    <span className="settings-chevron" aria-hidden="true">
                      ›
                    </span>
                  </span>
                </button>
              )}

              {/* 확정한 진로는 받은 뒤 있을 때만 맨 아래에 붙인다 — 예전에는 받는 동안 스켈레톤 줄을 그렸다가, 진로를 확정하지 않은
                  대부분의 학생에게서 줄이 통째로 사라지며 아래 줄이 올라붙었다(2026-10-27 화면 점검). */}
              {!confirmedRoadmapLoading && confirmedRoadmap && (
                <>
                  <button type="button" className="settings-row" aria-expanded={roadmapExpanded} onClick={() => setRoadmapExpanded((v) => !v)}>
                    <span>{t('profile.career')}</span>
                    <span className="settings-row-value">
                      {confirmedRoadmap.confirmedCareer}
                      <span className={roadmapExpanded ? 'settings-chevron open' : 'settings-chevron'} aria-hidden="true">
                        ›
                      </span>
                    </span>
                  </button>
                  {roadmapExpanded && (
                    <div className="settings-row settings-row--stack profile-roadmap-list">
                      <CareerRoadmapList roadmap={confirmedRoadmap.roadmap} />
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="settings-group">
            <p className="settings-group-title">{t('profile.group.account')}</p>
            <div className="settings-list">
              <AccountDeleteSection user={user} justReauthenticated={justReauthenticated} onAccountDeleted={onAccountDeleted} />
            </div>
            <p className="settings-group-note">{t('profile.delete.desc')}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default Profile;
