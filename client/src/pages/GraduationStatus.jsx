import React, { useEffect, useState } from 'react';
import { getGraduationStatus } from '../api/chatApi.js';
import AccountMenu from '../components/AccountMenu.jsx';
import { IconChevronLeft, IconCheck } from '../components/icons.jsx';
import { summarizeShortfalls, mergeMajorCategories, buildRequirementGroups, getProgressColor } from '../utils/graduation.js';

// Home.jsx와 동일한 이유(재진입 시 빈 화면 깜빡임 방지)로 모듈 스코프에 마지막으로
// 불러온 졸업요건 데이터를 캐시해둔다.
let cachedStatus = null;

// Home.jsx의 resetHomeCache와 동일한 이유 — 로그아웃/계정 삭제 시 App.jsx가 호출.
export function resetGraduationCache() {
  cachedStatus = null;
}

/**
 * GraduationStatus Page
 * 졸업요건 진단 — 전체 이수학점 진행률, 카테고리별 이수 현황, 졸업논문/졸업인증제 충족 여부.
 *
 * Props:
 * - user: object
 * - onGoHome: function
 * - onLogout: function
 * - onOpenSettings: function
 * - onOpenOnboarding: function
 * - onOpenProfile: function
 */
function GraduationStatus({ user, onGoHome, onOpenCourses, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile }) {
  const [status, setStatus] = useState(cachedStatus);
  const [loading, setLoading] = useState(cachedStatus === null);
  const [error, setError] = useState(null);
  const [onboardingRequired, setOnboardingRequired] = useState(false);

  useEffect(() => {
    getGraduationStatus()
      .then((data) => {
        setStatus(data);
        cachedStatus = data;
      })
      .catch((err) => {
        if (err.code === 'ONBOARDING_REQUIRED') {
          setOnboardingRequired(true);
        } else {
          setError('졸업요건 정보를 불러오지 못했어요.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const remaining = status ? Math.max(0, status.totalRequiredCredits - status.totalEarnedCredits) : 0;
  const progressPercent = status
    ? Math.min(100, Math.round((status.totalEarnedCredits / status.totalRequiredCredits) * 100))
    : 0;
  const shortfalls = status ? summarizeShortfalls(mergeMajorCategories(status.categories), status.certifications) : [];
  const groups = status ? buildRequirementGroups(status.categories) : null;
  // 일반선택은 전공도 교양도 아니라 두 카드 어디에도 안 붙이고, "총량을 채우는 데 쓰인
  // 학점"이라는 원래 성격에 맞게 전체 이수학점 카드 쪽에 참고로만 붙인다.
  const generalElectiveCredits = status?.categories.find((c) => c.category === '일반선택')?.earnedCredits ?? 0;

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label="홈으로">
            <IconChevronLeft />
          </button>
          <span className="screen-title">졸업요건 진단</span>
        </div>
        <AccountMenu
          user={user}
          onLogout={onLogout}
          onOpenSettings={onOpenSettings}
          onOpenOnboarding={onOpenOnboarding}
          onOpenProfile={onOpenProfile}
        />
      </header>

      <div className="courses-body">
        {error && <p className="home-error">{error}</p>}
        {onboardingRequired && <p className="home-error">학과·학번 정보를 먼저 등록해야 진단할 수 있어요.</p>}

        {loading && !status && (
          <>
            <div className="home-card skeleton-card">
              <div className="skeleton skeleton-text skeleton-label" />
              <div className="skeleton skeleton-text skeleton-credit" />
              <div className="skeleton skeleton-bar" />
            </div>
            <div className="home-card skeleton-card">
              <div className="skeleton skeleton-text skeleton-label" />
              <div className="skeleton skeleton-bar" />
            </div>
          </>
        )}

        {status && status.totalEarnedCredits === 0 && (
          <section className="home-card grad-empty-notice">
            <p className="grad-empty-notice-text">
              아직 등록된 과목이 없어서 정확한 진단이 어려워요. 과목 관리에서 수강 이력을 먼저 채워주세요.
            </p>
            <button className="auth-submit-btn" onClick={onOpenCourses}>
              과목 관리로 이동
            </button>
          </section>
        )}

        {status && (
          <>
            <section className="home-card">
              <p className="home-card-label">전체 이수학점</p>
              <div className="home-credit-value">
                <span className="home-credit-number">{status.totalEarnedCredits}</span>
                <span className="home-credit-total"> / {status.totalRequiredCredits}학점</span>
              </div>
              <div className="home-progress-track">
                <div
                  className="home-progress-fill"
                  style={{ width: `${progressPercent}%`, backgroundColor: getProgressColor(progressPercent) }}
                />
              </div>
              <p className="grad-remaining-text">
                {progressPercent}% ·{' '}
                {remaining > 0 ? `졸업까지 ${remaining}학점 남음` : '졸업 학점을 모두 채웠어요'}
              </p>
              {generalElectiveCredits > 0 && (
                <p className="grad-flex-note">그 중 일반선택으로 {generalElectiveCredits}학점 포함</p>
              )}
            </section>

            <p className="home-quick-label">전공·교양 이수 현황</p>

            {groups?.major && (
              <section className="home-card">
                <div className="grad-category-row">
                  <p className="home-card-label">전공</p>
                  <span
                    className={
                      groups.major.earnedCredits >= groups.major.requiredCredits
                        ? 'grad-category-value satisfied'
                        : 'grad-category-value'
                    }
                  >
                    {groups.major.earnedCredits} / {groups.major.requiredCredits}학점 ·{' '}
                    {Math.round((groups.major.earnedCredits / groups.major.requiredCredits) * 100)}%
                  </span>
                </div>
                <div className="home-progress-track">
                  <div
                    className="home-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.round((groups.major.earnedCredits / groups.major.requiredCredits) * 100))}%`,
                      backgroundColor: getProgressColor(
                        Math.round((groups.major.earnedCredits / groups.major.requiredCredits) * 100)
                      ),
                    }}
                  />
                </div>
                {groups.major.earnedCredits > groups.major.requiredCredits && (
                  <p className="grad-overflow-note">요건보다 많이 이수했어요 — 초과분은 다른 요건 충족에 도움이 돼요.</p>
                )}
                <div className="grad-subcheck-row">
                  <span className={groups.major.baseSatisfied ? 'grad-cert-check satisfied' : 'grad-cert-check'}>
                    {groups.major.baseSatisfied && <IconCheck size={11} />}
                  </span>
                  <p className="grad-subcheck-label">기본전공 {groups.major.baseSatisfied ? '충족' : '미충족'}</p>
                </div>
              </section>
            )}

            {groups?.liberalArts && (
              <section className="home-card">
                <div className="grad-category-row">
                  <p className="home-card-label">교양</p>
                  <span
                    className={
                      groups.liberalArts.earnedCredits >= groups.liberalArts.requiredCredits
                        ? 'grad-category-value satisfied'
                        : 'grad-category-value'
                    }
                  >
                    {groups.liberalArts.earnedCredits} / {groups.liberalArts.requiredCredits}학점 ·{' '}
                    {Math.round((groups.liberalArts.earnedCredits / groups.liberalArts.requiredCredits) * 100)}%
                  </span>
                </div>
                <div className="home-progress-track">
                  <div
                    className="home-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.round((groups.liberalArts.earnedCredits / groups.liberalArts.requiredCredits) * 100))}%`,
                      backgroundColor: getProgressColor(
                        Math.round((groups.liberalArts.earnedCredits / groups.liberalArts.requiredCredits) * 100)
                      ),
                    }}
                  />
                </div>
                {groups.liberalArts.earnedCredits > groups.liberalArts.requiredCredits && (
                  <p className="grad-overflow-note">요건보다 많이 이수했어요 — 초과분은 다른 요건 충족에 도움이 돼요.</p>
                )}
                <div className="grad-subcheck-row">
                  <span className={groups.liberalArts.requiredSatisfied ? 'grad-cert-check satisfied' : 'grad-cert-check'}>
                    {groups.liberalArts.requiredSatisfied && <IconCheck size={11} />}
                  </span>
                  <p className="grad-subcheck-label">
                    교양필수 {groups.liberalArts.requiredSatisfied ? '충족' : '미충족'}
                  </p>
                </div>
                <p className="grad-flex-note">교양선택 {groups.liberalArts.electiveEarnedCredits}학점 이수</p>
              </section>
            )}

            {status.certifications.length > 0 && (
              <>
                <p className="home-quick-label">졸업논문·졸업인증제</p>
                {status.certifications.map((cert) => (
                  <section className="home-card" key={cert.category}>
                    <div className="grad-cert-row">
                      <span className={cert.satisfied ? 'grad-cert-check satisfied' : 'grad-cert-check'}>
                        {cert.satisfied && <IconCheck size={11} />}
                      </span>
                      <div>
                        <p className="home-card-label">{cert.category}</p>
                        <p className="grad-cert-desc">{cert.description}</p>
                      </div>
                    </div>
                  </section>
                ))}
              </>
            )}

            <section className={shortfalls.length > 0 ? 'grad-shortfall-box' : 'grad-shortfall-box ok'}>
              <p className="home-card-label">부족 요건 요약</p>
              {shortfalls.length > 0 ? (
                <ul className="grad-shortfall-list">
                  {shortfalls.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p>모든 요건을 충족했어요!</p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default GraduationStatus;
