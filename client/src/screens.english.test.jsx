import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getLatestCareerSession: vi.fn(),
  createCareerSession: vi.fn(),
  submitCareerFixedAnswers: vi.fn(),
  sendCareerMessage: vi.fn(),
  generateCareerCandidates: vi.fn(),
  confirmCareer: vi.fn(),
  getLatestConfirmedRoadmap: vi.fn(),
  getMyInquiries: vi.fn(),
  createInquiry: vi.fn(),
  getDepartments: vi.fn(),
  getTracks: vi.fn(),
  updateProfile: vi.fn(),
}));

import * as api from './api/chatApi.js';
import { LanguageProvider } from './i18n/I18nContext.jsx';
import CareerExploration from './pages/CareerExploration.jsx';
import Inquiry from './pages/Inquiry.jsx';
import Profile from './pages/Profile.jsx';
import Onboarding from './pages/Onboarding.jsx';
import DepartmentPicker from './components/DepartmentPicker.jsx';
import CareerRoadmapList, { groupRoadmapBySemester } from './components/CareerRoadmapList.jsx';

/**
 * client/src/screens.english.test.jsx
 * 영어 화면(진로 탐색, 문의, 계정 정보 수정, 온보딩, 학과 선택, 진로 로드맵)이 영어로 나오는지, 그리고 서버로 보내는 값
 * (진로 고정 질문·답변 원문, 화면 언어)이 화면 언어와 무관하게 올바른지 확인한다.
 */

const renderEn = (ui) => {
  localStorage.setItem('language', 'en');
  return render(<LanguageProvider>{ui}</LanguageProvider>);
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  api.getLatestCareerSession.mockResolvedValue(null);
  api.getLatestConfirmedRoadmap.mockResolvedValue(null);
  api.getMyInquiries.mockResolvedValue([]);
  api.getDepartments.mockResolvedValue([]);
  api.getTracks.mockResolvedValue([]);
});

