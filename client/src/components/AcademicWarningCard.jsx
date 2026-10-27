import React from 'react';
import { IconAlertTriangle } from './icons.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * AcademicWarningCard Component
 * 학기 성적으로 본 학사경고(일반 학과)·유급(의·치·한·약·간호) "대상일 수 있는" 학기 안내(#412, 서버 services/academicWarning.js).
 * 대상 학기나 재학 중 다시 이수해야 할 교양 F가 있을 때만 보인다. 실제 판정은 학기 말 성적사정·학교 통보가 기준이라 단정하지 않는다.
 * 과목명은 서버 데이터라 번역하지 않는다.
 *
 * Props:
 * - warnings: 졸업요건 응답의 academicWarnings({ regime, threshold, terms, flaggedCount, consecutiveCount, dismissal }) | null
 */
function AcademicWarningCard({ warnings }) {
  const { t } = useI18n();
  if (!warnings) return null;
  const flagged = warnings.terms.filter((term) => term.flagged);
  const liberal = warnings.regime === 'REPEAT' ? warnings.terms.filter((term) => term.liberalArtsF && term.liberalArtsF.length > 0) : [];
  if (flagged.length === 0 && liberal.length === 0) return null;

  const kind = warnings.regime === 'REPEAT' ? 'repeat' : 'warning';
  const termName = (term) => t('grad.warn.term', { year: term.year, semester: term.semester });
  const reasonText = (term, reason) => {
    if (reason === 'GPA_BELOW') return t('grad.warn.reason.gpa', { gpa: term.gpa.toFixed(2), threshold: warnings.threshold.toFixed(2) });
    if (reason === 'MAJOR_GPA_BELOW') return t('grad.warn.reason.majorGpa', { gpa: term.majorGpa.toFixed(2) });
    if (reason === 'MAJOR_REQUIRED_F') return t('grad.warn.reason.requiredF', { courses: term.failedCourses.join(', ') });
    return t('grad.warn.reason.majorF', { courses: term.failedCourses.join(', ') });
  };

  return (
    <section className="home-card grad-warning-card" role="note">
      <p className="home-card-label">
        <IconAlertTriangle size={14} />
        {t(`grad.warn.${kind}.title`)}
      </p>
      {flagged.length > 0 && (
        <>
          <p className="grad-warning-lead">{t(`grad.warn.${kind}.lead`, { n: flagged.length })}</p>
          <ul className="grad-warning-list">
            {flagged.map((term) => (
              <li key={`${term.year}-${term.semester}`}>
                <b>{termName(term)}</b> · {term.reasons.map((reason) => reasonText(term, reason)).join(' / ')}
              </li>
            ))}
          </ul>
          <p className="grad-flex-note">
            {t(`grad.warn.${kind}.count`, { total: warnings.flaggedCount, consecutive: warnings.consecutiveCount })}
          </p>
          {kind === 'repeat' && <p className="grad-flex-note">{t('grad.warn.repeat.leave')}</p>}
        </>
      )}
      {liberal.map((term) => (
        <p key={`lib-${term.year}-${term.semester}`} className="grad-flex-note">
          {t('grad.warn.repeat.liberal', { term: termName(term), courses: term.liberalArtsF.join(', ') })}
        </p>
      ))}
      <p className="grad-flex-note">{t('grad.warn.disclaimer')}</p>
    </section>
  );
}

export default AcademicWarningCard;
