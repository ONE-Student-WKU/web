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

  it('출처 메모(조문·책자 쪽수·졸업인증제 그룹·학교 안내)는 걷어 내고 학생에게 필요한 조건만 남긴다', () => {
    expect(cleanRequirementNote('편입생 교양: "종교와원불교" 필수 이수(본교·원광보건대학교를 졸업한 편입생은 제외 — 학교 편입생 교육과정 안내, 시행규칙 제10조 제2항)'))
      .toBe('편입생 교양: "종교와원불교" 필수 이수(본교·원광보건대학교를 졸업한 편입생은 제외)');
    expect(cleanRequirementNote('캡스톤디자인(기업연계프로젝트)·종합설계 중 1과목 필수 이수 (졸업인증제 "나" 그룹, 2020학번부터)'))
      .toBe('캡스톤디자인(기업연계프로젝트)·종합설계 중 1과목 필수 이수');
    expect(cleanRequirementNote('교직과정 이수자: 졸업인증제 기본영역을 교직(교육봉사활동·교육실습)으로 대체해 둘 다 필수 이수 (2026 교육과정 책자 졸업인증제 공통)'))
      .toBe('교직과정 이수자: 졸업인증제 기본영역을 교직(교육봉사활동·교육실습)으로 대체해 둘 다 필수 이수');
    expect(cleanRequirementNote('기업연계프로젝트1(종합설계1)·2(종합설계2) 둘 다 필수 이수 (컴퓨터·소프트웨어공학전공 학과 규칙 — 책자 "나" 그룹 기준은 1과목이지만 학과가 둘 다 요구, 과사무실 안내 2026-10-16)'))
      .toBe('기업연계프로젝트1(종합설계1)·2(종합설계2) 둘 다 필수 이수 (컴퓨터·소프트웨어공학전공 학과 규칙)');
    // 학생에게 필요한 괄호(P/F, 학기)는 그대로 둔다
    expect(cleanRequirementNote('졸업(시험·작품)논문 합격 필수 (P/F, 4학년 2학기)')).toBe('졸업(시험·작품)논문 합격 필수 (P/F, 4학년 2학기)');
  });
});
