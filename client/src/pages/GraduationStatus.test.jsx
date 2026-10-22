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

  it('확정: 배지·사유·추정 표시가 모두 없다(예외만 표시, 2026-10-17)', async () => {
    await renderWith(status());
    expect(document.querySelector('.grad-trust-badge')).toBeNull();
    expect(screen.queryByText('확정')).not.toBeInTheDocument();
    expect(screen.queryByText('(추정)')).not.toBeInTheDocument();
    expect(document.querySelector('.grad-trust-reason')).toBeNull();
    expect(screen.getByText(/\/ 140학점/)).toBeInTheDocument();
  });

  it('2025학번 이하(basisBookletYear=2026)여도 기준 책자 설명 문구는 보이지 않는다(학생에게는 필요 없는 설명이라 뺐다)', async () => {
    await renderWith(status({ regulation: { ...status().regulation, basisBookletYear: 2026 } }));
    expect(document.querySelector('.grad-trust-badge')).toBeNull();
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

describe("자기계발심층상담 안내(충족으로 보여주고 확인 경로만, 2026-10-22 결정)", () => {
  beforeEach(() => resetGraduationCache && resetGraduationCache());
  it("학번 기준 횟수와 체크 표시, 짧은 확인 경로를 보여주고 부족 요건에는 넣지 않는다", async () => {
    await renderWith(status({
      categories: categories.map((c) => ({ ...c, earnedCredits: c.requiredCredits })),
      totalEarnedCredits: 140,
      counseling: { required: 8, cohort: "FROM_2020", replacement: null, judged: false },
    }));
    const title = screen.getByText("자기계발심층상담");
    expect(title.closest(".grad-cert-row").querySelector(".grad-cert-check.satisfied")).not.toBeNull();
    expect(screen.getByText("2020학번부터 기준 8학기(회) 이상 상담해야 해요.")).toBeInTheDocument();
    expect(screen.getByText(/대부분 지도교수님이 학기마다 상담을 진행해 채워주세요/)).toBeInTheDocument();
    expect(screen.queryByText(/학교에 확인 중이에요/)).toBeNull();
    expect(screen.queryByText(/Hug/)).toBeNull();
    expect(document.querySelector(".grad-shortfall-box.ok")).not.toBeNull();
  });
  it("광역 계열전공은 Hug 심층진로상담 대체를 알린다", async () => {
    await renderWith(status({ counseling: { required: 8, cohort: "FROM_2020", replacement: "HUG", judged: false } }));
    expect(screen.getByText(/Hug 심층진로상담으로 대체해요/)).toBeInTheDocument();
  });
});

describe('교양필수 영역과 학과 지정 전공 과목(#378 결정 1-1 A·5-1 A)', () => {
  beforeEach(() => resetGraduationCache && resetGraduationCache());
  it('학점을 채워도 종교와원불교를 안 들었으면 교양필수 미충족과 빠진 영역을 보여 주고 부족 요건에 넣는다', async () => {
    const areas = [
      { area: '건학이념', courses: ['종교와원불교'], completed: [], missing: ['종교와원불교'], satisfied: false },
      { area: '대학생활', courses: ['대학생활과자기혁신'], completed: ['대학생활과자기혁신'], missing: [], satisfied: true },
    ];
    await renderWith(status({ categories: categories.map((c) => (c.category === '교양필수' ? { ...c, areas } : c)) }));
    expect(screen.getByText('교양필수 미충족')).toBeInTheDocument();
    expect(screen.getByText('아직 듣지 않은 교양필수 영역: 건학이념 영역(종교와원불교)')).toBeInTheDocument();
    const summary = [...document.querySelectorAll('.grad-shortfall-list li')].map((li) => li.textContent);
    expect(summary).toContain('건학이념 영역(종교와원불교)');
  });
  it('지정 전공 과목은 목록과 학과 확인 안내만 보여 주고 부족 요건에는 넣지 않는다', async () => {
    await renderWith(status({
      categories: categories.map((c) => ({ ...c, earnedCredits: c.requiredCredits })),
      totalEarnedCredits: 140,
      designatedMajorCourses: { courseListYear: 2026, courses: [
        { courseName: '기본간호학', category: '전공필수', grade: 2, semester: '1', credits: 3, taken: true },
        { courseName: '인체구조와기능', category: '전공기초', grade: 1, semester: '1', credits: 3, taken: false },
      ] },
    }));
    expect(screen.getByText('학과 지정 전공 과목')).toBeInTheDocument();
    expect(screen.getByText(/2026학년도 편성표의 전공기초·전공필수 목록/)).toBeInTheDocument();
    expect(screen.getByText('전공기초·전공필수 2과목 · 들은 과목 1과목 (목록 보기)')).toBeInTheDocument();
    expect(screen.getByText(/기본간호학/)).toBeInTheDocument();
    expect(document.querySelector('.grad-shortfall-box.ok')).not.toBeNull();
  });
});

describe('광역 계열전공 이수구분별 학점과 이수유형(#378 E-3)', () => {
  beforeEach(() => resetGraduationCache && resetGraduationCache());
  it('구분별 학점, 구분을 모르는 학점 안내, 이수유형을 보여 주고 모자란 구분을 부족 요건에 넣는다', async () => {
    await renderWith(status({
      majorTrackType: 'INTENSIVE',
      majorAreaCredits: {
        areas: [
          { area: '기초', required: 12, earned: 12, satisfied: true },
          { area: '심화', required: 15, earned: 9, satisfied: false },
          { area: '응용', required: 9, earned: 9, satisfied: true },
        ],
        unknownCredits: 3,
        satisfied: false,
      },
    }));
    expect(screen.getByText('심화전공 9/15학점')).toBeInTheDocument();
    expect(screen.getByText(/구분을 알 수 없는 전공 3학점/)).toBeInTheDocument();
    expect(screen.getByText('전공 이수유형: 전공심화형')).toBeInTheDocument();
    const summary = [...document.querySelectorAll('.grad-shortfall-list li')].map((li) => li.textContent);
    expect(summary).toContain('심화전공 6학점');
  });
});
