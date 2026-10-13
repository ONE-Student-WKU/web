import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * 졸업요건 화면: 서버가 내려준 근거 신뢰도(status.regulation)를 작게 보여 주고, 자료가 없으면 0/0(NaN) 대신 안내를 보여 주는지.
 * (FINAL_REVIEW F-9·B-26·B-37·B-40, 보정 라운드 A 2-6, DECISIONS D-39) 로그인 없이 API를 mock해서 확인한다.
 */

vi.mock('../api/chatApi.js', () => ({ getGraduationStatus: vi.fn() }));

import { getGraduationStatus } from '../api/chatApi.js';
import GraduationStatus, { resetGraduationCache } from './GraduationStatus.jsx';

const categories = [
  { category: '교양필수', earnedCredits: 5, requiredCredits: 5, requiredCourses: [] },
  { category: '교양선택', earnedCredits: 10, requiredCredits: 20, requiredCourses: [] },
  { category: '전공', earnedCredits: 40, requiredCredits: 115, requiredCourses: [] },
  { category: '일반선택', earnedCredits: 0, requiredCredits: 0, requiredCourses: [] },
];
const status = (over = {}) => ({
  totalRequiredCredits: 140, totalEarnedCredits: 55, categories, certifications: [],
  regulation: { confidence: 'CONFIRMED', confidenceLabel: '확정', flags: [], totalDefinitive: true, schedule4: null, liberalArtsCap: { applied: 52, engineValue: 52 } },
  ...over,
});

async function renderWith(data) {
  getGraduationStatus.mockResolvedValue(data);
  render(<GraduationStatus user={{ name: '홍길동', role: 'student' }} onGoHome={() => {}} onOpenCourses={() => {}} onLogout={() => {}} onOpenSettings={() => {}} onOpenOnboarding={() => {}} onOpenProfile={() => {}} />);
  return screen.findByText('전체 이수학점', { exact: false });
}

