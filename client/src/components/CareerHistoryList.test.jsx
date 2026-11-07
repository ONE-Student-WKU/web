import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCareerHistory: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import CareerHistoryList from './CareerHistoryList.jsx';

/**
 * client/src/components/CareerHistoryList.test.jsx
 * 진로를 확정한 지난 진단을 다시 여는 목록(DECISIONS D-93). 지금 보이는 진단은 빼고, 없으면 칸 자체를 그리지 않는다.
 */

const row = (id, career) => ({
  id,
  confirmedCareer: career,
  confirmedAt: '2026-10-05T12:30:00.000Z',
  roadmap: [{ grade: 3, semester: 1, courseName: `${career} 과목`, reason: '이유', courseCode: null }],
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('지난 진단 결과', () => {
  it('지금 보는 진단은 빼고 보여 주고, 줄을 누르면 그때 로드맵이 펼쳐지고 다시 누르면 접힌다', async () => {
    api.getCareerHistory.mockResolvedValue([row(3, '백엔드 개발자'), row(2, '데이터 엔지니어')]);
    render(<CareerHistoryList excludeId={3} />);
    const open = await screen.findByRole('button', { name: /데이터 엔지니어/ });
    expect(screen.getByRole('heading', { name: '지난 진단 결과' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /백엔드 개발자/ })).toBeNull();
    expect(screen.queryByText('데이터 엔지니어 과목')).toBeNull();

    await userEvent.click(open);
    expect(screen.getByText('데이터 엔지니어 과목')).toBeInTheDocument();
    expect(open).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(open);
    expect(screen.queryByText('데이터 엔지니어 과목')).toBeNull();
  });

  it('skipLatest면 가장 최근 확정은 뺀다(계정 정보 화면은 그 진로를 바로 위에 보여 준다)', async () => {
    api.getCareerHistory.mockResolvedValue([row(3, '백엔드 개발자'), row(2, '데이터 엔지니어')]);
    render(<CareerHistoryList skipLatest />);
    expect(await screen.findByRole('button', { name: /데이터 엔지니어/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /백엔드 개발자/ })).toBeNull();
  });

  it('지난 진단이 없거나 지금 진단뿐이거나 불러오기에 실패하면 칸을 그리지 않는다', async () => {
    for (const [mock, props] of [
      [() => api.getCareerHistory.mockResolvedValue([]), {}],
      [() => api.getCareerHistory.mockResolvedValue([row(3, '백엔드 개발자')]), { excludeId: 3 }],
      [() => api.getCareerHistory.mockRejectedValue(new Error('실패')), {}],
    ]) {
      mock();
      const { container, unmount } = render(<CareerHistoryList {...props} />);
      await waitFor(() => expect(api.getCareerHistory).toHaveBeenCalled());
      await Promise.resolve();
      expect(container.querySelector('.career-history')).toBeNull();
      unmount();
    }
  });
});
