import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';
import { translateCategory } from '../utils/graduation.js';

/**
 * 바뀐 자료 알림 카드 — 학교 기준·자료가 갱신돼 내 진단 결과가 바뀌었을 때, 홈의 진행률·부족 요건 카드 자리에 대신 나온다.
 * 서버(changeNoticeService.js)가 "마지막으로 확인한 결과 → 지금 결과"로 합쳐서 내려 준다.
 * 바뀐 항목은 접지 않고 전부 보여 주고(놓치지 않게), 언제 무엇이 반영됐는지(출처)만 접는다.
 *
 * Props:
 * - notice: { since: 'YYYY-MM-DD', items: [{ key, kind, category?, unit, before, after }], updates: [{ date, note }] }
 * - onConfirm: function — [확인]
 * - onViewDiagnosis: function — [진단 보기](이것도 확인으로 친다)
 */

// 영어는 1이면 단수형("1 course")이다.
const unitText = (unit, n, t) => t(`changeNotice.${unit === 'courses' ? 'course' : 'credit'}${n === 1 ? '' : 's'}`, { n });

// 필요 양(졸업 학점·필요 학점·졸업인증 과목 수)은 늘면 부담이고, 남은 양은 줄면 좋다 — 어느 쪽이든 늘면 bad(빨강 ▲), 줄면 good(초록 ▼).
// 꼬리표는 "6학점 ▲"처럼 짧게 보여 주고(2026-10-28 피드백), 화살표를 읽지 못하는 화면 낭독기에는 문장(spoken)을 읽힌다.
// 좋은 쪽을 파랑으로 하지 않는 이유: 앱에서 파랑은 누를 수 있는 것(링크·선택된 탭)에만 쓴다.
function tagOf(item, t) {
  const diff = (item.after ?? 0) - (item.before ?? 0);
  const amount = unitText(item.unit, Math.abs(diff), t);
  const up = diff > 0;
  const isRemaining = item.kind === 'remaining' || item.kind === 'certRemaining';
  let spoken;
  if (item.before == null) spoken = t('changeNotice.tag.added');
  else if (item.after == null) spoken = t('changeNotice.tag.removed');
  else if (isRemaining && item.after === 0) spoken = t('changeNotice.tag.filled');
  else spoken = t(up ? 'changeNotice.tag.more' : 'changeNotice.tag.less', { amount });
  return { tone: up ? 'bad' : 'good', text: `${amount} ${up ? '▲' : '▼'}`, spoken };
}

function valueText(item, value, t) {
  const isRemaining = item.kind === 'remaining' || item.kind === 'certRemaining';
  if (value == null || (isRemaining && value === 0)) return t('changeNotice.none');
  return unitText(item.unit, value, t);
}

const fullDate = (d) => d.replace(/-/g, '.');
// '2026-08-01' → '8.01'
const shortDate = (d) => `${Number(d.slice(5, 7))}.${d.slice(8, 10)}`;

function ChangeNotice({ notice, onConfirm, onViewDiagnosis }) {
  const { t } = useI18n();
  const [showUpdates, setShowUpdates] = useState(false);
  const updates = notice.updates || [];
  const last = updates.length ? updates[updates.length - 1].date : null;

  return (
    <section className="change-card" aria-labelledby="change-card-title">
      <h3 id="change-card-title">
        {updates.length >= 2 ? t('changeNotice.titleSince', { date: shortDate(notice.since) }) : t('changeNotice.title')}
      </h3>
      {last && (
        <p className="change-source">
          {updates.length >= 2
            ? t('changeNotice.sourceMany', { n: updates.length, date: fullDate(last) })
            : t('changeNotice.sourceOne', { date: fullDate(last) })}
        </p>
      )}
      <ul className="change-list">
        {notice.items.map((item) => {
          const tag = tagOf(item, t);
          return (
            <li key={item.key}>
              <span className="change-what">{t(`changeNotice.item.${item.kind}`, { category: translateCategory(item.category, t) })}</span>
              <span className="change-delta">
                {valueText(item, item.before, t)} → {valueText(item, item.after, t)}
                <span className={`change-tag change-tag--${tag.tone}`}>
                  <span aria-hidden="true">{tag.text}</span>
                  <span className="sr-only">{tag.spoken}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {updates.length > 0 && (
        <>
          <button type="button" className="change-toggle" aria-expanded={showUpdates} onClick={() => setShowUpdates((v) => !v)}>
            {t(showUpdates ? 'changeNotice.updatesHide' : 'changeNotice.updatesShow', { n: updates.length })}
            <span aria-hidden="true">{showUpdates ? '▴' : '▾'}</span>
          </button>
          {showUpdates && (
            <ul className="change-updates">
              {updates.map((u) => (
                <li key={`${u.date}-${u.note}`}>
                  {fullDate(u.date)} · {u.note}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="change-actions">
        <button type="button" className="post-btn post-btn--outline" onClick={onConfirm}>
          {t('changeNotice.confirm')}
        </button>
        <button type="button" className="post-btn post-btn--ink" onClick={onViewDiagnosis}>
          {t('changeNotice.viewDiagnosis')}
        </button>
      </div>
    </section>
  );
}

export default ChangeNotice;
