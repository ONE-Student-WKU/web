import React from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/I18nContext.jsx';
import {
  buildPrintRows,
  printTrustLevel,
  summarizeLiberalAreasForPrint,
  uncheckedRequirementKeys,
  translateCategory,
  displayCategory,
  getPercent,
  remainingLabel,
  isPremed,
} from '../utils/graduation.js';

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * GraduationPrintSheet
 * 졸업요건 진단 결과 한 장(A4) 인쇄·PDF 저장용 시트(#455). 화면에는 보이지 않고(App.css), 인쇄할 때만 이 시트만 찍힌다.
 * 학생이 과사무실·학사지원과에 들고 가 확인받는 용도라 과목 목록은 싣지 않고, 분류별 학점·남은 것·따로 확인할 것만 싣는다.
 * 서버가 준 학과명·사유 문장은 번역하지 않는다.
 *
 * Props:
 * - status: getGraduationStatus 응답
 * - user: 로그인 사용자(department, track, admissionYear, enrollmentType)
 * - trust: describeRequirementTrust(status, lang) 결과
 * - basisYear: 기준 교육과정 책자 학년도
 */
function GraduationPrintSheet({ status, user, trust, basisYear }) {
  const { t } = useI18n();
  const label = (raw) => translateCategory(displayCategory(raw), t);
  const rows = buildPrintRows(status);
  const level = printTrustLevel(status);
  const reasons = [trust.reason, ...trust.otherReasons].filter(Boolean);
  const liberalAreas = summarizeLiberalAreasForPrint(status.liberalElectiveAreas);
  const unchecked = uncheckedRequirementKeys(status);
  const remaining = Math.max(0, status.totalRequiredCredits - status.totalEarnedCredits);
  const overflow = rows.some((r) => r.earned > r.required);
  const second = status.secondMajor;

  const meta = [
    [user?.department, user?.track].filter(Boolean).join(' '),
    user?.admissionYear && t('profile.cohort', { year: user.admissionYear }),
    user?.enrollmentType && t(`onb.type.${user.enrollmentType}`),
    basisYear && t('grad.basis.booklet', { year: basisYear }),
    t('grad.print.date', { date: today() }),
  ].filter(Boolean);

  const statusCell = (left, extraUnmet = null) => {
    if (left > 0) return <td className="gps-short">{t('grad.print.left', { n: left })}</td>;
    if (extraUnmet) return <td className="gps-short">{extraUnmet}</td>;
    return <td className="gps-met">{t('grad.print.met')}</td>;
  };

  return createPortal(
    <div className="grad-print-sheet">
      <header className="gps-header">
        <h1>{t('grad.print.title')}</h1>
        <p className="gps-meta">{meta.join(' · ')}</p>
        <p className="gps-fill">
          <span>{t('grad.print.nameLine')}</span>
          <span>{t('grad.print.idLine')}</span>
        </p>
      </header>

      <section className="gps-summary">
        <p className="gps-remaining">
          {remainingLabel(status, t)}
        </p>
        <div className="gps-bar">
          <div style={{ width: `${getPercent(status.totalEarnedCredits, status.totalRequiredCredits)}%` }} />
        </div>
        <p className="gps-total-line">
          {t(isPremed(status) ? 'grad.print.totalLine.premed' : 'grad.print.totalLine', { required: status.totalRequiredCredits, earned: status.totalEarnedCredits })}
          {status.inProgressCredits > 0 && ` (${t('grad.inProgressIncluded', { n: status.inProgressCredits })})`}
          {trust.totalEstimated && ` ${t('grad.estimated')}`}
        </p>
      </section>

      {level && (
        <section className="gps-trust">
          <p>
            <strong>{t('grad.print.trustLabel')}</strong> <span className={`gps-trust-level ${level}`}>{t(`grad.print.trust.${level}`)}</span>
            {' — '}
            {t(`grad.print.trustMeaning.${level}`)}
          </p>
          {level !== 'HIGH' && reasons.length > 0 && (
            <ul>
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h2>{t('grad.print.tableTitle')}</h2>
        <table className="gps-table">
          <thead>
            <tr>
              <th>{t('grad.print.col.category')}</th>
              <th>{t('grad.print.col.credits')}</th>
              <th>{t('grad.print.col.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.category}>
                <td>
                  {label(r.category)}
                  {r.parts.length > 0 && (
                    <span className="gps-parts">
                      {r.parts
                        .map((p) => (p.kind === 'area'
                          ? t('grad.majorArea', { area: label(p.category), earned: p.earned, required: p.required })
                          : t('grad.print.part', { category: label(p.category), earned: p.earned, required: p.required })))
                        .join(' · ')}
                    </span>
                  )}
                  {r.missingAreas.length > 0 && (
                    <span className="gps-parts">
                      {t('grad.liberalAreasMissing', {
                        items: r.missingAreas
                          .map((a) => t('grad.shortfallLiberalArea', { area: label(a.area), courses: a.missing.join('·') }))
                          .join(', '),
                      })}
                    </span>
                  )}
                </td>
                <td className="gps-num">{t('grad.print.credits', { earned: r.earned, required: r.required })}</td>
                {statusCell(r.remaining, r.missingAreas.length > 0 ? t('grad.print.areaMissing') : null)}
              </tr>
            ))}
            {second && (
              <tr>
                <td>{t('grad.secondMajor.title', { type: t(`grad.secondMajor.${second.type}`), department: second.department })}</td>
                <td className="gps-num">{t('grad.print.credits', { earned: second.earned, required: second.required ?? '—' })}</td>
                {second.required != null
                  ? statusCell(Math.max(0, second.required - second.earned))
                  : <td className="gps-short">{t('grad.print.askDept')}</td>}
              </tr>
            )}
            <tr className="gps-total">
              <td>{t('grad.print.total')}</td>
              <td className="gps-num">{t('grad.print.credits', { earned: status.totalEarnedCredits, required: status.totalRequiredCredits })}</td>
              {statusCell(remaining)}
            </tr>
          </tbody>
        </table>
        {overflow && <p className="gps-note">{t('grad.print.overflowNote')}</p>}
        {liberalAreas && (
          <p className="gps-note">
            {t('grad.print.liberalAreas', { met: liberalAreas.met, total: liberalAreas.total })}
            {liberalAreas.short.length > 0 &&
              ` · ${t('grad.shortfallFoundationAreas', {
                items: liberalAreas.short.map((a) => t('grad.shortfallFoundationAreaItem', { area: label(a.area), n: a.n })).join('·'),
              })}`}
            {liberalAreas.electives &&
              ` · ${t('grad.liberalElectiveAreas', { covered: liberalAreas.electives.covered, required: liberalAreas.electives.required })}`}
          </p>
        )}
      </section>

      {(status.certifications.length > 0 || status.counseling || second?.thesis) && (
        <section>
          <h2>{t('grad.print.nonCreditTitle')}</h2>
          <ul className="gps-checklist">
            {status.certifications.map((cert) => (
              <li key={cert.category}>
                <span className={cert.satisfied ? 'gps-met' : 'gps-short'}>
                  {cert.satisfied ? t('grad.print.met') : cert.optional ? t('grad.print.optional') : t('grad.print.unmet')}
                </span>
                {label(cert.category)}
              </li>
            ))}
            {second?.thesis && (
              <li>
                <span className={second.thesis.satisfied ? 'gps-met' : 'gps-short'}>
                  {second.thesis.satisfied ? t('grad.print.met') : t('grad.print.unmet')}
                </span>
                {t('grad.shortfallSecondThesis', { type: t(`grad.secondMajor.${second.type}`) })}
              </li>
            )}
            {status.counseling && (
              <li>
                <span className="gps-check">{t('grad.print.schoolRecord')}</span>
                {t('grad.counseling.title')} · {t('grad.counseling.need', { n: status.counseling.required, cohort: t(`grad.counseling.cohort.${status.counseling.cohort}`) })}
              </li>
            )}
          </ul>
        </section>
      )}

      {unchecked.length > 0 && (
        <section>
          <h2>{t('grad.print.uncheckedTitle')}</h2>
          <ul className="gps-checklist">
            {unchecked.map((k) => (
              <li key={k}>
                <span className="gps-check">{t('grad.print.askDept')}</span>
                {t(k)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="gps-footer">{t('grad.print.footer')}</footer>
    </div>,
    document.body,
  );
}

export default GraduationPrintSheet;
