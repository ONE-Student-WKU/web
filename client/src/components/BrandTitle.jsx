import React from 'react';

/**
 * BrandTitle.jsx
 * 화면 머리의 서비스 이름. "ONE Student"의 O 자리에 로고(2026-10-24 결정: "8학기 원")를 넣는다.
 * 로고는 8조각 원이다 — 지난 학기 5조각(진행 막대와 같은 파랑), 이번 학기 1조각(노랑), 남은 학기 2조각(연한 색).
 * 색은 App.css의 .brand-mark-* 규칙이 테마 변수로 칠해서 다크 모드에서도 따라간다.
 * client/public/favicon.svg와 같은 도형이다(바꾸면 둘 다 바꾼다).
 */
// 바깥 반지름 25, 안쪽 구멍 반지름 8.5인 고리(중심선 반지름 16.75, 두께 16.5).
const RING = { cx: 32, cy: 32, r: 16.75, strokeWidth: 16.5, fill: 'none' };
// 둘레(2π·16.75 ≈ 105.24)를 8등분(13.155)하고 조각 사이에 1.5만큼 틈을 둔다.
const SEGMENT = '11.655 1.5';

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="7 7 50 50" aria-hidden="true">
      <g transform="rotate(-90 32 32)">
        <circle {...RING} className="brand-mark-rest" strokeDasharray={SEGMENT} />
        <circle {...RING} className="brand-mark-done" strokeDasharray={`${SEGMENT} `.repeat(4) + '11.655 200'} />
        <circle {...RING} className="brand-mark-now" strokeDasharray="11.655 200" strokeDashoffset={-65.78} />
      </g>
    </svg>
  );
}

// 화면 낭독기에는 "ONE Student"를 그대로 읽히고, 눈에는 로고 + "NE Student"로 보인다.
export default function BrandTitle() {
  return (
    <span className="screen-title screen-title-brand">
      <span className="sr-only">ONE Student</span>
      <span aria-hidden="true">
        <BrandMark />
        NE Student
      </span>
    </span>
  );
}
