import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getLatestCareerSession: vi.fn(),
  updateCareerFixedAnswers: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import CareerExploration from './CareerExploration.jsx';

/**
 * client/src/pages/CareerExploration.answerEdit.test.jsx
 * 진로 탐색 "처음 답변 수정"(이슈 #245, #378 결정 14-1 C·14-3 A): 저장할 때 "이어서 대화"와 "처음부터 다시"를 고르고,
 * 바뀐 내용은 채팅창에 안내 한 줄로 보인다. 원래 답은 대화 맨 앞에 남고, 고친 기록(표식 + JSON)이 지금 답이다.
 */

const MARKER = '[[FIXED_ANSWERS_UPDATE]]';
const ANSWERS = ['계속 사람을 상대하는 일', '(잘 모르겠어요, 건너뜀)', '(잘 모르겠어요, 건너뜀)', '(잘 모르겠어요, 건너뜀)', '(잘 모르겠어요, 건너뜀)'];
const fixedBlock = ANSWERS.flatMap((answer, i) => [{ role: 'assistant', content: `질문${i}` }, { role: 'user', content: answer }]);
const session = (messages) => ({ id: 7, messages, candidates: [], roadmap: [], confirmedCareer: null });
const update = (mode, before, after) => ({
  role: 'user',
  content: MARKER + JSON.stringify({ mode, changes: [{ index: 0, question: '질문0', before, after }], answers: [after, ...ANSWERS.slice(1)] }),
});

beforeAll(() => {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
  Element.prototype.scrollTo = Element.prototype.scrollTo || (() => {});
});

beforeEach(() => {
  vi.clearAllMocks();
});

const renderPage = () => render(<CareerExploration user={{ id: 1, name: '학생', role: 'student' }} onGoHome={() => {}} />);

describe('진로 탐색 처음 답변 수정', () => {
  it('"이어서 대화하기"로 저장하면 CONTINUE로 보내고, 바뀐 내용을 채팅창 안내로 보여 준다', async () => {
    api.getLatestCareerSession.mockResolvedValue(session([...fixedBlock, { role: 'assistant', content: '첫 AI 질문' }]));
    api.updateCareerFixedAnswers.mockResolvedValue({
      messages: [...fixedBlock, { role: 'assistant', content: '첫 AI 질문' }, update('CONTINUE', ANSWERS[0], '혼자 오래 집중해서 하는 일'), { role: 'assistant', content: '바뀐 답 반영 질문' }],
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '처음 답변 수정' }));
    await userEvent.click(screen.getAllByRole('button', { name: '계속 사람을 상대하는 일' })[0]);
    await userEvent.click(screen.getAllByRole('button', { name: '혼자 오래 집중해서 하는 일' })[0]);
    await userEvent.click(screen.getByRole('button', { name: '이어서 대화하기' }));

    expect(api.updateCareerFixedAnswers).toHaveBeenCalledWith(7, expect.any(Array), 'CONTINUE', 'ko');
    expect(api.updateCareerFixedAnswers.mock.calls[0][1][0].answer).toBe('혼자 오래 집중해서 하는 일');
    expect(await screen.findByText(/처음 답변을 바꿨어요/)).toBeInTheDocument();
    expect(screen.getByText(/계속 사람을 상대하는 일 → 혼자 오래 집중해서 하는 일/)).toBeInTheDocument();
    expect(screen.getByText('바뀐 답 반영 질문')).toBeInTheDocument();
    expect(screen.getByText('첫 AI 질문'), '이어서 대화라 이전 대화가 보인다').toBeInTheDocument();
  });

  it('"처음부터 다시"로 고친 상담은 그 기록부터 보여 주고, 다시 열면 고친 답이 골라져 있다', async () => {
    api.getLatestCareerSession.mockResolvedValue(session([
      ...fixedBlock, { role: 'assistant', content: '옛 대화' }, update('RESTART', ANSWERS[0], '혼자 오래 집중해서 하는 일'), { role: 'assistant', content: '새 첫 질문' },
    ]));
    renderPage();
    expect(await screen.findByText('새 첫 질문')).toBeInTheDocument();
    expect(screen.queryByText('옛 대화')).toBeNull();
    expect(screen.getByText(/처음 답변을 바꾸고 대화를 새로 시작했어요/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '처음 답변 수정' }));
    const restart = screen.getByRole('button', { name: '처음부터 다시 시작' });
    expect(restart).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '혼자 오래 집중해서 하는 일' })[0]).toHaveClass('active');
    expect(screen.getAllByRole('button', { name: '계속 사람을 상대하는 일' })[0]).not.toHaveClass('active');
  });
});
