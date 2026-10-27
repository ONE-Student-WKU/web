import React from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';
import { getPercent } from '../utils/graduation.js';

/**
 * MicroDegreeCard Component
 * 학생이 고른 마이크로디그리(사업단 과정·학과·전공별 과정)마다 이수 학점(#412, 서버 services/linkedMajors.js). 졸업 판정과 별개라 부족 요건에는 넣지 않는다.
 * 광역 계열전공 전공융합형이면 타전공 MD 2개(각 12학점) 중 12학점에 이른 개수를 안내한다 — 충족은 판정하지 않는다(D-87).
 * 과정 이름·과목명은 서버 데이터라 번역하지 않는다. 고른 과정이 없고 전공융합형도 아니면 그리지 않는다.
 *
 * Props:
 * - microDegrees: [{ name, programGroup, required, earned, satisfied, courses: [{ name, credits }], missing }] | undefined
 * - convergence: { required, reached, otherChosen } | null — 전공융합형 학생만
 */
function MicroDegreeCard({ microDegrees, convergence = null }) {
  const { t } = useI18n();
  const list = microDegrees || [];
  if (list.length === 0 && !convergence) return null;
  return (
    <section className="home-card">
      <p className="home-card-label">{t('grad.micro.title')}</p>
      {convergence && (
        <p className="grad-micro-convergence" role="note">
          {convergence.otherChosen === 0
            ? t('grad.micro.convergence.none', { n: convergence.required })
            : t('grad.micro.convergence.progress', { n: convergence.required, reached: convergence.reached })}
        </p>
      )}
      {list.map((m) => (
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
      {list.length > 0 && <p className="grad-flex-note">{t('grad.micro.note')}</p>}
    </section>
  );
}

export default MicroDegreeCard;
