import { describe, it, expect } from 'vitest';
import { cleanRequirementNote } from './displayText.js';

describe('cleanRequirementNote', () => {
  it('검수용 메모만 지우고 학생용 안내는 남긴다', () => {
    expect(cleanRequirementNote('졸업(시험·작품)논문 합격 필수 (P/F, 4학년 2학기, 신설 커리큘럼 원문 검증됨)'))
      .toBe('졸업(시험·작품)논문 합격 필수 (P/F, 4학년 2학기)');
  });
  it('메모가 없으면 그대로 둔다', () => {
    expect(cleanRequirementNote('캡스톤디자인 중 1과목 필수 이수')).toBe('캡스톤디자인 중 1과목 필수 이수');
  });
  it('빈 값은 빈 문자열', () => {
    expect(cleanRequirementNote(null)).toBe('');
  });
});