describe('진로 탐색', () => {
  it('고정 질문이 영어로 나오고, 마지막까지 답하면 서버에는 한국어 원문 질문·답변과 language: en을 보낸다', async () => {
    api.createCareerSession.mockResolvedValue({ id: 9 });
    api.submitCareerFixedAnswers.mockResolvedValue({ messages: [] });
    renderEn(<CareerExploration user={{ name: 'x' }} onGoHome={() => {}} />);

    expect(await screen.findByRole('heading', { name: 'Honestly, which task would you least want to do all day long?' })).toBeInTheDocument();
    expect(screen.getByText('Select up to 2.')).toBeInTheDocument();

    // 1~4번 질문(복수 선택): 첫 선택지를 고르고 다음으로.
    const firstOptions = ['Dealing with people nonstop', 'Building, fixing or practicing something hands-on', 'Finding and organizing materials', 'Classes about understanding concepts and theory'];
    for (const option of firstOptions) {
      await userEvent.click(await screen.findByRole('button', { name: option }));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    expect(await screen.findByRole('heading', { name: 'Outside of class, what have you done related to your major?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Just class assignments or practice' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start chatting' }));

    await waitFor(() => expect(api.submitCareerFixedAnswers).toHaveBeenCalled());
    const [sid, payload, language] = api.submitCareerFixedAnswers.mock.calls[0];
    expect(sid).toBe(9);
    expect(language).toBe('en');
    expect(payload[0]).toEqual({ question: '솔직히 하루 종일 하라면 가장 하기 싫은 일은?', answer: '계속 사람을 상대하는 일' });
    expect(payload[4]).toEqual({ question: '전공과 관련해 수업 밖에서 해본 활동은?', answer: '수업 과제나 실습 정도예요' });
  });

  it('복수 선택은 최대 2개까지이고 3개째를 고르면 가장 먼저 고른 것이 빠진다', async () => {
    renderEn(<CareerExploration user={{ name: 'x' }} onGoHome={() => {}} />);
    const names = ['Dealing with people nonstop', 'Concentrating alone for long stretches', 'Handling new situations every time'];
    for (const name of names) await userEvent.click(await screen.findByRole('button', { name }));

    const isSelected = (name) => screen.getByRole('button', { name }).className.includes('selected');
    expect(isSelected(names[0])).toBe(false);
    expect(isSelected(names[1])).toBe(true);
    expect(isSelected(names[2])).toBe(true);
  });

  it('"딱히 없어요"는 다른 선택지와 같이 고를 수 없다(고르면 나머지 해제, 다른 걸 고르면 해제)', async () => {
    renderEn(<CareerExploration user={{ name: 'x' }} onGoHome={() => {}} />);
    const isSelected = (name) => screen.getByRole('button', { name }).className.includes('selected');

    await userEvent.click(await screen.findByRole('button', { name: 'Dealing with people nonstop' }));
    await userEvent.click(screen.getByRole('button', { name: 'Nothing in particular' }));
    expect(isSelected('Nothing in particular')).toBe(true);
    expect(isSelected('Dealing with people nonstop')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Repeating a set procedure' }));
    expect(isSelected('Repeating a set procedure')).toBe(true);
    expect(isSelected('Nothing in particular')).toBe(false);
  });

  it('"딱히 없어요"를 고르면 건너뜀이 아니라 그 선택지가 답으로 저장된다', async () => {
    api.createCareerSession.mockResolvedValue({ id: 5 });
    api.submitCareerFixedAnswers.mockResolvedValue({ messages: [] });
    renderEn(<CareerExploration user={{ name: 'x' }} onGoHome={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Nothing in particular' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    for (let i = 0; i < 4; i++) await userEvent.click(await screen.findByRole('button', { name: "I'm not sure, next" }));
    await waitFor(() => expect(api.submitCareerFixedAnswers).toHaveBeenCalled());
    const payload = api.submitCareerFixedAnswers.mock.calls[0][1];
    expect(payload[0].answer).toBe('딱히 없어요');
    expect(payload[1].answer).toBe('(잘 모르겠어요, 건너뜀)');
  });

  it('"잘 모르겠어요" 건너뛰기는 화면 언어와 무관하게 같은 저장값으로 간다', async () => {
    api.createCareerSession.mockResolvedValue({ id: 3 });
    api.submitCareerFixedAnswers.mockResolvedValue({ messages: [] });
    renderEn(<CareerExploration user={{ name: 'x' }} onGoHome={() => {}} />);
    for (let i = 0; i < 5; i++) await userEvent.click(await screen.findByRole('button', { name: "I'm not sure, next" }));
    await waitFor(() => expect(api.submitCareerFixedAnswers).toHaveBeenCalled());
    expect(api.submitCareerFixedAnswers.mock.calls[0][1].every((p) => p.answer === '(잘 모르겠어요, 건너뜀)')).toBe(true);
  });

  it('온보딩 전이면 영어 안내가 나온다', async () => {
    api.getLatestCareerSession.mockRejectedValue(Object.assign(new Error('x'), { code: 'ONBOARDING_REQUIRED' }));
    renderEn(<CareerExploration user={{ name: 'x' }} onGoHome={() => {}} />);
    expect(await screen.findByText('Please register your department and admission year first to explore careers.')).toBeInTheDocument();
  });

  it('불러오기에 실패하면 영어 오류가 나온다', async () => {
    api.getLatestCareerSession.mockRejectedValue(new Error('boom'));
    renderEn(<CareerExploration user={{ name: 'x' }} onGoHome={() => {}} />);
    expect(await screen.findByText("Couldn't load your career exploration. Please refresh and try again.")).toBeInTheDocument();
  });

  it('대화 화면: 보낸 메시지에 language: en이 따라가고, 추천받기 모달이 영어다', async () => {
    const fixed = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: `m${i}` }));
    api.getLatestCareerSession.mockResolvedValue({
      id: 4,
      messages: [...fixed, { role: 'assistant', content: 'What got you interested?' }],
      candidates: [],
      roadmap: [],
      confirmedCareer: null,
    });
    api.sendCareerMessage.mockResolvedValue({ messages: [] });
    renderEn(<CareerExploration user={{ name: 'x' }} onGoHome={() => {}} />);

    expect(await screen.findByRole('button', { name: 'Get recommendations' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'I like games{Enter}');
    await waitFor(() => expect(api.sendCareerMessage).toHaveBeenCalledWith(4, 'I like games', 'en'));

    await userEvent.click(screen.getByRole('button', { name: 'Get recommendations' }));
    expect(screen.getByText('Want career recommendations?')).toBeInTheDocument();
  });
});

describe('문의하기 / 계정 정보 수정', () => {
  it('문의하기가 영어로 나온다', async () => {
    renderEn(<Inquiry onGoHome={() => {}} />);
    expect(screen.getByText('Contact us')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My inquiries' })).toBeInTheDocument();
    expect(screen.getByText(/Let us know if you run into a bug/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'My inquiries' }));
    expect(await screen.findByText("You haven't sent any inquiries yet.")).toBeInTheDocument();
  });

  it('내 문의 목록: 상태 배지는 번역되고, 사용자가 쓴 제목·내용은 그대로 보인다', async () => {
    api.getMyInquiries.mockResolvedValue([{ id: 1, title: '버튼이 안 눌려요', content: '졸업요건 화면에서요', status: 'resolved', createdAt: '2026-10-01T00:00:00Z' }]);
    renderEn(<Inquiry onGoHome={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'My inquiries' }));
    expect(await screen.findByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('버튼이 안 눌려요')).toBeInTheDocument();
  });

  it('계정 정보 수정이 영어로 나오고, 이름 저장 오류도 영어다', async () => {
    api.updateProfile.mockRejectedValue(Object.assign(new Error('x'), { code: 'DUPLICATE_NAME' }));
    renderEn(<Profile user={{ name: 'abc', hasGoogleAccount: true }} onGoHome={() => {}} />);
    expect(screen.getByText('Edit account info')).toBeInTheDocument();
    expect(screen.getByText('Delete account')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('That nickname is already taken.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in again to confirm' })).toBeInTheDocument();
  });

  it('확정한 진로가 있으면 로드맵 보기 버튼과 학기 그룹 이름이 영어다', async () => {
    api.getLatestConfirmedRoadmap.mockResolvedValue({ confirmedCareer: 'Backend developer', roadmap: [{ grade: 3, semester: 1, courseName: '운영체제', reason: 'Core of systems' }] });
    renderEn(<Profile user={{ name: 'abc', hasGoogleAccount: true }} onGoHome={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'View roadmap' }));
    expect(screen.getByText('Year 3, Semester 1')).toBeInTheDocument();
    expect(screen.getByText('운영체제')).toBeInTheDocument();
  });
});

describe('온보딩 / 학과 선택', () => {
  const DEPT = {
    id: 4,
    name: '경영학부',
    minAdmissionYear: 2020,
    maxAdmissionYear: 2022,
    coreMinAdmissionYear: 2020,
    coreMaxAdmissionYear: 2022,
    successors: [{ name: '경영계열', effectiveYear: 2023, confirmed: false }],
    college: '경상대학',
    former: true,
    collegeOrder: 12,
  };
  const USER = { id: 1, onboardingCompleted: true, departmentId: 4, trackId: null, enrollmentType: 'GENERAL', admissionYear: 2021, leaveSemesters: 0 };

  it('학적정보 수정 요약이 영어이고, 학과 이름은 그대로 한국어다', async () => {
    api.getDepartments.mockResolvedValue([DEPT]);
    renderEn(<Onboarding user={USER} onDone={() => {}} onSkip={() => {}} />);
    expect(await screen.findByText('Please check your information')).toBeInTheDocument();
    expect(screen.getByText('경영학부')).toBeInTheDocument();
    expect(screen.getByText('2021 cohort')).toBeInTheDocument();
    expect(screen.getByText('Regular student')).toBeInTheDocument();
    expect(screen.getByText('Semesters on leave')).toBeInTheDocument();
  });

  it('학번 단계가 영어로 그려지고 이후 학과 안내도 영어다', async () => {
    api.getDepartments.mockResolvedValue([DEPT]);
    renderEn(<Onboarding user={USER} onDone={() => {}} onSkip={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Admission year.*2021 cohort/ }));
    expect(await screen.findByRole('heading', { name: 'What is your admission year?' })).toBeInTheDocument();
    expect(screen.getByText('Successor department (estimated): 경영계열')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '2021 cohort' })).toBeInTheDocument();
  });

  it('학과 선택: 검색 안내, 학번 범위가 영어다', async () => {
    const other = { ...DEPT, id: 5, name: '원불교학과', college: '교학대학', former: false, successors: [], maxAdmissionYear: null, coreMaxAdmissionYear: null };
    renderEn(<DepartmentPicker departments={[DEPT, other]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByRole('searchbox', { name: 'Search departments' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /경상대학/ }));
    expect(screen.getByText(/2020–2022 cohorts/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(await screen.findByText(/No department matches "zzz"/)).toBeInTheDocument();
  });
});

describe('진로 로드맵 목록', () => {
  it('학기 그룹 이름을 번역하되, 번역 함수를 안 넘기면 기존 한국어 그대로다', () => {
    renderEn(<CareerRoadmapList roadmap={[]} />);
    expect(screen.getByText("We couldn't find any remaining courses to recommend.")).toBeInTheDocument();
    expect(groupRoadmapBySemester([{ grade: 2, semester: 1, courseName: 'a' }])[0].label).toBe('2학년 1학기');
  });
});
