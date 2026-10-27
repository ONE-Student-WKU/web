import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getGraduationStatus: vi.fn(),
  getCourseSummary: vi.fn(),
  getSemesters: vi.fn(),
  getRetakeEligibleCourses: vi.fn(),
  getMyCourses: vi.fn(),
  getTimetable: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import CourseManagement, { resetCourseMgmtCache } from './CourseManagement.jsx';
import { LanguageProvider } from '../i18n/I18nContext.jsx';

/**
 * client/src/pages/CourseManagement.countedMajor.test.jsx
 * 다른 학과에서 연 전공 과목은 서버가 자동으로 일반선택으로 센다(D-88). 전과·다전공이 아닌 학생도 "전공으로 셈"으로 바꾸고 되돌릴 수 있다.
 */

const course = (over = {}) => ({ id: 1, name: '현대소설론', credits: 3, category: '전공선택', year: 2024, semester: 1, letterGrade: 'A0', ...over });

const renderPage = () =>
  render(
    <LanguageProvider>
      <CourseManagement user={{ name: '학생', admissionYear: 2024, enrollmentType: 'GENERAL' }} onGoHome={() => {}} />
    </LanguageProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  resetCourseMgmtCache();
  window.history.replaceState(null, '', '/');
  Element.prototype.scrollIntoView = vi.fn();
  api.getGraduationStatus.mockResolvedValue(null);
  api.getCourseSummary.mockResolvedValue({ total: { earnedCredits: 3, gpa: 4 }, bySemester: [] });
  api.getSemesters.mockResolvedValue([]);
  api.getRetakeEligibleCourses.mockResolvedValue([]);
  api.getTimetable.mockResolvedValue([]);
});

describe('과목 관리 — 다른 학과 전공 과목', () => {
  it('자동으로 일반선택이 된 과목에 "자동: 일반선택 / 전공으로 셈" 칸을 보인다', async () => {
    api.getMyCourses.mockResolvedValue([course({ countedMajor: 'GENERAL', countedMajorAuto: true })]);
    renderPage();
    const select = await screen.findByRole('combobox', { name: '어느 전공으로 셀지' });
    expect(select).toHaveValue('AUTO');
    expect(screen.getByRole('option', { name: '자동: 일반선택' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '전공으로 셈' })).toBeInTheDocument();
  });

  it('"전공으로 셈"으로 고친 과목도 칸이 남고, 자동 칸에는 고친 값이 아니라 자동 값을 보인다', async () => {
    api.getMyCourses.mockResolvedValue([course({ countedMajor: 'PRIMARY', countedMajorAuto: false, countedMajorAutoValue: 'GENERAL' })]);
    renderPage();
    const select = await screen.findByRole('combobox', { name: '어느 전공으로 셀지' });
    expect(select).toHaveValue('PRIMARY');
    expect(screen.getByRole('option', { name: '자동: 일반선택' })).toBeInTheDocument();
  });

  it('자동으로 그대로 센 과목에는 칸을 보이지 않는다', async () => {
    api.getMyCourses.mockResolvedValue([course({ countedMajor: 'PRIMARY', countedMajorAuto: true })]);
    renderPage();
    await screen.findByText('현대소설론');
    expect(screen.queryByRole('combobox', { name: '어느 전공으로 셀지' })).not.toBeInTheDocument();
  });
});
