import React from 'react';

/**
 * BrandTitle.jsx
 * 화면 머리의 서비스 이름과 로고(2026-10-24 결정: "8학기 원").
 * 로고는 8조각 원이다 — 지난 학기 5조각(잉크), 이번 학기 1조각(강조색), 남은 학기 2조각(연한 색).
 * 색은 App.css의 .brand-mark-* 규칙이 테마 변수로 칠해서 다크 모드에서도 따라간다.
 * client/public/favicon.svg와 같은 도형이다(바꾸면 둘 다 바꾼다).
 */
const RING = { cx: 32, cy: 32, r: 16, strokeWidth: 18, fill: 'none' };
// 둘레(2π·16 ≈ 100.53)를 8등분(12.57)하고 조각 사이에 1.5만큼 틈을 둔다.
const SEGMENT = '11.07 1.5';

export function BrandMark({ size = 20 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g transform="rotate(-90 32 32)">
        <circle {...RING} className="brand-mark-rest" strokeDasharray={SEGMENT} />
        <circle {...RING} className="brand-mark-done" strokeDasharray={`${SEGMENT} `.repeat(4) + '11.07 200'} />
        <circle {...RING} className="brand-mark-now" strokeDasharray="11.07 200" strokeDashoffset={-62.83} />
      </g>
    </svg>
  );
}

export default function BrandTitle() {
  return (
    <span className="screen-title screen-title-brand">
      <BrandMark />
      ONE Student
    </span>
  );
}
