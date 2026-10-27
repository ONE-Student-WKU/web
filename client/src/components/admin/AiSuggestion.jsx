import React from 'react';
import { splitHighlights, suggestionText, suggestionTone, SEVERITY_LABEL } from './adminFormat.js';

/**
 * AI 사전 분류(#458)의 제안 표시 — 관리자 화면 전용(학생 화면에는 나오지 않는다). 관리자 화면이라 한국어 문구를 그대로 쓴다.
 * 서버가 내려주는 aiSuggestion: { severity, action, priorCount, highlights } — 분류 전·실패면 null이고 그때는 아무것도 그리지 않는다.
 */

// 목록·상세 위쪽의 작은 배지 "제안 ○○".
export function AiSuggestionBadge({ suggestion }) {
  if (!suggestion) return null;
  const tone = suggestionTone(suggestion.action);
  return (
    <span className={`ai-result${tone ? ` ai-result--${tone}` : ''}`} title="AI가 내용을 보고 제안한 조치예요">
      {suggestionText(suggestion.action)}
    </span>
  );
}

// 원문에 형광펜 — 근거가 된 조각만 <mark>로 감싼다.
export function HighlightedText({ text, highlights }) {
  const parts = splitHighlights(text, highlights);
  if (!parts.length) return text || null;
  return parts.map((p, i) =>
    p.mark ? (
      <mark key={i} className="ai-mark">
        {p.text}
      </mark>
    ) : (
      <React.Fragment key={i}>{p.text}</React.Fragment>
    )
  );
}

// 상세의 제안 상자 — 제안 조치와 계산 근거(심각도, 이전 조치 수 → 몇 번째 단계). openLabel이 있으면 제재 창을 열 때 미리 골라 둔다고 알린다.
export function AiSuggestionBox({ suggestion, openLabel = null }) {
  if (!suggestion || suggestion.action === 'none' || suggestion.action === 'approve') return null;
  const severity = SEVERITY_LABEL[suggestion.severity] || suggestion.severity;
  const step = suggestion.priorCount > 0 ? `이전 경고·제재 ${suggestion.priorCount}회 → ${suggestion.priorCount + 1}번째 단계` : '이전 조치 없음 → 처음 단계';
  return (
    <div className="ai-suggest">
      <b>제안: {suggestionText(suggestion.action, true)}</b>
      <span className="post-meta">
        {severity} · {step}
      </span>
      {openLabel && <span className="post-meta">[{openLabel}]를 열면 이 범위·기간이 골라져 있어요</span>}
    </div>
  );
}
