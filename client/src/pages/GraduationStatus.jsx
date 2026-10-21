import React, { useEffect, useState } from 'react';
import { getGraduationStatus } from '../api/chatApi.js';
import AccountMenu from '../components/AccountMenu.jsx';
import { IconChevronLeft, IconCheck } from '../components/icons.jsx';
import { summarizeShortfalls, mergeMajorCategories, buildRequirementGroups, getPercent, describeRequirementTrust, translateCategory, registrationTermShortage, uncheckedRequirementKeys, certCourseRows } from '../utils/graduation.js';
import { readCache, writeCache, clearCache } from '../utils/sessionCache.js';
import { cleanRequirementNote } from '../utils/displayText.js';
import { useI18n } from '../i18n/I18nContext.jsx';

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
  const { t, lang } = useI18n();
  const [status, setStatus] = useState(cachedStatus);
  const [loading, setLoading] = useState(cachedStatus === null);
  // 번역 키를 저장해 두고 렌더에서 t()로 바꾼다 — 로딩 이펙트가 번역 함수에 의존하지 않게 하려는 것.
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
          setError('grad.err.load');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // 요건 자료가 없으면 총 요구학점이 0이라 0으로 나누면 NaN%가 됐다 — 이 경우는 아래에서 "진단할 수 없어요" 안내로 대신한다.
  // trust는 서버(규정 판단 엔진)가 내려준 근거 신뢰도·사유를 화면용으로 정리한 것(utils/graduation.js).
  const trust = status ? describeRequirementTrust(status, lang) : null;
  const remaining = status ? Math.max(0, status.totalRequiredCredits - status.totalEarnedCredits) : 0;
  const progressPercent = status && status.totalRequiredCredits > 0
    ? getPercent(status.totalEarnedCredits, status.totalRequiredCredits)
    : 0;
  const shortfalls = status ? summarizeShortfalls(mergeMajorCategories(status.categories), status.certifications, t, status.majorAreaCredits, status.liberalElectiveAreas, status.secondMajor) : [];
  const termShortage = registrationTermShortage(status, shortfalls);
  const groups = status ? buildRequirementGroups(status.categories, status.majorAreaCredits) : null;
  // 일반선택은 전공도 교양도 아니라 두 카드 어디에도 안 붙이고, "총량을 채우는 데 쓰인
  // 학점"이라는 원래 성격에 맞게 전체 이수학점 카드 쪽에 참고로만 붙인다.
  const generalElectiveCredits = status?.categories.find((c) => c.category === '일반선택')?.earnedCredits ?? 0;

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label={t('common.backHome')}>
            <IconChevronLeft />
          </button>
          <span className="screen-title">{t('nav.graduation')}</span>
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
        {error && <p className="home-error">{t(error)}</p>}
        {onboardingRequired && <p className="home-error">{t('grad.needOnboarding')}</p>}

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
              {t('grad.noData')}
            </p>
            {trust.badge && <span className={`grad-trust-badge ${trust.badge.level}`}>{trust.badge.label}</span>}
            {trust.reason && <p className="grad-trust-reason">{trust.reason}</p>}
          </section>
        )}

        {status && !trust.noData && status.totalEarnedCredits === 0 && (
          <section className="home-card grad-empty-notice">
            <p className="grad-empty-notice-text">
              {t('grad.noCourses')}
            </p>
            <button className="auth-submit-btn" onClick={onOpenCourses}>
              {t('grad.goCourses')}
            </button>
          </section>
        )}

        {status && !trust.noData && (
          <>
            <section className="home-card">
              <p className="home-card-label">
                {t('grad.totalLabel')}
                {trust.badge && <span className={`grad-trust-badge ${trust.badge.level}`}>{trust.badge.label}</span>}
              </p>
              <div className="home-credit-value">
                <span className="home-credit-number">{status.totalEarnedCredits}</span>
                <span className="home-credit-total">{t('grad.totalCredits', { total: status.totalRequiredCredits })}</span>
                {trust.totalEstimated && <span className="grad-trust-tag">{t('grad.estimated')}</span>}
              </div>
              {trust.reason && <p className="grad-trust-reason">{trust.reason}</p>}
              <div className="home-progress-track">
                <div
                  className="home-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="grad-remaining-text">
                {progressPercent}% ·{' '}
                {remaining > 0 ? t('grad.remaining', { n: remaining }) : t('grad.complete')}
              </p>
              {generalElectiveCredits > 0 && (
                <p className="grad-flex-note">{t('grad.generalElective', { n: generalElectiveCredits })}</p>
              )}
              {/* 졸업사정 등록기간(시행규칙 제118조 제1호) — 판정하지 않고 등록 학기만 알린다. 학점을 다 채웠는데 학기가 모자랄 때만 강조한다(#378 H-2). */}
              {status.registrationTerms && (
                termShortage > 0 ? (
                  <p className="grad-trust-reason">{t('grad.registrationShort', { n: termShortage })}</p>
                ) : (
                  <p className="grad-flex-note">
                    {t('grad.registrationTerms', { registered: status.registrationTerms.registered, required: status.registrationTerms.required })}
                    {status.registrationTerms.earlyGraduation && ` ${t('grad.registrationEarly', { n: status.registrationTerms.earlyGraduation })}`}
                    {status.registrationTerms.estimated && ` ${t('grad.registrationEstimated')}`}
                  </p>
                )
              )}
            </section>

            <p className="home-quick-label">{t('grad.sectionMajorLiberal')}</p>

            {groups?.major && (
              <section className="home-card">
                <div className="grad-category-row">
                  <p className="home-card-label">{t('grad.major')}</p>
                  <span
                    className={
                      groups.major.earnedCredits >= groups.major.requiredCredits
                        ? 'grad-category-value satisfied'
                        : 'grad-category-value'
                    }
                  >
                    {t('grad.groupCredits', {
                      earned: groups.major.earnedCredits,
                      required: groups.major.requiredCredits,
                      percent: getPercent(groups.major.earnedCredits, groups.major.requiredCredits),
                    })}
                  </span>
                </div>
                <div className="home-progress-track">
                  <div
                    className="home-progress-fill"
                    style={{
                      width: `${getPercent(groups.major.earnedCredits, groups.major.requiredCredits)}%`,
                    }}
                  />
                </div>
                {groups.major.earnedCredits > groups.major.requiredCredits && (
                  <p className="grad-overflow-note">{t('grad.overflow')}</p>
                )}
                {groups.major.baseSatisfied !== null && (
                  <div className="grad-subcheck-row">
                    <span className={groups.major.baseSatisfied ? 'grad-cert-check satisfied' : 'grad-cert-check'}>
                      {groups.major.baseSatisfied && <IconCheck size={11} />}
                    </span>
                    <p className="grad-subcheck-label">{groups.major.baseSatisfied ? t('grad.baseMet') : t('grad.baseUnmet')}</p>
                  </div>
                )}
                {/* 전과생: 전과 전 학과 전공 과목은 일반선택, 같은 과목은 인정 신청 시 전공선택(시행규칙 제3조 제4항·제115조, D-77) */}
                {status.priorMajorCourses && (status.priorMajorCourses.demoted.length > 0 || status.priorMajorCourses.recognized.length > 0) && (
                  <p className="grad-flex-note">
                    {t('grad.prior.demoted', { n: status.priorMajorCourses.demoted.reduce((s, c) => s + c.credits, 0) })}
                    {status.priorMajorCourses.recognized.length > 0
                      ? ` ${t('grad.prior.recognized', { n: status.priorMajorCourses.recognized.reduce((s, c) => s + c.credits, 0) })}`
                      : ` ${t(status.priorMajorCourses.recognitionApplied ? 'grad.prior.appliedNone' : 'grad.prior.notApplied')}`}
                  </p>
                )}
                {/* 광역 계열전공: 이수구분별 최소 학점(시행규칙 제7조 제3항)과 이수유형. 구분을 모르는 학점은 어느 구분에도 넣지 않는다(서버 computeMajorAreaCredits). */}
                {status.majorAreaCredits && (
                  <>
                    {status.majorAreaCredits.areas.map((a) => (
                      <div className="grad-subcheck-row" key={a.area}>
                        <span className={a.satisfied ? 'grad-cert-check satisfied' : 'grad-cert-check'}>
                          {a.satisfied && <IconCheck size={11} />}
                        </span>
                        <p className="grad-subcheck-label">{t('grad.majorArea', { area: translateCategory(a.area, t), earned: a.earned, required: a.required })}</p>
                      </div>
                    ))}
                    {status.majorAreaCredits.unknownCredits > 0 && (
                      <p className="grad-flex-note">{t('grad.majorAreaUnknown', { n: status.majorAreaCredits.unknownCredits })}</p>
                    )}
                    <p className="grad-flex-note">{t('grad.majorTrackType', { type: status.majorTrackType ? t(`trackType.${status.majorTrackType}`) : t('grad.majorTrackTypeNone') })}</p>
                  </>
                )}
              </section>
            )}

            {/* 다전공(복수전공·부전공, #378 G-2): 제2전공 학점과 복수전공 졸업논문2. 과목은 개설 학과·편성표로 자동으로 나누고 과목 관리에서 고칠 수 있다. */}
            {status.secondMajor && (
              <section className="home-card">
                <div className="grad-category-row">
                  <p className="home-card-label">
                    {t('grad.secondMajor.title', { type: t(`grad.secondMajor.${status.secondMajor.type}`), department: status.secondMajor.department })}
                  </p>
                  {status.secondMajor.required != null && (
                    <span className={status.secondMajor.earned >= status.secondMajor.required ? 'grad-category-value satisfied' : 'grad-category-value'}>
                      {t('grad.groupCredits', {
                        earned: status.secondMajor.earned,
                        required: status.secondMajor.required,
                        percent: getPercent(status.secondMajor.earned, status.secondMajor.required),
                      })}
                    </span>
                  )}
                </div>
                {status.secondMajor.required != null && (
                  <div className="home-progress-track">
                    <div
                      className="home-progress-fill"
                      style={{
                        width: `${getPercent(status.secondMajor.earned, status.secondMajor.required)}%`,
                      }}
                    />
                  </div>
                )}
                <p className="grad-flex-note">{t(`grad.secondMajor.basis.${status.secondMajor.basis}`, { n: status.secondMajor.required })}</p>
                {status.secondMajor.thesis && (
                  <div className="grad-subcheck-row">
                    <span className={status.secondMajor.thesis.satisfied ? 'grad-cert-check satisfied' : 'grad-cert-check'}>
                      {status.secondMajor.thesis.satisfied && <IconCheck size={11} />}
                    </span>
                    <p className="grad-subcheck-label">{t(status.secondMajor.thesis.satisfied ? 'grad.secondMajor.thesisMet' : 'grad.secondMajor.thesisUnmet')}</p>
                  </div>
                )}
                <p className="grad-flex-note">{t('grad.secondMajor.assigned', { n: status.secondMajor.courses.length })}</p>
              </section>
            )}

            {groups?.liberalArts && (
              <section className="home-card">
                <div className="grad-category-row">
                  <p className="home-card-label">{t('grad.liberal')}</p>
                  <span
                    className={
                      groups.liberalArts.earnedCredits >= groups.liberalArts.requiredCredits
                        ? 'grad-category-value satisfied'
                        : 'grad-category-value'
                    }
                  >
                    {t('grad.groupCredits', {
                      earned: groups.liberalArts.earnedCredits,
                      required: groups.liberalArts.requiredCredits,
                      percent: getPercent(groups.liberalArts.earnedCredits, groups.liberalArts.requiredCredits),
                    })}
                  </span>
                </div>
                <div className="home-progress-track">
                  <div
                    className="home-progress-fill"
                    style={{
                      width: `${getPercent(groups.liberalArts.earnedCredits, groups.liberalArts.requiredCredits)}%`,
                    }}
                  />
                </div>
                {groups.liberalArts.earnedCredits > groups.liberalArts.requiredCredits && (
                  <p className="grad-overflow-note">{t('grad.overflow')}</p>
                )}
                <div className="grad-subcheck-row">
                  <span className={groups.liberalArts.requiredSatisfied ? 'grad-cert-check satisfied' : 'grad-cert-check'}>
                    {groups.liberalArts.requiredSatisfied && <IconCheck size={11} />}
                  </span>
                  <p className="grad-subcheck-label">
                    {groups.liberalArts.requiredSatisfied ? t('grad.liberalRequiredMet') : t('grad.liberalRequiredUnmet')}
                  </p>
                </div>
                {groups.liberalArts.missingAreas.length > 0 && (
                  <p className="grad-flex-note">
                    {t('grad.liberalAreasMissing', {
                      items: groups.liberalArts.missingAreas
                        .map((a) => t('grad.shortfallLiberalArea', { area: translateCategory(a.area, t), courses: a.missing.join('·') }))
                        .join(', '),
                    })}
                  </p>
                )}
                <p className="grad-flex-note">{t('grad.electiveEarned', { n: groups.liberalArts.electiveEarnedCredits })}</p>
                {/* 2025학번부터: 교양기초 영역별 학점과 교양선택 영역 개수(서버 liberalElectiveAreas.js, #378 H-1). 영역을 모르는 학점은 어느 영역에도 넣지 않는다. */}
                {status.liberalElectiveAreas && (
                  <>
                    <p className="grad-flex-note">{t('grad.liberalAreaBasis')}</p>
                    {/* 외국인 유학생은 교양필수를 뺀 교양을 영역 구분 없이 이수한다(2026 책자, 심의 후 확정). 국적은 받지 않아 안내만 한다. */}
                    <p className="grad-flex-note">{t('grad.liberalAreaForeign')}</p>
                    {status.liberalElectiveAreas.foundation.map((a) => (
                      <div className="grad-subcheck-row" key={a.area}>
                        <span className={a.satisfied ? 'grad-cert-check satisfied' : 'grad-cert-check'}>
                          {a.satisfied && <IconCheck size={11} />}
                        </span>
                        <p className="grad-subcheck-label">{t('grad.liberalFoundationArea', { area: translateCategory(a.area, t), earned: a.earned, required: a.required })}</p>
                      </div>
                    ))}
                    {status.liberalElectiveAreas.electives && (
                      <div className="grad-subcheck-row">
                        <span className={status.liberalElectiveAreas.electives.satisfied ? 'grad-cert-check satisfied' : 'grad-cert-check'}>
                          {status.liberalElectiveAreas.electives.satisfied && <IconCheck size={11} />}
                        </span>
                        <p className="grad-subcheck-label">
                          {t('grad.liberalElectiveAreas', {
                            covered: status.liberalElectiveAreas.electives.coveredAreaCount,
                            required: status.liberalElectiveAreas.electives.requiredAreaCount,
                          })}
                        </p>
                      </div>
                    )}
                    {status.liberalElectiveAreas.unknownCredits > 0 && (
                      <p className="grad-flex-note">{t('grad.liberalAreaUnknown', { n: status.liberalElectiveAreas.unknownCredits })}</p>
                    )}
                  </>
                )}
              </section>
            )}

            {(status.certifications.length > 0 || status.counseling) && (
              <>
                <p className="home-quick-label">{t('grad.sectionCerts')}</p>
                {status.certifications.map((cert) => (
                  <section className="home-card" key={cert.category}>
                    <div className="grad-cert-row">
                      <span className={cert.satisfied ? 'grad-cert-check satisfied' : 'grad-cert-check'}>
                        {cert.satisfied && <IconCheck size={11} />}
                      </span>
                      <div>
                        <p className="home-card-label">{translateCategory(cert.category, t)}</p>
                        <p className="grad-cert-desc">{cleanRequirementNote(cert.description)}</p>
                        {certCourseRows(cert).map((row) => (
                          <div className="grad-subcheck-row" key={row.course}>
                            <span className={row.done ? 'grad-cert-check satisfied' : 'grad-cert-check'}>
                              {row.done && <IconCheck size={11} />}
                            </span>
                            <p className="grad-subcheck-label">{t(row.done ? 'grad.certCourse.done' : 'grad.certCourse.left', { course: row.course })}</p>
                          </div>
                        ))}
                        {cert.optional && <p className="grad-flex-note">{t('grad.certOptionalTeaching')}</p>}
                        {cert.conditionalExemption === 'BACHELOR_TRANSFER' && <p className="grad-flex-note">{t('grad.certExemptBachelorTransfer')}</p>}
                      </div>
                    </div>
                  </section>
                ))}
                {/* 자기계발심층상담: 판정하지 않고 기준·확인 경로만 안내한다(서버 counseling.js, DECISIONS D-65). 부족 요건 요약에는 넣지 않는다. */}
                {status.counseling && (
                  <section className="home-card">
                    <div className="grad-cert-row">
                      <span className="grad-cert-check" aria-hidden="true" />
                      <div>
                        <p className="home-card-label">{t('grad.counseling.title')}</p>
                        <p className="grad-cert-desc">
                          {t('grad.counseling.need', { n: status.counseling.required, cohort: t(`grad.counseling.cohort.${status.counseling.cohort}`) })}
                        </p>
                        {status.counseling.replacement === 'HUG' && <p className="grad-flex-note">{t('grad.counseling.hug')}</p>}
                        <p className="grad-flex-note">{t('grad.counseling.notJudged')}</p>
                        <p className="grad-flex-note">{t('grad.counseling.countingPending')}</p>
                      </div>
                    </div>
                  </section>
                )}
              </>
            )}

            {/* 학칙시행규칙 제9조 제1호 학과(의·치·한의·약·간호·응급구조·보건의료)의 지정 전공 과목 — 어떤 과목이 지정인지는 학과 내규라
                판정하지 않고 편성표의 전공기초·전공필수 목록과 학과 확인 안내만 보여 준다(서버 designatedMajorCourses.js). 부족 요건 요약에는 넣지 않는다. */}
            {status.designatedMajorCourses && status.designatedMajorCourses.courses.length > 0 && (
              <section className="home-card">
                <p className="home-card-label">{t('grad.designated.title')}</p>
                <p className="grad-cert-desc">{t('grad.designated.note', { year: status.designatedMajorCourses.courseListYear })}</p>
                <details className="grad-designated">
                  <summary className="grad-flex-note">
                    {t('grad.designated.summary', {
                      n: status.designatedMajorCourses.courses.length,
                      m: status.designatedMajorCourses.courses.filter((c) => c.taken).length,
                    })}
                  </summary>
                  <ul className="grad-designated-list">
                    {status.designatedMajorCourses.courses.map((c) => (
                      <li key={c.courseName}>
                        {c.taken && <IconCheck size={11} />} {c.courseName}
                        <span className="grad-flex-note"> · {t('home.gradeLevel', { grade: c.grade })} · {translateCategory(c.category, t)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
            )}

            <section className={shortfalls.length > 0 ? 'grad-shortfall-box' : 'grad-shortfall-box ok'}>
              <p className="home-card-label">{t('grad.summaryTitle')}</p>
              {shortfalls.length > 0 ? (
                <ul className="grad-shortfall-list">
                  {shortfalls.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  {uncheckedRequirementKeys(status).length > 0
                    ? t('home.allMetUnchecked', { items: uncheckedRequirementKeys(status).map((k) => t(k)).join(', ') })
                    : t('home.allMet')}
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default GraduationStatus;