describe('GraduationStatus 근거 신뢰도 표시', () => {
  beforeEach(() => {
    resetGraduationCache();
    sessionStorage.clear();
    getGraduationStatus.mockReset();
  });

  it('확정: 배지만 작게 보이고 사유·추정 표시는 없다', async () => {
    await renderWith(status());
    expect(screen.getByText('확정')).toHaveClass('grad-trust-badge', 'ok');
    expect(screen.queryByText('(추정)')).not.toBeInTheDocument();
    expect(document.querySelector('.grad-trust-reason')).toBeNull();
    expect(screen.getByText(/\/ 140학점/)).toBeInTheDocument();
  });

  it('2025학번 이하(basisBookletYear=2026)여도 기준 책자 설명 문구는 보이지 않는다(학생에게는 필요 없는 설명이라 뺐다)', async () => {
    await renderWith(status({ regulation: { ...status().regulation, basisBookletYear: 2026 } }));
    expect(screen.getByText('확정')).toHaveClass('grad-trust-badge', 'ok');
    expect(screen.queryByText(/학번별 이수기준표 기준/)).not.toBeInTheDocument();
  });

  it('추정 + 학칙 [별표 4] 불일치: 배지, 총량 "(추정)", 사유 한 줄에 두 값(130·140)', async () => {
    await renderWith(status({
      regulation: {
        confidence: 'ESTIMATED', confidenceLabel: '추정', totalDefinitive: true,
        flags: [{ code: 'SCHEDULE4_CREDIT_MISMATCH', level: 'ESTIMATED', message: '일반 문구' }],
        schedule4: { schedule4Credits: 130, bookCredits: 140 }, liberalArtsCap: { applied: 52, engineValue: 52 },
      },
    }));
    expect(screen.getByText('추정')).toHaveClass('grad-trust-badge', 'warn');
    expect(screen.getByText('(추정)')).toBeInTheDocument();
    expect(screen.getByText(/학칙 \[별표 4\]는 130학점, 교육과정 책자는 140학점으로 서로 달라요/)).toBeInTheDocument();
    // 숫자는 서버가 준 값 그대로(어느 쪽이 맞는지 화면이 판단하지 않는다)
    expect(screen.getByText(/\/ 140학점/)).toBeInTheDocument();
  });

  it('편입생 총량 미확정(totalDefinitive=false)이면 총량에 "(추정)" 표기', async () => {
    await renderWith(status({
      regulation: { confidence: 'ESTIMATED', confidenceLabel: '추정', totalDefinitive: false, flags: [{ code: 'TRANSFER_TOTAL_UNRESOLVED', level: 'ESTIMATED', message: '편입생은 전적대학 인정학점이 있어 졸업에 필요한 총 학점을 단정할 수 없어요.' }], schedule4: null },
    }));
    expect(screen.getByText('(추정)')).toBeInTheDocument();
    expect(screen.getByText(/편입생은 전적대학 인정학점이 있어/)).toBeInTheDocument();
  });

  it('자료 없음: 0/0·NaN 대신 "진단할 수 없어요" 안내와 자료 없음 배지, 이수 현황 카드는 숨긴다', async () => {
    getGraduationStatus.mockResolvedValue(status({
      totalRequiredCredits: 0, totalEarnedCredits: 0, categories: [],
      regulation: { confidence: 'NO_DATA', confidenceLabel: '자료없음', totalDefinitive: true, flags: [{ code: 'NO_CURRICULUM_ROWS', level: 'NO_DATA', message: '이 학과·학번의 졸업요건 자료가 시스템에 없어요.' }], schedule4: null },
    }));
    render(<GraduationStatus user={{ name: '홍길동', role: 'student' }} onGoHome={() => {}} onOpenCourses={() => {}} onLogout={() => {}} onOpenSettings={() => {}} onOpenOnboarding={() => {}} onOpenProfile={() => {}} />);
    expect(await screen.findByText(/졸업요건 자료가 아직 없어서 진단할 수 없어요/)).toBeInTheDocument();
    expect(screen.getByText('자료없음')).toHaveClass('grad-trust-badge', 'none');
    expect(screen.getByText('이 학과·학번의 졸업요건 자료가 시스템에 없어요.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN/);
    expect(screen.queryByText('전체 이수학점')).not.toBeInTheDocument();
    expect(screen.queryByText(/과목 관리로 이동/)).not.toBeInTheDocument();
  });

  it('교직기본이수(optional): 카드에 "교직과정 이수자만 해당" 안내를 붙이고 부족 요건 목록에는 넣지 않는다', async () => {
    await renderWith(status({
      categories: categories.map((c) => ({ ...c, earnedCredits: c.requiredCredits })),
      totalEarnedCredits: 140,
      certifications: [
        { category: '졸업논문', description: '졸업논문 합격', requiredCourses: ['졸업(시험·작품)논문'], satisfied: true },
        { category: '교직기본이수', description: '교직 기본이수 7과목', requiredCourses: ['국어교육론'], satisfied: false, optional: true },
      ],
    }));
    expect(screen.getByText(/교직과정 이수자만 해당해요/)).toBeInTheDocument();
    expect(document.querySelector('.grad-shortfall-list')).toBeNull();
    expect(document.querySelector('.grad-shortfall-box.ok')).not.toBeNull();
  });

  it('편입생의 대학 공통 졸업인증제: "학사편입이면 면제" 안내를 붙이되 부족 요건에는 그대로 남긴다(편입 종류를 모름)', async () => {
    await renderWith(status({
      certifications: [
        { category: '졸업인증제', description: '기본영역 1과목', requiredCourses: ['캡스톤디자인'], satisfied: false, conditionalExemption: 'BACHELOR_TRANSFER' },
      ],
    }));
    expect(screen.getByText(/산업체편입이라면 이 졸업인증제는 면제예요/)).toBeInTheDocument();
    expect(document.querySelector('.grad-shortfall-list').textContent).toContain('졸업인증제');
  });

  it('예전 응답(regulation 필드 없음)도 그대로 동작: 배지·사유 없음', async () => {
    const legacy = status();
    delete legacy.regulation;
    await renderWith(legacy);
    expect(document.querySelector('.grad-trust-badge')).toBeNull();
    expect(screen.getByText(/\/ 140학점/)).toBeInTheDocument();
  });
});
