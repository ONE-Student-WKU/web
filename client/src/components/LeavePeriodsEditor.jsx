import React from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * LeavePeriodsEditor
 * "휴학한 적이 있나요?" — 없어요 / 있어요(기간 입력). 온보딩의 휴학 단계와, 기능 도입 전 계정에게 한 번 묻는 화면(LeaveGate)이 같이 쓴다.
 * 휴학 "수"만으로는 언제 쉬었는지 몰라 개편 당시 학년(학칙시행규칙 제13조③) 같은 판단이 추정에 기댔다 — 그래서 기간을 받는다(server/services/leavePeriods.js).
 * 휴학 사유는 묻지 않는다. 검증(입학 전·먼 미래·겹침)은 서버가 하고, 여기서는 고를 수 있는 연도 범위만 좁힌다.
 *
 * draft: { hasLeave: null | boolean, periods: [{ startYear, startSemester, semesters }] }
 *  - hasLeave null: 아직 고르지 않음, false: 휴학 없음, true: periods가 휴학 기간
 */

const MAX_SEMESTERS = 12;

// eslint-disable-next-line react-refresh/only-export-components -- 온보딩·LeaveGate가 같이 쓰는 변환 헬퍼라 컴포넌트와 함께 export함.
export function draftFromPeriods(periods) {
  if (periods == null) return { hasLeave: null, periods: [] };
  return { hasLeave: periods.length > 0, periods: periods.map((p) => ({ ...p })) };
}

/** 저장할 값([] 또는 기간 목록). 아직 다 고르지 않았으면 null. */
// eslint-disable-next-line react-refresh/only-export-components
export function periodsFromDraft(draft) {
  if (!draft || draft.hasLeave === null) return null;
  if (draft.hasLeave === false) return [];
  if (draft.periods.length === 0) return null;
  return draft.periods.map((p) => ({ startYear: Number(p.startYear), startSemester: Number(p.startSemester), semesters: Number(p.semesters) }));
}

/** 사람이 읽는 한 줄 요약(요약 화면용). */
// eslint-disable-next-line react-refresh/only-export-components
export function describeLeave(periods, t) {
  if (periods == null) return null;
  if (periods.length === 0) return t('leave.summaryNone');
  if (periods.length === 1) {
    const [p] = periods;
    return t('leave.summaryValue', { year: p.startYear, semester: p.startSemester, count: p.semesters });
  }
  // 여러 번 쉬었으면 요약 한 줄에는 합계만 — 기간 자체는 항목을 눌러 휴학 단계에서 본다.
  return t('leave.summaryMulti', { total: periods.reduce((sum, p) => sum + p.semesters, 0), times: periods.length });
}

/** 서버 오류 코드 → 사전 키. */
// eslint-disable-next-line react-refresh/only-export-components
export function leaveErrorKey(code) {
  return ['LEAVE_BEFORE_ADMISSION', 'LEAVE_IN_FUTURE', 'LEAVE_PERIODS_OVERLAP'].includes(code) ? `leave.err.${code}` : 'leave.err.save';
}

/**
 * Props:
 * - draft, onChange(draft)
 * - firstYear: 처음 다닌 학년도(편입생은 편입 연도) — 이보다 이른 연도는 고를 수 없다
 * - lastYear: 고를 수 있는 마지막 학년도(다음 학기까지)
 */
function LeavePeriodsEditor({ draft, onChange, firstYear, lastYear }) {
  const { t } = useI18n();
  const years = [];
  for (let y = lastYear; y >= firstYear; y--) years.push(y);

  const setPeriod = (index, key, value) =>
    onChange({ ...draft, periods: draft.periods.map((p, i) => (i === index ? { ...p, [key]: Number(value) } : p)) });
  const addPeriod = () =>
    onChange({ ...draft, periods: [...draft.periods, { startYear: lastYear, startSemester: 1, semesters: 1 }] });
  const removePeriod = (index) => onChange({ ...draft, periods: draft.periods.filter((_, i) => i !== index) });

  return (
    <>
      <div className="onb-option-list">
        <button
          type="button"
          className={'onb-option-card' + (draft.hasLeave === false ? ' selected' : '')}
          onClick={() => onChange({ hasLeave: false, periods: [] })}
        >
          <span className="onb-option-title">{t('leave.none')}</span>
        </button>
        <button
          type="button"
          className={'onb-option-card' + (draft.hasLeave === true ? ' selected' : '')}
          onClick={() =>
            onChange({
              hasLeave: true,
              periods: draft.periods.length > 0 ? draft.periods : [{ startYear: Math.max(firstYear, lastYear - 1), startSemester: 1, semesters: 2 }],
            })
          }
        >
          <span className="onb-option-title">{t('leave.some')}</span>
          <span className="onb-option-caption">{t('leave.some.caption')}</span>
        </button>
      </div>

      {draft.hasLeave === true && (
        <div className="leave-period-list">
          {draft.periods.map((p, i) => (
            <div key={i} className="leave-period-row">
              <select
                className="onb-select"
                aria-label={t('leave.period.year')}
                value={p.startYear}
                onChange={(e) => setPeriod(i, 'startYear', e.target.value)}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {t('leave.period.yearN', { year: y })}
                  </option>
                ))}
              </select>
              <select
                className="onb-select"
                aria-label={t('leave.period.semester')}
                value={p.startSemester}
                onChange={(e) => setPeriod(i, 'startSemester', e.target.value)}
              >
                {[1, 2].map((s) => (
                  <option key={s} value={s}>
                    {t('leave.period.semesterN', { semester: s })}
                  </option>
                ))}
              </select>
              <select
                className="onb-select"
                aria-label={t('leave.period.count')}
                value={p.semesters}
                onChange={(e) => setPeriod(i, 'semesters', e.target.value)}
              >
                {Array.from({ length: MAX_SEMESTERS }, (_, k) => k + 1).map((n) => (
                  <option key={n} value={n}>
                    {t('leave.period.countN', { count: n })}
                  </option>
                ))}
              </select>
              {draft.periods.length > 1 && (
                <button type="button" className="onb-skip-link" onClick={() => removePeriod(i)}>
                  {t('leave.remove')}
                </button>
              )}
            </div>
          ))}
          <button type="button" className="settings-theme-btn" onClick={addPeriod}>
            {t('leave.add')}
          </button>
        </div>
      )}
    </>
  );
}

export default LeavePeriodsEditor;
