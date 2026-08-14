import React, { useEffect, useState } from 'react';
import { getGraduationStatus } from '../api/chatApi.js';
import AccountMenu from '../components/AccountMenu.jsx';
import { summarizeShortfalls } from '../utils/graduation.js';

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
 */
function GraduationStatus({ user, onGoHome, onLogout, onOpenSettings, onOpenOnboarding }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [onboardingRequired, setOnboardingRequired] = useState(false);

  useEffect(() => {
    getGraduationStatus()
      .then(setStatus)
      .catch((err) => {
        if (err.code === 'ONBOARDING_REQUIRED') {
          setOnboardingRequired(true);
        } else {
          setError('졸업요건 정보를 불러오지 못했어요.');
        }
      });
  }, []);

  const remaining = status ? Math.max(0, status.totalRequiredCredits - status.totalEarnedCredits) : 0;
  const progressPercent = status
    ? Math.min(100, Math.round((status.totalEarnedCredits / status.totalRequiredCredits) * 100))
    : 0;
  const shortfalls = status ? summarizeShortfalls(status.categories, status.certifications) : [];

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label="홈으로">
            ‹
          </button>
          <span className="screen-title">졸업요건 진단</span>
        </div>
        <AccountMenu
          user={user}
          onLogout={onLogout}
          onOpenSettings={onOpenSettings}
          onOpenOnboarding={onOpenOnboarding}
        />
      </header>

      <div className="courses-body">
        {error && <p className="home-error">{error}</p>}
        {onboardingRequired && <p className="home-error">학과·학번 정보를 먼저 등록해야 진단할 수 있어요.</p>}

        {status && (
          <>
            <section className="home-card">
              <p className="home-card-label">전체 이수학점</p>
              <div className="home-credit-value">
                <span className="home-credit-number">{status.totalEarnedCredits}</span>
                <span className="home-credit-total"> / {status.totalRequiredCredits}학점</span>
              </div>
              <div className="home-progress-track">
                <div className="home-progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <p className="grad-remaining-text">
                {remaining > 0 ? `졸업까지 ${remaining}학점 남음` : '졸업 학점을 모두 채웠어요'}
              </p>
            </section>

            <p className="home-quick-label">카테고리별 이수 현황</p>
            {status.categories.map((c) => {
              const satisfied = c.earnedCredits >= c.requiredCredits;
              const rawPercent = c.requiredCredits > 0 ? Math.round((c.earnedCredits / c.requiredCredits) * 100) : 100;
              const barPercent = Math.min(100, rawPercent);
              const hasOverflow = c.earnedCredits > c.requiredCredits;
              return (
                <section className="home-card" key={c.category}>
                  <div className="grad-category-row">
                    <p className="home-card-label">
                      {c.category}
                      {c.requiredCourses?.length > 0 && (
                        <span className="grad-category-courses"> ({c.requiredCourses.join(', ')})</span>
                      )}
                    </p>
                    <span className={satisfied ? 'grad-category-value satisfied' : 'grad-category-value'}>
                      {c.earnedCredits} / {c.requiredCredits}학점 · {rawPercent}%
                    </span>
                  </div>
                  <div className="home-progress-track">
                    <div
                      className={satisfied ? 'home-progress-fill satisfied' : 'home-progress-fill'}
                      style={{ width: `${barPercent}%` }}
                    />
                  </div>
                  {hasOverflow && (
                    <p className="grad-overflow-note">요건보다 많이 이수했어요 — 초과분은 다른 요건 충족에 도움이 돼요.</p>
                  )}
                </section>
              );
            })}

            {status.certifications.length > 0 && (
              <>
                <p className="home-quick-label">졸업논문·졸업인증제</p>
                {status.certifications.map((cert) => (
                  <section className="home-card" key={cert.category}>
                    <div className="grad-cert-row">
                      <span className={cert.satisfied ? 'grad-cert-check satisfied' : 'grad-cert-check'} />
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
