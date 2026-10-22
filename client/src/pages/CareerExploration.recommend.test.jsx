import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getLatestCareerSession: vi.fn(),
  generateCareerCandidates: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import CareerExploration from './CareerExploration.jsx';

/**
 * client/src/pages/CareerExploration.recommend.test.jsx
 * 진로 추천 받기를 찾기 쉽게(2026-10-22): 머리글 버튼 대신 입력창 바로 위 추천 칸 + 질문 → 대화 → 진로 추천 → 과목 로드맵 단계 표시.
 * 자유 대화 3번 전에는 회색으로 몇 번 남았는지, 3번부터는 진하게 "진로 추천 받기", 대화를 다 쓰면 입력창 대신 큰 버튼.
 */

const ANSWERS = ['계속 사람을 상대하는 일', '(잘 모르겠어요, 건너뜀)', '(잘 모르겠어요, 건너뜀)', '(잘 모르겠어요, 건너뜀)', '(잘 모르겠어요, 건너뜀)'];
const fixedBlock = ANSWERS.flatMap((answer, i) => [{ role: 'assistant', content: `질문${i}` }, { role: 'user', content: answer }]);
const freeTurns = (n) => Array.from({ length: n }, (_, i) => [{ role: 'assistant', content: `AI ${i}` }, { role: 'user', content: `학생 ${i}` }]).flat();
const session = (messages) => ({ id: 7, messages: [...messages, { role: 'assistant', content: '다음 질문' }], candidates: [], roadmap: [], confirmedCareer: null });

beforeAll(() => {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
  Element.prototype.scrollTo = Element.prototype.scrollTo || (() => {});
});

beforeEach(() => {
  vi.clearAllMocks();
});

const renderPage = () => render(<CareerExploration user={{ id: 1, name: '학생', role: 'student' }} onGoHome={() => {}} />);
const header = () => document.querySelector('.screen-header');

describe('진로 추천 받기 찾기 쉽게', () => {
  it('자유 대화 3번 전: 회색 칸에 남은 횟수, "지금 받기"로도 누를 수 있고, 머리글에는 추천 버튼이 없다', async () => {
    api.getLatestCareerSession.mockResolvedValue(session([...fixedBlock, ...freeTurns(1)]));
    renderPage();
    expect(await screen.findByText('진로 추천까지 대화 2번 남았어요')).toBeInTheDocument();
    expect(document.querySelector('.career-recommend-card')).not.toHaveClass('ready');
    expect(within(header()).queryByRole('button', { name: /추천/ })).toBeNull();
    expect(screen.getByRole('list', { name: '진로 탐색 단계' }).querySelector('[aria-current="step"]')).toHaveTextContent('대화');

    await userEvent.click(screen.getByRole('button', { name: '지금 받기' }));
    expect(screen.getByText('진로를 추천해드릴까요?')).toBeInTheDocument();
  });

  it('자유 대화 3번부터: 칸이 진해지고 "진로 추천 받기", 입력창 안내는 "더 이야기해도 돼요"', async () => {
    api.getLatestCareerSession.mockResolvedValue(session([...fixedBlock, ...freeTurns(3)]));
    renderPage();
    expect(await screen.findByText('이제 진로를 추천받을 수 있어요')).toBeInTheDocument();
    expect(document.querySelector('.career-recommend-card')).toHaveClass('ready');
    expect(screen.getByRole('button', { name: '진로 추천 받기' })).toBeEnabled();
    expect(screen.getByPlaceholderText('더 이야기해도 돼요')).toBeInTheDocument();
  });

  it('남은 대화가 3번 이하면 남은 횟수를 같이 알린다', async () => {
    api.getLatestCareerSession.mockResolvedValue(session([...fixedBlock, ...freeTurns(13)]));
    renderPage();
    expect(await screen.findByText(/남은 대화 2번/)).toBeInTheDocument();
  });

  it('대화 횟수를 다 쓰면 입력창 대신 큰 "진로 추천 받기" 버튼만 남는다', async () => {
    api.getLatestCareerSession.mockResolvedValue(session([...fixedBlock, ...freeTurns(15)]));
    renderPage();
    expect(await screen.findByText('충분히 이야기 나눴어요. 이제 결과를 확인해 보세요.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '진로 추천 받기' }));
    expect(screen.getByText('진로를 추천해드릴까요?')).toBeInTheDocument();
  });

  it('대화 위에 처음 고른 답이 칩으로 보이고, "수정"으로 답변 수정 화면에 간다', async () => {
    api.getLatestCareerSession.mockResolvedValue(session([...fixedBlock, ...freeTurns(1)]));
    renderPage();
    expect(await screen.findByText('계속 사람을 상대하는 일')).toHaveClass('career-chip');
    await userEvent.click(screen.getByRole('button', { name: '처음 답변 수정' }));
    expect(screen.getByText('답변 수정', { selector: '.screen-title' })).toBeInTheDocument();
    // 머리글 뒤로가기는 홈이 아니라 대화로 돌아간다.
    await userEvent.click(screen.getByRole('button', { name: '대화로 돌아가기' }));
    expect(await screen.findByText('진로 추천까지 대화 2번 남았어요')).toBeInTheDocument();
  });
});
