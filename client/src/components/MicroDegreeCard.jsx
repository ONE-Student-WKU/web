import React from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';
import { getPercent } from '../utils/graduation.js';

/**
 * MicroDegreeCard Component
 * 학생이 고른 마이크로디그리(사업단 과정)마다 이수 학점(#412, 서버 services/linkedMajors.js). 졸업 판정과 별개라 부족 요건에는 넣지 않는다.
 * 과정 이름·과목명은 서버 데이터라 번역하지 않는다. 고른 과정이 없으면 그리지 않는다.
 *
 * Props:
 * - microDegrees: [{ name, programGroup, required, earned, satisfied, courses: [{ name, credits }], missing }] | undefined
 */
function MicroDegreeCard({ microDegrees }) {
  const { t } = useI18n();
  if (!microDegrees || microDegrees.length === 0) return null;
  return (
    <section className="home-card">
      <p className="home-card-label">{t('grad.micro.title')}</p>
      {microDegrees.map((m) => (
        <div key={m.name} className="grad-micro-item">
          <div className="grad-category-row">
            <p className="grad-micro-name">{m.name}</p>
            {!m.missing && (
              <span className={m.satisfied ? 'grad-category-value satisfied' : 'grad-category-value'}>
                {t('grad.groupCredits', { earned: m.earned, required: m.required, percent: getPercent(m.earned, m.required) })}
              </span>
            )}
          </div>
          {m.missing ? (
            <p className="grad-flex-note">{t('grad.micro.missing')}</p>
          ) : (
            <>
              <div className="home-progress-track">
                <div className="home-progress-fill" style={{ width: `${getPercent(m.earned, m.required)}%` }} />
              </div>
              {m.courses.length > 0 && <p className="grad-flex-note">{m.courses.map((c) => c.name).join(', ')}</p>}
            </>
          )}
        </div>
      ))}
      <p className="grad-flex-note">{t('grad.micro.note')}</p>
    </section>
  );
}

export default MicroDegreeCard;
