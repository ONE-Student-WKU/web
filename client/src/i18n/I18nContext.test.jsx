import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider, translate, useI18n } from './I18nContext.jsx';
import ko from './locales/ko.js';
import en from './locales/en.js';
import Settings from '../pages/Settings.jsx';
import BottomTabBar from '../components/BottomTabBar.jsx';
import { summarizeShortfalls, formatShortfallSentence, describeRequirementTrust } from '../utils/graduation.js';
import Login from '../pages/Login.jsx';
import GraduationStatus from '../pages/GraduationStatus.jsx';
import CourseManagement from '../pages/CourseManagement.jsx';
import * as api from '../api/chatApi.js';
import { vi } from 'vitest';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getGraduationStatus: vi.fn(),
  getCourseSummary: vi.fn(),
  getSemesters: vi.fn(),
  getRetakeEligibleCourses: vi.fn(),
  getMyCourses: vi.fn(),
  getTimetable: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
});

describe('translate', () => {
  it('선택한 언어의 문구를 돌려주고 {자리표시자}를 치환한다', () => {
    expect(translate('en', 'home.greeting', { name: 'Alex' })).toBe('Welcome, Alex');
    expect(translate('ko', 'home.greeting', { name: '홍길동' })).toBe('홍길동님, 반갑습니다');
  });

  it('선택한 언어에 키가 없으면 한국어로, 한국어에도 없으면 키 그대로 돌려준다', () => {
    expect(translate('en', 'only.in.korean')).toBe('only.in.korean');
    expect(translate('xx', 'home.menu')).toBe('메뉴');
  });

  it('값이 없는 자리표시자는 그대로 남긴다', () => {
    expect(translate('en', 'home.greeting', {})).toBe('Welcome, {name}');
  });

  it('영어 사전은 한국어 사전에 없는 키를 갖지 않는다(번역 키 오타 방지)', () => {
    // 영어 전용으로 두는 키 — category.*는 서버가 내려주는 한국어 항목명 매핑, home.shortfallSentence는
    // 한국어에선 조사(이/가) 때문에 코드(formatShortfallSentence)가 직접 문장을 만들어 사전에 없다.
    const englishOnly = (k) => k.startsWith('category.') || k === 'home.shortfallSentence';
    const extra = Object.keys(en).filter((k) => !(k in ko) && !englishOnly(k));
    expect(extra).toEqual([]);
  });

  it('영어 사전에 빠진 키가 없다(한국어 키는 모두 영어로도 번역돼 있다)', () => {
    const missing = Object.keys(ko).filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });
});

describe('LanguageProvider', () => {
  function Probe() {
    const { lang, t } = useI18n();
    return <p>{`${lang}:${t('nav.home')}`}</p>;
  }

  it('저장된 값이 없으면 한국어로 시작한다', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByText('ko:홈')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('ko');
  });

  it('저장된 언어를 복원하고, 지원하지 않는 값은 무시한다', () => {
    localStorage.setItem('language', 'en');
    const { unmount } = render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByText('en:Home')).toBeInTheDocument();
    unmount();

    localStorage.setItem('language', 'fr');
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByText('ko:홈')).toBeInTheDocument();
  });
});

