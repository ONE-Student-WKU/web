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

// 기간의 세 칸(시작 학년도·학기·학기 수)을 모두 골랐는가. 칸은 "–"(null)로 비어 시작한다 — 값이 미리 들어 있으면 입력한 것처럼 보였다.
const isComplete = (p) => p.startYear != null && p.startSemester != null && p.semesters != null;

/** 저장할 값([] 또는 기간 목록). 아직 다 고르지 않았으면 null. */
// eslint-disable-next-line react-refresh/only-export-components
export function periodsFromDraft(draft) {
  if (!draft || draft.hasLeave === null) return null;
  if (draft.hasLeave === false) return [];
  if (draft.periods.length === 0 || !draft.periods.every(isComplete)) return null;
  return draft.periods.map((p) => ({ startYear: Number(p.startYear), startSemester: Number(p.startSemester), semesters: Number(p.semesters) }));
}

/** 휴학이 끝나는 학기 — 2023학년도 2학기부터 2학기면 2024학년도 1학기. */
// eslint-disable-next-line react-refresh/only-export-components
export function leavePeriodEnd({ startYear, startSemester, semesters }) {
  const index = startYear * 2 + (startSemester - 1) + (semesters - 1);
  return { year: Math.floor(index / 2), semester: (index % 2) + 1 };
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
 *
 * 화면(2026-10-22 개편): 기간 입력을 "있어요" 카드 안에 넣어 선택지와 한 덩어리로 보이게 하고, "[2023]학년도 [2]학기부터 / [2]학기 동안
 * 쉬었어요"처럼 문장을 채우듯 고르게 한다. 예전에는 선택지 아래에 같은 모양의 입력 상자가 따로 생기고 칸 이름이 없어, 무엇을 고르는
 * 칸인지 알아보기 어려웠다. 고른 뒤에는 "언제부터 언제까지"를 한 줄로 풀어 보여 준다.
 */
function LeavePeriodsEditor({ draft, onChange, firstYear, lastYear }) {
  const { t, tRich } = useI18n();
  const years = [];
  for (let y = lastYear; y >= firstYear; y--) years.push(y);

  const emptyPeriod = { startYear: null, startSemester: null, semesters: null };
  const setPeriod = (index, key, value) =>
    onChange({ ...draft, periods: draft.periods.map((p, i) => (i === index ? { ...p, [key]: value === '' ? null : Number(value) } : p)) });
  const addPeriod = () => onChange({ ...draft, periods: [...draft.periods, { ...emptyPeriod }] });
  const removePeriod = (index) => onChange({ ...draft, periods: draft.periods.filter((_, i) => i !== index) });
  const termText = (year, semester) => t('leave.termN', { year, semester });

  const select = (period, index, key, label, values) => (
    <select className="onb-select" aria-label={label} value={period[key] ?? ''} onChange={(e) => setPeriod(index, key, e.target.value)}>
      <option value="">–</option>
      {values.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );

  const summary = (p) => {
    if (!isComplete(p)) return null;
    const end = leavePeriodEnd(p);
    if (p.semesters === 1) return tRich('leave.summaryOne', { term: termText(p.startYear, p.startSemester) });
    return tRich('leave.summaryRange', { from: termText(p.startYear, p.startSemester), to: termText(end.year, end.semester) });
  };

  return (
    <div className="onb-option-list">
      <button
        type="button"
        className={'onb-option-card' + (draft.hasLeave === false ? ' selected' : '')}
        onClick={() => onChange({ hasLeave: false, periods: [] })}
      >
        <span className="onb-option-title">{t('leave.none')}</span>
      </button>

      {draft.hasLeave === true ? (
        <div className="leave-choice">
          <button type="button" className="onb-option-card" aria-pressed="true">
            <span className="onb-option-title">{t('leave.some')}</span>
            <span className="onb-option-caption">{t('leave.some.caption')}</span>
          </button>
          <div className="leave-choice-body">
            {draft.periods.map((p, i) => (
              <div key={i} className="leave-period">
                {draft.periods.length > 1 && (
                  <div className="leave-period-head">
                    <span className="leave-period-name">{t('leave.periodN', { n: i + 1 })}</span>
                    <button type="button" className="leave-text-btn danger" onClick={() => removePeriod(i)}>
                      {t('leave.remove')}
                    </button>
                  </div>
                )}
                <div className="leave-sentence">
                  {select(p, i, 'startYear', t('leave.period.year'), years)}
                  <span>{t('leave.sentence.year')}</span>
                  {select(p, i, 'startSemester', t('leave.period.semester'), [1, 2])}
                  <span>{t('leave.sentence.from')}</span>
                </div>
                <div className="leave-sentence">
                  {select(p, i, 'semesters', t('leave.period.count'), Array.from({ length: MAX_SEMESTERS }, (_, k) => k + 1))}
                  <span>{t('leave.sentence.count')}</span>
                </div>
                {summary(p) && <p className="leave-summary">{summary(p)}</p>}
              </div>
            ))}
            <button type="button" className="leave-text-btn" onClick={addPeriod}>
              {t('leave.add')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="onb-option-card"
          onClick={() => onChange({ hasLeave: true, periods: draft.periods.length > 0 ? draft.periods : [{ ...emptyPeriod }] })}
        >
          <span className="onb-option-title">{t('leave.some')}</span>
          <span className="onb-option-caption">{t('leave.some.caption')}</span>
        </button>
      )}
    </div>
  );
}


export default LeavePeriodsEditor;
