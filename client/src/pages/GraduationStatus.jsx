import React, { useEffect, useState } from 'react';
import { getGraduationStatus } from '../api/chatApi.js';
import AccountMenu from '../components/AccountMenu.jsx';
import { IconChevronLeft, IconCheck } from '../components/icons.jsx';
import { summarizeShortfalls, mergeMajorCategories, buildRequirementGroups, getProgressColor, getPercent, describeRequirementTrust } from '../utils/graduation.js';
import { readCache, writeCache, clearCache } from '../utils/sessionCache.js';
import { cleanRequirementNote } from '../utils/displayText.js';

// Home.jsx와 동일한 이유(재진입 시 빈 화면 깜빡임 방지)로 모듈 스코프에 마지막으로
// 불러온 졸업요건 데이터를 캐시해둔다. sessionStorage에서 초기값을 복원해서, 탭이 살아있는
// 채로 페이지가 다시 로드되는 경우(utils/sessionCache.js 참고)에도 즉시 보여줄 수 있다.
let cachedStatus = readCache('graduation_status');

// Home.jsx의 resetHomeCache와 동일한 이유 — 로그아웃/계정 삭제 시 App.jsx가 호출.
// eslint-disable-next-line react-refresh/only-export-components -- App.jsx가 재사용하는 캐시 리셋 함수라 의도적으로 컴포넌트와 같이 export함.
export function resetGraduationCache() {
  cachedStatus = null;
  clearCache('graduation_status');
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
function GraduationStatus({ user, onGoHome, onOpenCourses, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile, onOpenAdmin, onOpenInquiry }) {
  const [status, setStatus] = useState(cachedStatus);
  const [loading, setLoading] = useState(cachedStatus === null);
  const [error, setError] = useState(null);
  const [onboardingRequired, setOnboardingRequired] = useState(false);

  useEffect(() => {
    getGraduationStatus()
      .then((data) => {
        setStatus(data);
        cachedStatus = data;
        writeCache('graduation_status', data);
      })
      .catch((err) => {
        if (err.code === 'ONBOARDING_REQUIRED') {
          setOnboardingRequired(true);
        } else {
          setError('졸업요건 정보를 불러오지 못했어요. 새로고침 후 다시 시도해주세요.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // 요건 자료가 없으면 총 요구학점이 0이라 0으로 나누면 NaN%가 됐다 — 이 경우는 아래에서 "진단할 수 없어요" 안내로 대신한다.
  // trust는 서버(규정 판단 엔진)가 내려준 근거 신뢰도·사유를 화면용으로 정리한 것(utils/graduation.js).
  const trust = status ? describeRequirementTrust(status) : null;
  const remaining = status ? Math.max(0, status.totalRequiredCredits - status.totalEarnedCredits) : 0;
  const progressPercent = status && status.totalRequiredCredits > 0
    ? getPercent(status.totalEarnedCredits, status.totalRequiredCredits)
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
          onOpenAdmin={onOpenAdmin}
          onOpenInquiry={onOpenInquiry}
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

        {status && trust.noData && (
          <section className="home-card grad-empty-notice">
            <p className="grad-empty-notice-text">
              이 학과·학번의 졸업요건 자료가 아직 없어서 진단할 수 없어요. 학과 또는 학사지원과에 확인해주세요.
            </p>
            {trust.badge && <span className={`grad-trust-badge ${trust.badge.level}`}>{trust.badge.label}</span>}
            {trust.reason && <p className="grad-trust-reason">{trust.reason}</p>}
          </section>
        )}

        {status && !trust.noData && status.totalEarnedCredits === 0 && (
          <section className="home-card grad-empty-notice">
            <p className="grad-empty-notice-text">
              아직 등록된 과목이 없어서 정확한 진단이 어려워요. 과목 관리에서 수강 이력을 먼저 채워주세요.
            </p>
            <button className="auth-submit-btn" onClick={onOpenCourses}>
              과목 관리로 이동
            </button>
          </section>
        )}

        {status && !trust.noData && (
          <>
            <section className="home-card">
              <p className="home-card-label">
                전체 이수학점
                {trust.badge && <span className={`grad-trust-badge ${trust.badge.level}`}>{trust.badge.label}</span>}
              </p>
              <div className="home-credit-value">
                <span className="home-credit-number">{status.totalEarnedCredits}</span>
                <span className="home-credit-total"> / {status.totalRequiredCredits}학점</span>
                {trust.totalEstimated && <span className="grad-trust-tag">(추정)</span>}
              </div>
              {trust.reason && <p className="grad-trust-reason">{trust.reason}</p>}
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
                    {getPercent(groups.major.earnedCredits, groups.major.requiredCredits)}%
                  </span>
                </div>
                <div className="home-progress-track">
                  <div
                    className="home-progress-fill"
                    style={{
                      width: `${getPercent(groups.major.earnedCredits, groups.major.requiredCredits)}%`,
                      backgroundColor: getProgressColor(
                        getPercent(groups.major.earnedCredits, groups.major.requiredCredits)
                      ),
                    }}
                  />
                </div>
                {groups.major.earnedCredits > groups.major.requiredCredits && (
                  <p className="grad-overflow-note">요건보다 많이 이수했어요 — 초과분은 다른 요건 충족에 도움이 돼요.</p>
                )}
                {groups.major.baseSatisfied !== null && (
                  <div className="grad-subcheck-row">
                    <span className={groups.major.baseSatisfied ? 'grad-cert-check satisfied' : 'grad-cert-check'}>
                      {groups.major.baseSatisfied && <IconCheck size={11} />}
                    </span>
                    <p className="grad-subcheck-label">기본전공 {groups.major.baseSatisfied ? '충족' : '미충족'}</p>
                  </div>
                )}
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
                    {getPercent(groups.liberalArts.earnedCredits, groups.liberalArts.requiredCredits)}%
                  </span>
                </div>
                <div className="home-progress-track">
                  <div
                    className="home-progress-fill"
                    style={{
                      width: `${getPercent(groups.liberalArts.earnedCredits, groups.liberalArts.requiredCredits)}%`,
                      backgroundColor: getProgressColor(
                        getPercent(groups.liberalArts.earnedCredits, groups.liberalArts.requiredCredits)
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
                        <p className="grad-cert-desc">{cleanRequirementNote(cert.description)}</p>
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
