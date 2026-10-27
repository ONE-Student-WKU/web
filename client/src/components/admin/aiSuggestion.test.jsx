import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { splitHighlights, suggestionText, suggestionTone, parseSuggestedAction } from './adminFormat.js';
import { AiSuggestionBadge, AiSuggestionBox, HighlightedText } from './AiSuggestion.jsx';

/**
 * client/src/components/admin/aiSuggestion.test.jsx
 * AI 사전 분류(#458)의 관리자 표시: 제안 조치 이름·색, 제재 창에 미리 고를 범위·기간, 원문 형광펜(<mark>, HTML로 해석하지 않음),
 * 제안의 계산 근거(심각도·이전 조치 수).
 */

describe('제안 조치 이름·색', () => {
  it('배지는 짧게, 상세는 정식 이름으로', () => {
    expect(suggestionText('account:7d')).toBe('계정 정지 7일');
    expect(suggestionText('account:7d', true)).toBe('서비스 전체 이용 정지 7일');
    expect(suggestionText('account:permanent')).toBe('계정 정지 영구');
    expect(suggestionText('post_apply:7d')).toBe('글쓰기·신청 금지 7일');
    expect(suggestionText('warning')).toBe('경고');
    expect(suggestionText('reject')).toBe('반려');
    expect(suggestionText('none')).toBe('조치 없음');
  });

  it('조치 없음·승인은 회색, 경고·반려는 노랑, 제한·정지는 빨강', () => {
    expect(suggestionTone('none')).toBe('');
    expect(suggestionTone('reject')).toBe('warn');
    expect(suggestionTone('full:30d')).toBe('danger');
  });

  it('제재 창에 미리 고를 범위·기간', () => {
    expect(parseSuggestedAction('full:30d')).toEqual({ scope: 'full', duration: '30d' });
    expect(parseSuggestedAction('warning')).toBeNull();
  });
});

describe('형광펜', () => {
  it('원문을 조각으로 나누고, 겹치거나 없는 조각은 무시한다', () => {
    expect(splitHighlights('일을 이따위로 하냐 빨리', ['이따위로', '없는 말'])).toEqual([
      { text: '일을 ', mark: false },
      { text: '이따위로', mark: true },
      { text: ' 하냐 빨리', mark: false },
    ]);
  });

  it('<mark>로 감싸고, 글 속 HTML은 글자 그대로 둔다', () => {
    const { container } = render(
      <p>
        <HighlightedText text={'<b>굵게</b> 오픈카톡 링크'} highlights={['오픈카톡 링크']} />
      </p>
    );
    expect(container.querySelector('mark.ai-mark').textContent).toBe('오픈카톡 링크');
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>굵게</b>');
  });
});

describe('제안 배지·상자', () => {
  it('분류가 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<AiSuggestionBadge suggestion={null} />);
    expect(container.textContent).toBe('');
  });

  it('상자는 제안 조치와 계산 근거(심각도, 이전 조치 수 → 몇 번째 단계)를 보여준다', () => {
    render(<AiSuggestionBox suggestion={{ severity: 'abuse', action: 'account:7d', priorCount: 1, highlights: [] }} openLabel="학생 제재" />);
    expect(screen.getByText('제안: 서비스 전체 이용 정지 7일')).toBeInTheDocument();
    expect(screen.getByText('문의 욕설·비방 · 이전 경고·제재 1회 → 2번째 단계')).toBeInTheDocument();
    expect(screen.getByText('[학생 제재]를 열면 이 범위·기간이 골라져 있어요')).toBeInTheDocument();
  });

  it('조치 없음 제안은 상자를 그리지 않는다(배지만)', () => {
    const { container } = render(<AiSuggestionBox suggestion={{ severity: 'none', action: 'none', priorCount: 0, highlights: [] }} />);
    expect(container.textContent).toBe('');
  });
});
