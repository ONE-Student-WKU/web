import React, { useEffect, useMemo, useState } from 'react';
import { getAdminStatsTrend } from '../api/chatApi.js';
import { readCache, writeCache, clearCache } from '../utils/sessionCache.js';
import { TREND_METRICS, TREND_RANGES } from '../utils/adminTrendMetrics.js';
import { axisTicks, pointLabel } from '../utils/trendFormat.js';
import TrendChart from './TrendChart.jsx';

// Home과 같은 방식의 캐시 — 범위별로 마지막에 받은 추이를 모듈 스코프(화면을 오가는 동안)와 sessionStorage(새로고침)에 들고 있다가,
// 다시 들어오면 그걸 바로 보여주고 뒤에서 새 값으로 갈아끼운다. 그 범위를 처음 볼 때만 로딩이 보인다.
let trendCache = readCache('admin_trend') || {};

// 로그아웃·계정 삭제 시 App.jsx가 부른다 — 관리자 데이터가 다음 계정 화면에 잠깐 비치지 않게.
// eslint-disable-next-line react-refresh/only-export-components -- App.jsx가 재사용하는 캐시 리셋 함수라 의도적으로 컴포넌트와 같이 export함.
export function resetAdminTrendCache() {
  trendCache = {};
  clearCache('admin_trend');
}

// 범위별로 이 그래프가 무엇을 센 것인지(구간 경계, 지워지는 기록)를 알려 주는 안내.
const RANGE_NOTE = {
  hour: '현재 시각이 든 시(진행 중)까지 24칸이라, 현황 칸의 24시간 수치와 조금 다를 수 있어요.',
  day: '하루는 한국 시간 기준이고 오늘(진행 중)까지예요. 탈퇴한 계정의 가입·챗봇 기록은 계정과 함께 지워져 과거 값에서 빠져요.',
};

/**
 * AdminTrendView
 * 관리자 통계의 "추이" 탭 — 24시간(1시간 단위)·7일·30일·1년·전체(하루 단위) 그래프, 점을 가리키면 그 때의 값, 표 보기.
 * 바로 앞 같은 길이 기간(서버 previous)을 옅은 점선으로 겹치고 "그 전 30일보다 N건 많아요"처럼 비교한다(전체는 앞 기간이 없다).
 * 방문자는 합계가 "한 번 이상 온 사람 수"라 앞 기간과는 하루 평균으로 비교한다.
 *
 * Props:
 * - metric / onChangeMetric: TREND_METRICS의 key
 * - range / onChangeRange: TREND_RANGES의 key
 */
