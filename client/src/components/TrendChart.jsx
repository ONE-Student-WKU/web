import React from 'react';
import { niceMax } from '../utils/chartScale.js';
import { MAX_BAR_POINTS } from '../utils/trendFormat.js';

const WIDTH = 360;
const HEIGHT = 180;
const MARGIN = { top: 8, right: 8, bottom: 22, left: 30 };
const MAX_BAR_WIDTH = 24;
const BAR_GAP = 2; // 막대 사이 표면색 간격
const BAR_RADIUS = 4; // 끝(윗면)만 둥글게, 기준선 쪽은 직각

// 위쪽 두 모서리만 둥근 막대. 높이가 반지름보다 작으면 반지름을 높이에 맞춰 줄인다.
function barPath(x, y, width, height) {
  const r = Math.min(BAR_RADIUS, width / 2, height);
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`;
}

/**
 * TrendChart
 * 한 계열의 시간·날짜별 추이. 점이 MAX_BAR_POINTS 이하면 막대(24시간, 30일, 짧은 전체), 넘으면 면적이 있는 선(1년, 긴 전체)으로 그린다.
 * 값은 위쪽 읽는 줄(activeIndex를 부모가 보여 줌)과 표 보기로도 볼 수 있어, 이 그래프는 값을 직접 쓰지 않는다.
 * - 막대: 막대마다 칸 전체 높이의 투명한 영역이 호버·포커스·탭 대상이다(Tab으로 하나씩 이동).
 * - 선: 점이 많아 칸마다 포커스를 두면 Tab이 수백 번이라, 그래프 전체가 포커스 하나이고 ←/→로 점을 옮긴다(Home/End는 처음/끝).
 *   포인터는 가로 위치에서 가장 가까운 점을 잡는다(터치로 훑을 수 있게 세로 스크롤만 브라우저에 맡긴다).
 *
 * Props:
 * - values: number[] — 오래된 순
 * - ticks: [{ index, label }] — x축에 글자를 쓸 점
 * - barLabels: string[] — 점별 화면 낭독용 설명("4시~5시 2명" 같은 때와 값)
 * - prevValues: number[] | null — 바로 앞 같은 길이 기간(같은 칸 수). 옅은 점선으로 겹친다(장식이라 화면 낭독기에는 숨긴다).
 * - activeIndex: number | null — 강조할 점
 * - onActiveChange: (index | null) => void
 * - ariaLabel: string
 */
function TrendChart({ values, ticks, barLabels, prevValues = null, activeIndex, onActiveChange, ariaLabel }) {
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const max = niceMax(Math.max(0, ...values, ...(prevValues || [])));
  const slot = plotWidth / values.length;
  const baseline = MARGIN.top + plotHeight;
  const lastIndex = values.length - 1;
  const isLine = values.length > MAX_BAR_POINTS;
  const yOf = (value) => baseline - (value / max) * plotHeight;
  const xOfCenter = (i) => MARGIN.left + (i + 0.5) * slot;

  const yTicks = [0, max / 2, max].map((tick) => (
    <g key={tick}>
      <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yOf(tick)} y2={yOf(tick)} className="trend-chart-grid" />
      <text x={MARGIN.left - 6} y={yOf(tick)} textAnchor="end" dominantBaseline="middle" className="trend-chart-axis">
        {tick.toLocaleString()}
      </text>
    </g>
  ));

  // 앞 기간 점선 — 막대·선 그래프 둘 다 같은 칸 가운데를 잇는다.
  const prevLine =
    prevValues && prevValues.length === values.length ? (
      <path d={prevValues.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOfCenter(i)},${yOf(v)}`).join(' ')} className="trend-chart-prev" aria-hidden="true" />
    ) : null;

  const xLabels = ticks.map(({ index, label }) => (
    <text
      key={index}
      x={xOfCenter(index)}
      y={HEIGHT - 6}
      textAnchor={index === lastIndex ? 'end' : index === 0 ? 'start' : 'middle'}
      className="trend-chart-axis"
    >
      {label}
    </text>
  ));

  if (!isLine) {
    const barWidth = Math.min(MAX_BAR_WIDTH, slot - BAR_GAP);
    return (
      <svg className="trend-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label={ariaLabel}>
        {yTicks}
        {values.map((value, i) => {
          const slotX = MARGIN.left + i * slot;
          const height = (value / max) * plotHeight;
          return (
            <g
              key={i}
              className={'trend-chart-col' + (activeIndex === i ? ' active' : '')}
              tabIndex={0}
              role="img"
              aria-label={barLabels[i]}
              onPointerEnter={() => onActiveChange(i)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && onActiveChange(null)}
              onClick={() => onActiveChange(i)}
              onFocus={() => onActiveChange(i)}
              onBlur={() => onActiveChange(null)}
            >
              {/* 막대보다 훨씬 큰 히트 영역 — 한두 건짜리 낮은 막대도 칸 어디를 눌러도 반응한다 */}
              <rect x={slotX} y={MARGIN.top} width={slot} height={plotHeight + 1} className="trend-chart-hit" />
              {height > 0 && <path d={barPath(slotX + (slot - barWidth) / 2, baseline - height, barWidth, height)} className="trend-chart-bar" />}
              <rect x={slotX} y={MARGIN.top} width={slot} height={plotHeight} className="trend-chart-focus" />
            </g>
          );
        })}
        <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={baseline} y2={baseline} className="trend-chart-baseline" />
        {prevLine}
        {xLabels}
      </svg>
    );
  }

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOfCenter(i)},${yOf(v)}`).join(' ');
  const area = `${line} L${xOfCenter(lastIndex)},${baseline} L${xOfCenter(0)},${baseline} Z`;
  const indexAt = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    return Math.max(0, Math.min(lastIndex, Math.floor((x - MARGIN.left) / slot)));
  };
  const handleKeyDown = (e) => {
    const from = activeIndex ?? lastIndex;
    const next = { ArrowLeft: from - 1, ArrowRight: from + 1, Home: 0, End: lastIndex }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onActiveChange(Math.max(0, Math.min(lastIndex, next)));
  };

  return (
    <svg
      className="trend-chart trend-chart--line"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={activeIndex !== null ? barLabels[activeIndex] : ariaLabel}
      tabIndex={0}
      onPointerMove={(e) => onActiveChange(indexAt(e))}
      onPointerDown={(e) => onActiveChange(indexAt(e))}
      onPointerLeave={(e) => e.pointerType === 'mouse' && onActiveChange(null)}
      onKeyDown={handleKeyDown}
      onFocus={() => activeIndex === null && onActiveChange(lastIndex)}
      onBlur={() => onActiveChange(null)}
    >
      {yTicks}
      <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={baseline} y2={baseline} className="trend-chart-baseline" />
      <path d={area} className="trend-chart-area" />
      {prevLine}
      <path d={line} className="trend-chart-line" />
      {activeIndex !== null && (
        <>
          <line x1={xOfCenter(activeIndex)} x2={xOfCenter(activeIndex)} y1={MARGIN.top} y2={baseline} className="trend-chart-cursor" />
          <circle cx={xOfCenter(activeIndex)} cy={yOf(values[activeIndex])} r={4} className="trend-chart-dot" />
        </>
      )}
      {xLabels}
    </svg>
  );
}

export default TrendChart;
