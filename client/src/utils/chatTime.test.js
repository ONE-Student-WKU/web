import { describe, it, expect } from 'vitest';
import { formatChatTime } from './chatTime.js';

describe('formatChatTime', () => {
  const sentAt = '2026-10-17T06:23:36+09:00';

  it('영어 화면이면 브라우저 언어와 상관없이 AM/PM으로', () => {
    expect(formatChatTime(sentAt, 'en')).toMatch(/AM|PM/);
    expect(formatChatTime(sentAt, 'en')).not.toMatch(/오전|오후/);
  });

  it('한국어 화면이면 오전/오후로', () => {
    expect(formatChatTime(sentAt, 'ko')).toMatch(/오전|오후/);
  });

  it('시각이 없거나 잘못되면 빈 글자', () => {
    expect(formatChatTime(undefined, 'ko')).toBe('');
    expect(formatChatTime('not-a-date', 'en')).toBe('');
  });
});