function AdminTrendView({ metric, onChangeMetric, range, onChangeRange }) {
  const [data, setData] = useState(trendCache[range] || null);
  const [error, setError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(null);

  useEffect(() => {
    setData(trendCache[range] || null);
    setError(false);
    setActiveIndex(null);
    let cancelled = false;
    getAdminStatsTrend(range)
      .then((fresh) => {
        trendCache = { ...trendCache, [range]: fresh };
        writeCache('admin_trend', trendCache);
        if (!cancelled) setData(fresh);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const current = TREND_METRICS.find((m) => m.key === metric) || TREND_METRICS[0];
  const points = data?.points;
  const previousPoints = data?.previous?.points;
  // 앞 기간에 기록이 하나도 없으면(기록을 쌓기 전) 점선·비교를 아예 그리지 않는다 — 바닥에 붙은 점선은 "0이었다"로 잘못 읽힌다.
  const prevValues = useMemo(() => {
    const list = previousPoints ? previousPoints.map((p) => p[current.key] ?? 0) : null;
    return list && list.some((v) => v > 0) ? list : null;
  }, [previousPoints, current.key]);
  const unit = data?.unit;
  const values = useMemo(() => (points ? points.map((p) => p[current.key] ?? 0) : []), [points, current.key]);
  const ticks = useMemo(() => (points ? axisTicks(points, unit) : []), [points, unit]);
  const names = useMemo(() => (points ? points.map((p, i) => pointLabel(p, unit, i === points.length - 1)) : []), [points, unit]);
  const barLabels = useMemo(() => names.map((name, i) => `${name} ${values[i].toLocaleString()}${current.unit}`), [names, values, current.unit]);

  // 방문자는 날마다의 수를 더하면 같은 사람이 여러 번 세져서, 합계 자리에는 서버가 센 "기간 동안 한 번 이상 온 사람 수"를 쓴다.
  const total = current.key === 'visitors' && data?.uniqueVisitors != null ? data.uniqueVisitors : values.reduce((sum, v) => sum + v, 0);
  // 방문자는 시간대별 기록이 없어 24시간(1시간 단위)에서는 그래프 대신 안내만 보여준다.
  const dailyOnlyBlocked = Boolean(current.dailyOnly && unit === 'hour');
  const peak = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
  const rangeTab = TREND_RANGES.find((r) => r.key === range)?.tab;
  const peakWord = unit === 'hour' ? '시간' : '날';
  const compare = compareText({ values, prevValues, total, current, rangeTab, unit });

  return (
    <>
      <div className="seg admin-filter" role="tablist" aria-label="기간 선택">
        {TREND_RANGES.map((r) => (
          <button key={r.key} type="button" role="tab" aria-selected={r.key === range} className={r.key === range ? 'active' : ''} onClick={() => onChangeRange(r.key)}>
            {r.tab}
          </button>
        ))}
      </div>
      <div className="admin-chips" role="tablist" aria-label="지표 선택">
        {TREND_METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={m.key === current.key}
            className={m.key === current.key ? 'on' : ''}
            onClick={() => {
              setActiveIndex(null);
              onChangeMetric(m.key);
            }}
          >
            {m.tab}
          </button>
        ))}
      </div>

      {!points ? (
        error ? (
          <p className="home-error">추이를 불러오지 못했어요. 새로고침 후 다시 시도해주세요.</p>
        ) : (
          <div className="skeleton skeleton-card" style={{ height: 300 }} aria-busy="true" aria-label="불러오는 중" />
        )
      ) : dailyOnlyBlocked ? (
        <div className="admin-trend-card">
          <p className="courses-manual-hint">{current.tab}는 하루 단위로만 세요. 7일 이상 기간을 골라주세요.</p>
        </div>
      ) : (
        <div className="admin-trend-card">
          <p className="admin-stat-label">
            {rangeTab} {current.tab}
          </p>
          <div className="admin-stat-value admin-trend-total">
            {total.toLocaleString()}
            <span className="admin-trend-unit">{current.unit}</span>
            {compare && <em className={`admin-compare ${compare.tone}`}>{compare.text}</em>}
          </div>
          <p className="admin-trend-readout" aria-live="polite">
            {activeIndex !== null
              ? `${names[activeIndex]} · ${values[activeIndex].toLocaleString()}${current.unit}`
              : total > 0
                ? `가장 많았던 ${peakWord} ${names[peak]} · ${values[peak].toLocaleString()}${current.unit}`
                : '이 기간에 기록된 건이 없어요.'}
          </p>

          <TrendChart
            values={values}
            ticks={ticks}
            barLabels={barLabels}
            prevValues={prevValues}
            activeIndex={activeIndex}
            onActiveChange={setActiveIndex}
            ariaLabel={`${rangeTab} ${current.tab} ${unit === 'hour' ? '시간별' : '일별'} 그래프`}
          />

          {prevValues && (
            <p className="admin-legend" aria-hidden="true">
              <span>
                <i className="bar" />
                이번 {rangeTab}
              </span>
              <span>
                <i className="line" />그 전 {rangeTab}
              </span>
            </p>
          )}

          <p className="courses-manual-hint">
            {current.hint} {current.key === 'visitors' && `위 합계(${total.toLocaleString()}명)는 이 기간에 한 번 이상 온 사람 수라 막대를 더한 값과 달라요.`} {RANGE_NOTE[unit]}
          </p>

          <details className="admin-trend-table">
            <summary>표로 보기</summary>
            <table>
              <thead>
                <tr>
                  <th scope="col">{unit === 'hour' ? '시간' : '날짜'}</th>
                  <th scope="col">{current.tab}</th>
                </tr>
              </thead>
              <tbody>
                {names
                  .map((name, i) => ({ name, i }))
                  .reverse()
                  .map(({ name, i }) => (
                    <tr key={points[i].at}>
                      <th scope="row">{name}</th>
                      <td>
                        {values[i].toLocaleString()}
                        {current.unit}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </>
  );
}

// 바로 앞 기간과의 비교 문구. 앞 기간에 기록이 하나도 없으면(기록을 쌓기 전) 비교가 틀리므로 보여주지 않는다.
function compareText({ values, prevValues, total, current, rangeTab, unit }) {
  if (!prevValues) return null;
  const prevSum = prevValues.reduce((sum, v) => sum + v, 0);
  if (current.key === 'visitors') {
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    const prevAvg = prevSum / prevValues.length;
    return { text: `하루 평균 ${avg.toFixed(1)}명 · 그 전 ${rangeTab} ${prevAvg.toFixed(1)}명`, tone: avg > prevAvg ? 'up' : avg < prevAvg ? 'down' : '' };
  }
  const diff = total - prevSum;
  const period = unit === 'hour' ? '그 전 24시간' : `그 전 ${rangeTab}`;
  if (diff === 0) return { text: `${period}과 같아요`, tone: '' };
  // 답 못 찾은 질문은 늘면 나쁜 신호라 경고색으로 보여준다.
  const upTone = current.key === 'chatNotFound' ? 'warn' : 'up';
  return { text: `${period}보다 ${Math.abs(diff).toLocaleString()}${current.unit} ${diff > 0 ? '많아요' : '적어요'}`, tone: diff > 0 ? upTone : 'down' };
}

export default AdminTrendView;