describe('설정 화면 언어 선택', () => {
  it('English를 누르면 화면이 영어로 바뀌고 선택이 저장된다', async () => {
    render(
      <LanguageProvider>
        <Settings theme="dark" onSetTheme={() => {}} fontSize="medium" onSetFontSize={() => {}} onGoHome={() => {}} />
      </LanguageProvider>
    );
    expect(screen.getByText('언어')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('language')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('번역 적용', () => {
  it('Provider 없이도(기본값) 한국어로 렌더된다', () => {
    render(<BottomTabBar active="home" />);
    expect(screen.getByRole('button', { name: '졸업요건 진단' })).toBeInTheDocument();
  });

  it('영어일 때 하단 탭바 라벨이 영어다', () => {
    localStorage.setItem('language', 'en');
    render(<LanguageProvider><BottomTabBar active="home" communityBadge /></LanguageProvider>);
    expect(screen.getByRole('button', { name: 'Graduation check' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Community, new notifications' })).toBeInTheDocument();
  });

  it('부족 요건 문구를 영어로 조립한다(번역 키가 없는 항목명은 원문 유지)', () => {
    const t = (key, params) => translate('en', key, params);
    const items = summarizeShortfalls(
      [{ category: '전공필수', earnedCredits: 10, requiredCredits: 13 }],
      [{ category: '어학인증', satisfied: false }],
      t
    );
    expect(items).toEqual(['Major core: 3 credits', '어학인증']);
    expect(formatShortfallSentence(items, 'en')).toBe('Still missing: Major core: 3 credits, 어학인증.');
  });
});

describe('굵은 글씨가 낀 문구(tRich)', () => {
  function RichProbe() {
    const { tRich } = useI18n();
    return <p data-testid="rich">{tRich('courses.help.intro')}</p>;
  }

  it('<b>를 <strong>으로 바꿔 렌더한다', () => {
    localStorage.setItem('language', 'en');
    render(<LanguageProvider><RichProbe /></LanguageProvider>);
    const strong = screen.getByTestId('rich').querySelector('strong');
    expect(strong).toHaveTextContent('one');
    expect(screen.getByTestId('rich')).toHaveTextContent('You only need to prepare one of the two methods below.');
  });
});

describe('로그인 화면 언어 전환', () => {
  it('로그인 전에도 헤더의 English 버튼으로 화면을 영어로 바꾸고, 선택이 저장된다', async () => {
    render(<LanguageProvider><Login onOpenPrivacy={() => {}} onOpenTerms={() => {}} onLoginSuccess={() => {}} /></LanguageProvider>);
    expect(screen.getByRole('heading', { name: '로그인' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in with Google' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(localStorage.getItem('language')).toBe('en');

    await userEvent.click(screen.getByRole('button', { name: '한국어' }));
    expect(screen.getByRole('heading', { name: '로그인' })).toBeInTheDocument();
  });

  it('인증 오류도 선택한 언어로 보여준다', () => {
    localStorage.setItem('language', 'en');
    render(<LanguageProvider><Login error="STATE_MISMATCH" onOpenPrivacy={() => {}} onOpenTerms={() => {}} onLoginSuccess={() => {}} /></LanguageProvider>);
    expect(screen.getByText('Your login request expired. Please try again.')).toBeInTheDocument();
  });
});

describe('졸업요건 신뢰도 표시', () => {
  const status = {
    totalRequiredCredits: 130,
    regulation: { confidence: 'ESTIMATED', confidenceLabel: '추정', flags: [], schedule4: { schedule4Credits: 130, bookCredits: 136 } },
  };

  it('한국어는 서버 라벨/사유 그대로, 영어는 번역해서 보여준다', () => {
    const ko = describeRequirementTrust(status);
    expect(ko.badge.label).toBe('추정');
    expect(ko.reason).toContain('학칙 [별표 4]');

    const en = describeRequirementTrust(status, 'en');
    expect(en.badge.label).toBe('Estimated');
    expect(en.reason).toContain('130 credits');
    expect(en.reason).toContain('136 credits');
  });
});

describe('졸업요건 진단 / 과목 관리 화면', () => {
  const gradStatus = {
    totalEarnedCredits: 20,
    totalRequiredCredits: 130,
    categories: [
      { category: '전공필수', earnedCredits: 10, requiredCredits: 13 },
      { category: '전공선택', earnedCredits: 5, requiredCredits: 30 },
      { category: '교양필수', earnedCredits: 3, requiredCredits: 9 },
      { category: '교양선택', earnedCredits: 2, requiredCredits: 20 },
    ],
    certifications: [{ category: '졸업인증제', satisfied: false, description: '' }],
    regulation: { confidence: 'CONFIRMED', confidenceLabel: '확정', flags: [] },
  };

  beforeEach(() => {
    sessionStorage.clear();
    // jsdom에는 scrollIntoView가 없다(과목 추가 폼이 열릴 때 호출함).
    Element.prototype.scrollIntoView = vi.fn();
    api.getGraduationStatus.mockResolvedValue(gradStatus);
    api.getCourseSummary.mockResolvedValue({ total: { earnedCredits: 20, gpa: 3.5 }, bySemester: [] });
    api.getSemesters.mockResolvedValue([]);
    api.getRetakeEligibleCourses.mockResolvedValue([]);
    api.getMyCourses.mockResolvedValue([]);
    api.getTimetable.mockResolvedValue([]);
  });

  it('졸업요건 진단 화면이 영어로 나온다', async () => {
    localStorage.setItem('language', 'en');
    render(<LanguageProvider><GraduationStatus user={{ name: 'x' }} onGoHome={() => {}} onOpenCourses={() => {}} /></LanguageProvider>);

    expect(await screen.findByText('Total credits earned')).toBeInTheDocument();
    expect(screen.getByText('Major & general education progress')).toBeInTheDocument();
    expect(screen.getByText('Missing requirements summary')).toBeInTheDocument();
    // 인증 카드 제목과 부족 요건 요약 목록, 두 군데에 나온다.
    expect(screen.getAllByText('Graduation certification')).toHaveLength(2);
    expect(screen.getByText('Major core not met')).toBeInTheDocument();
  });

  it('과목 관리 화면이 영어로 나오고, 과목 추가 폼의 안내도 영어다', async () => {
    localStorage.setItem('language', 'en');
    render(<LanguageProvider><CourseManagement user={{ name: 'x', admissionYear: new Date().getFullYear() }} onGoHome={() => {}} /></LanguageProvider>);

    expect(await screen.findByText('Course management')).toBeInTheDocument();
    expect(await screen.findByText('My courses')).toBeInTheDocument();
    expect(screen.getByText('No courses registered yet.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Add course/ }));
    expect(screen.getByRole('button', { name: 'Manual entry' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Manual entry' }));
    expect(screen.getByText('Course name')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Major core' })).toBeInTheDocument();
  });

  it('한국어 기본 화면은 기존 문구 그대로다', async () => {
    render(<LanguageProvider><GraduationStatus user={{ name: 'x' }} onGoHome={() => {}} onOpenCourses={() => {}} /></LanguageProvider>);
    expect(await screen.findByText('전체 이수학점')).toBeInTheDocument();
    expect(screen.getByText('기본전공 미충족')).toBeInTheDocument();
  });
});
