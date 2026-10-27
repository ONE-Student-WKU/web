import React, { useEffect, useState } from 'react';
import { getGraduationStatus } from '../api/chatApi.js';
import AccountMenu from '../components/AccountMenu.jsx';
import GraduationPrintSheet from '../components/GraduationPrintSheet.jsx';
import { IconChevronLeft, IconCheck } from '../components/icons.jsx';
import { summarizeShortfalls, mergeMajorCategories, buildRequirementGroups, getPercent, describeRequirementTrust, translateCategory, registrationTermShortage, allMetMessage, creditsDependOnInProgress, isAbsentInLatestBooklet, certCourseRows, isNearGraduation, buildResultReportDraft } from '../utils/graduation.js';
import { readCache, writeCache, clearCache } from '../utils/sessionCache.js';
import { cleanRequirementNote } from '../utils/displayText.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import AcademicWarningCard from '../components/AcademicWarningCard.jsx';
import MicroDegreeCard from '../components/MicroDegreeCard.jsx';

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
function GraduationStatus({ user, onGoHome, onOpenCourses, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile, onOpenAdmin, onOpenInquiry, onReportResult }) {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState(cachedStatus);
  const [loading, setLoading] = useState(cachedStatus === null);
  // 번역 키를 저장해 두고 렌더에서 t()로 바꾼다 — 로딩 이펙트가 번역 함수에 의존하지 않게 하려는 것.
  const [error, setError] = useState(null);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  // 한 장 인쇄(#455): 누르면 인쇄용 시트를 붙이고 인쇄 창을 연다. 평소에는 시트를 그리지 않아 화면 DOM에 같은 숫자가 두 번 들어가지 않는다.
  const [printing, setPrinting] = useState(false);

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

  // 대부분 프린터가 없어 PDF 저장이 주 용도다(인쇄 창의 'PDF로 저장'). 이미 시트가 붙어 있으면 창만 다시 연다.
  const savePdf = () => (printing ? window.print() : setPrinting(true));

  // 시트가 그려진 뒤 인쇄 창을 연다. body 클래스가 붙어 있는 동안만 인쇄 CSS가 시트 말고 나머지를 숨긴다(App.css).
  // 모바일 브라우저는 window.print()가 바로 돌아오기도 해서, 시트는 afterprint에서 뗀다.
  useEffect(() => {
    if (!printing) return undefined;
    const done = () => setPrinting(false);
    document.body.classList.add('grad-printing');
    window.addEventListener('afterprint', done);
    window.print();
    return () => {
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('grad-printing');
    };
  }, [printing]);

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
  // 기준 책자 학년도: 2025학번 이하는 엔진이 알려 주는 최신 책자(학번별 이수기준표), 그 밖에는 입학한 해의 책자.
  // 응답이 오기 전에는 비워 둔다 — 입학년도로 미리 채우면 "2019학년도 책자 기준"이 잠깐 보였다가 2026으로 바뀌어
  // 최신 책자 원칙과 반대 문구가 보였다(2026-10-27 화면 점검).
  const basisYear = status ? (status.regulation?.basisBookletYear ?? user?.admissionYear ?? null) : null;

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
        {/* 숫자를 보는 바로 그 자리에 비공식·기준·최종 확인처를 늘 보여준다(약관 속 문구는 읽히지 않는다 — 교육혁신과 통화 2026-10-26). */}
        <p className="grad-basis-line">
          <strong>{t('grad.basis.unofficial')}</strong>
          {basisYear && <span>{t('grad.basis.booklet', { year: basisYear })}</span>}
          <span>{t('grad.basis.call')}</span>
        </p>
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

        {/* 학사경고·유급은 졸업요건 자료가 없는 학과·학번에도 성적만으로 안내할 수 있어 자료 유무와 상관없이 둔다(대상 학기가 있을 때만 보인다). */}
        {status && <AcademicWarningCard warnings={status.academicWarnings} />}

        {status && !trust.noData && (
          <>
            {/* 졸업이 가까우면 확인받을 때 들고 갈 결과를 바로 저장할 수 있게 같은 버튼을 이 안내 안에도 둔다. */}
            {isNearGraduation(status) && (
              <div className="grad-near-graduation" role="note">
                <p>{t('grad.nearGraduation')}</p>
                <button type="button" className="grad-near-save-btn" onClick={savePdf}>
                  {t('grad.print.nearButton')}
                </button>
              </div>
            )}
            <section className="home-card">
              <p className="home-card-label">
                {t('grad.totalLabel')}
                {trust.badge && <span className={`grad-trust-badge ${trust.badge.level}`}>{trust.badge.label}</span>}
              </p>
              <div className="home-credit-value">
                <span className="home-credit-number">{status.totalEarnedCredits}</span>
                <span className="home-credit-total">{t('grad.totalCredits', { total: status.totalRequiredCredits })}</span>
                {trust.totalEstimated && <span className="grad-trust-tag">{t('grad.estimated')}</span>}
                {status.inProgressCredits > 0 && <span className="grad-trust-tag">{t('grad.inProgressIncluded', { n: status.inProgressCredits })}</span>}
              </div>
              {trust.reason && <p className="grad-trust-reason">{trust.reason}</p>}
              {isAbsentInLatestBooklet(status) && <p className="grad-trust-reason">{t('grad.absentDeptNote')}</p>}
              {trust.otherReasons.length > 0 && (
                <details className="grad-trust-more">
                  <summary>{t('grad.trust.more', { n: trust.otherReasons.length })}</summary>
                  <ul>
                    {trust.otherReasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="home-progress-track">
                <div
                  className="home-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="grad-remaining-text">
                {progressPercent}% ·{' '}
                {remaining > 0 ? t('grad.remaining', { n: remaining }) : creditsDependOnInProgress(status) ? t('grad.completeInProgress', { n: status.inProgressCredits }) : t('grad.complete')}
              </p>
              {generalElectiveCredits > 0 && (
                <p className="grad-flex-note">{t('grad.generalElective', { n: generalElectiveCredits })}</p>
              )}
              {/* 졸업사정 등록기간(시행규칙 제118조 제1호) — 학점을 다 채웠는데 학기가 모자랄 때만 알린다(#378 H-2). 평소 보이던
                  "수업연한 이상 등록해야 해요" 줄은 누구나 아는 내용이라 읽는 피로만 늘고 조기졸업을 노리는 학생에게 오해를 줘서 뺐다(2026-10-22 피드백). */}
              {termShortage > 0 && <p className="grad-trust-reason">{t('grad.registrationShort', { n: termShortage })}</p>}
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
                {/* 연계·복합전공(#412): 교양 9학점·주전공과 같은 과목 1/3 상한을 적용한 학점을 함께 알린다. */}
                {status.secondMajor.kind === 'LINKED' && (
                  <p className="grad-flex-note">
                    {t('grad.secondMajor.linkedDetail', { liberal: status.secondMajor.liberalCredits, shared: status.secondMajor.overlapCredits })}
                  </p>
                )}
                <p className="grad-flex-note">
                  {t(status.secondMajor.kind === 'LINKED' ? 'grad.secondMajor.assignedLinked' : 'grad.secondMajor.assigned', { n: status.secondMajor.courses.length })}
                </p>
              </section>
            )}

            <MicroDegreeCard microDegrees={status.microDegrees} convergence={status.microDegreeConvergence} />

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
                {/* 자기계발심층상담: 상담 기록은 읽지 않지만, 지도교수가 학기마다 상담을 진행해 거의 모든 학생이 채우므로 충족(체크)으로
                    보여주고 확인 경로만 짧게 붙인다(2026-10-22 결정, D-65를 바꿈). 부족 요건 요약에는 넣지 않는다. */}
                {status.counseling && (
                  <section className="home-card">
                    <div className="grad-cert-row">
                      <span className="grad-cert-check satisfied" aria-hidden="true">
                        <IconCheck size={11} />
                      </span>
                      <div>
                        <p className="home-card-label">{t('grad.counseling.title')}</p>
                        <p className="grad-cert-desc">
                          {t('grad.counseling.need', { n: status.counseling.required, cohort: t(`grad.counseling.cohort.${status.counseling.cohort}`) })}
                        </p>
                        {status.counseling.replacement === 'HUG' && <p className="grad-flex-note">{t('grad.counseling.hug')}</p>}
                        {/* 두 문장을 줄을 나눠 보여준다 — 이어 쓰면 "혹시"가 줄 끝에 걸려 읽기 불편했다(2026-10-22 피드백). */}
                        <p className="grad-flex-note">
                          {t('grad.counseling.usuallyDone')}
                          <br />
                          {t('grad.counseling.checkPath')}
                        </p>
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
                <p className="multiline-text">
                  {allMetMessage(status, t)}
                </p>
              )}
            </section>
          </>
        )}

        {/* 진단 결과 한 장(#455) — 주로 PDF로 저장하고(필요하면 뽑아서) 과사무실·학사지원과에서 확인받는 용도. 자료가 없으면 보여 줄 게 없어 숨긴다. */}
        {status && !trust.noData && (
          <div className="grad-print-box">
            <button type="button" className="grad-print-btn" onClick={savePdf}>
              {t('grad.print.button')}
            </button>
            <p className="grad-flex-note">{t('grad.print.hint')}</p>
          </div>
        )}
        {printing && status && !trust.noData && <GraduationPrintSheet status={status} user={user} trust={trust} basisYear={basisYear} />}

        {/* 틀린 자료를 빨리 찾는 통로 — 학과·학번·진단 숫자를 미리 채운 문의로 보낸다. */}
        {status && onReportResult && (
          <button type="button" className="grad-report-btn" onClick={() => onReportResult(buildResultReportDraft(status, user, t))}>
            {t('grad.report.button')}
          </button>
        )}
      </div>
    </div>
  );
}

export default GraduationStatus;
