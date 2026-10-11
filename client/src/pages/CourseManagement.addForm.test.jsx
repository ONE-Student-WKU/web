import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getGraduationStatus: vi.fn(),
  getCourseSummary: vi.fn(),
  getSemesters: vi.fn(),
  getRetakeEligibleCourses: vi.fn(),
  getMyCourses: vi.fn(),
  getTimetable: vi.fn(),
  searchCatalog: vi.fn(),
  addMyCourse: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import CourseManagement, { resetCourseMgmtCache } from './CourseManagement.jsx';
import { LanguageProvider } from '../i18n/I18nContext.jsx';

/**
 * client/src/pages/CourseManagement.addForm.test.jsx
 * 과목 추가 폼은 별도 "과목 추가" 버튼 없이 처음부터 보이고, 카탈로그 검색은 검색 전용 화면에서 한다.
 */

const renderPage = () =>
  render(
    <LanguageProvider>
      <CourseManagement user={{ name: '학생', admissionYear: new Date().getFullYear() }} onGoHome={() => {}} />
    </LanguageProvider>
  );

const catalogCourse = (over = {}) => ({
  courseId: 11,
  name: '알고리즘',
  section: '01',
  professor: '김교수',
  credits: 3,
  category: '전공필수',
  schedule: [{ day: '월', period: 1 }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  resetCourseMgmtCache();
  window.history.replaceState(null, '', '/');
  Element.prototype.scrollIntoView = vi.fn();
  api.getGraduationStatus.mockResolvedValue(null);
  api.getCourseSummary.mockResolvedValue({ total: { earnedCredits: 0, gpa: 0 }, bySemester: [] });
  api.getSemesters.mockResolvedValue([]);
  api.getRetakeEligibleCourses.mockResolvedValue([]);
  api.getMyCourses.mockResolvedValue([]);
  api.getTimetable.mockResolvedValue([]);
  api.searchCatalog.mockResolvedValue([catalogCourse()]);
  api.addMyCourse.mockResolvedValue({});
});

const entry = () => screen.getByRole('button', { name: '과목 검색' });

describe('과목 관리 — 과목 추가 폼', () => {
  it('"과목 추가" 버튼을 누르지 않아도 카탈로그 검색·직접입력·가져오기 선택이 처음부터 보인다', async () => {
    renderPage();
    await screen.findByText('아직 등록된 과목이 없어요.');
    expect(screen.queryByRole('button', { name: /^과목 추가$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '카탈로그 검색' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '직접입력' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '한 번에 가져오기' })).toBeInTheDocument();
    expect(entry()).toBeInTheDocument();
  });

  it('직접입력 탭도 추가 버튼 없이 바로 입력할 수 있다', async () => {
    renderPage();
    await screen.findByText('아직 등록된 과목이 없어요.');
    await userEvent.click(screen.getByRole('button', { name: '직접입력' }));
    expect(screen.getByRole('button', { name: '추가하기' })).toBeInTheDocument();
  });

  it('검색창을 누르면 검색 전용 화면이 열리고, 검색어를 입력하면 현재 학기로 카탈로그를 검색한다', async () => {
    renderPage();
    await screen.findByText('아직 등록된 과목이 없어요.');
    await userEvent.click(entry());

    expect(screen.getByRole('dialog', { name: '과목 검색' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await userEvent.type(screen.getByRole('searchbox'), '알고');
    await waitFor(() => expect(api.searchCatalog).toHaveBeenCalledWith('알고', expect.any(Number), expect.any(Number)));
    expect(await screen.findByText('알고리즘')).toBeInTheDocument();
  });

  it('시간표가 있는 과목을 고르면 바로 추가하고, 검색 화면은 열어 둔 채 입력만 비운다(연달아 등록)', async () => {
    renderPage();
    await screen.findByText('아직 등록된 과목이 없어요.');
    await userEvent.click(entry());
    await userEvent.type(screen.getByRole('searchbox'), '알고');
    await userEvent.click(await screen.findByRole('button', { name: /알고리즘/ }));

    await waitFor(() => expect(api.addMyCourse).toHaveBeenCalledWith(expect.objectContaining({ courseId: 11 })));
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue(''));
    expect(screen.getByRole('dialog', { name: '과목 검색' })).toBeInTheDocument();
  });

  it('결과가 없으면 검색어와 함께 알려준다', async () => {
    api.searchCatalog.mockResolvedValue([]);
    renderPage();
    await screen.findByText('아직 등록된 과목이 없어요.');
    await userEvent.click(entry());
    await userEvent.type(screen.getByRole('searchbox'), '없는과목');
    expect(await screen.findByText('"없는과목"에 맞는 결과가 없어요.')).toBeInTheDocument();
  });

  it('추가 중 오류(이미 등록됨 등)는 가려진 폼이 아니라 검색 화면 안에 보인다', async () => {
    api.addMyCourse.mockRejectedValue(Object.assign(new Error('dup'), { code: 'COURSE_ALREADY_ADDED' }));
    renderPage();
    await screen.findByText('아직 등록된 과목이 없어요.');
    await userEvent.click(entry());
    await userEvent.type(screen.getByRole('searchbox'), '알고');
    await userEvent.click(await screen.findByRole('button', { name: /알고리즘/ }));
    const dialog = screen.getByRole('dialog', { name: '과목 검색' });
    expect(await within(dialog).findByText(/이미/)).toBeInTheDocument();
  });

  it('시간표가 없는 과목을 고르면 검색 화면을 닫고 폼에서 시간을 묻는다', async () => {
    api.searchCatalog.mockResolvedValue([catalogCourse({ name: '캡스톤', courseId: 12, schedule: [] })]);
    renderPage();
    await screen.findByText('아직 등록된 과목이 없어요.');
    await userEvent.click(entry());
    await userEvent.type(screen.getByRole('searchbox'), '캡스');
    await userEvent.click(await screen.findByRole('button', { name: /캡스톤/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText(/시간표가 등록되어 있지 않아요/)).toBeInTheDocument();
    expect(api.addMyCourse).not.toHaveBeenCalled();
  });

  it('검색 화면의 뒤로가기를 누르면 화면만 닫히고 과목 관리 화면에 남는다', async () => {
    const onGoHome = vi.fn();
    render(
      <LanguageProvider>
        <CourseManagement user={{ name: '학생', admissionYear: new Date().getFullYear() }} onGoHome={onGoHome} />
      </LanguageProvider>
    );
    await screen.findByText('아직 등록된 과목이 없어요.');
    await userEvent.click(entry());
    await userEvent.click(screen.getByRole('button', { name: '검색 닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onGoHome).not.toHaveBeenCalled();
    expect(entry()).toBeInTheDocument();
  });
});
