import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getGraduationStatus: vi.fn(),
  acknowledgeChangeNotice: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import Home, { resetHomeCache } from './Home.jsx';

/**
 * client/src/pages/Home.changeNotice.test.jsx
 * 바뀐 자료 알림: 진행률·부족 요건 자리에 대신 나오고, 바뀐 항목은 전부 보이며 출처만 접힌다.
 * [확인]·[진단 보기]를 누르면 서버에 확인을 남기고 원래 카드가 나온다.
 */

const NOTICE = {
  since: '2026-08-01',
  items: [
    { key: 'total', kind: 'total', unit: 'credits', before: 136, after: 130 },
    { key: 'certRequired:졸업인증제', kind: 'certRequired', category: '졸업인증제', unit: 'courses', before: 1, after: 2 },
    { key: 'certRemaining:졸업인증제', kind: 'certRemaining', category: '졸업인증제', unit: 'courses', before: 1, after: 0 },
  ],
  updates: [
    { date: '2026-09-10', note: '교육혁신과 답변 반영' },
    { date: '2026-11-02', note: '2027학년도 책자 반영' },
  ],
};
const STATUS = { totalEarnedCredits: 100, totalRequiredCredits: 130, categories: [], certifications: [], changeNotice: NOTICE };
const USER = { id: 1, name: '학생', department: '경영학부', departmentId: 4, admissionYear: 2023, leaveSemesters: 0, homeLayout: null };

beforeEach(() => {
  vi.clearAllMocks();
  resetHomeCache();
  localStorage.clear();
  api.getGraduationStatus.mockResolvedValue(STATUS);
  api.acknowledgeChangeNotice.mockResolvedValue({ acknowledged: true });
});

describe('Home — 바뀐 자료 알림', () => {
  it('진행률·부족 요건 대신 알림이 나오고, 바뀐 항목은 전부 보인다', async () => {
    render(<Home user={USER} />);
    expect(await screen.findByText('지난 접속(8.01) 이후 졸업요건이 바뀌었어요')).toBeInTheDocument();
    expect(screen.getByText('학교 기준 갱신 2건 · 마지막 2026.11.02')).toBeInTheDocument();
    expect(screen.queryByText('이수학점 진행률')).not.toBeInTheDocument();
    expect(screen.queryByText('부족 요건')).not.toBeInTheDocument();
    expect(screen.getByText('졸업 학점')).toBeInTheDocument();
    expect(screen.getByText('6학점 줄었어요')).toBeInTheDocument();
    expect(screen.getByText('1과목 늘었어요')).toBeInTheDocument();
    expect(screen.getByText('채웠어요')).toBeInTheDocument();
  });

  it('출처는 접혀 있다가 펼치면 날짜별로 보인다', async () => {
    render(<Home user={USER} />);
    const toggle = await screen.findByRole('button', { name: /반영된 갱신 2건 보기/ });
    expect(screen.queryByText(/교육혁신과 답변 반영/)).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByText('2026.09.10 · 교육혁신과 답변 반영')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /반영된 갱신 2건 접기/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('[확인]을 누르면 확인을 남기고 원래 카드가 나온다', async () => {
    render(<Home user={USER} />);
    await userEvent.click(await screen.findByRole('button', { name: '확인' }));
    expect(api.acknowledgeChangeNotice).toHaveBeenCalledTimes(1);
    expect(screen.getByText('이수학점 진행률')).toBeInTheDocument();
    expect(screen.queryByText(/졸업요건이 바뀌었어요/)).not.toBeInTheDocument();
  });

  it('[진단 보기]도 확인으로 치고 진단 화면을 연다', async () => {
    const onOpenGraduation = vi.fn();
    render(<Home user={USER} onOpenGraduation={onOpenGraduation} />);
    await userEvent.click(await screen.findByRole('button', { name: '진단 보기' }));
    expect(api.acknowledgeChangeNotice).toHaveBeenCalledTimes(1);
    expect(onOpenGraduation).toHaveBeenCalledTimes(1);
  });

  it('갱신 기록이 하나뿐이면 제목은 짧게, 없으면 출처 줄과 버튼을 그리지 않는다', async () => {
    api.getGraduationStatus.mockResolvedValue({ ...STATUS, changeNotice: { ...NOTICE, updates: [] } });
    render(<Home user={USER} />);
    expect(await screen.findByText('졸업요건 기준이 바뀌었어요')).toBeInTheDocument();
    expect(screen.queryByText(/학교 기준 갱신/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /반영된 갱신/ })).not.toBeInTheDocument();
  });
});
