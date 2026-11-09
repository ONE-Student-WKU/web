import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewPrompt from './ReviewPrompt.jsx';

/**
 * client/src/components/ReviewPrompt.test.jsx
 * 후기 창: 별을 고르기 전엔 보낼 수 없고, 보내면 "고마워요"로 바뀌며, 다음에는 아무것도 보내지 않고 닫는다.
 */

describe('후기 창', () => {
  it('별을 고르기 전에는 보내기가 눌리지 않는다', () => {
    render(<ReviewPrompt onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
    expect(screen.getByText('후기는 익명으로 소개 자료에 쓸 수 있어요.')).toBeInTheDocument();
  });

  it('별점과 후기를 보내면 고마워요 화면으로 바뀌고, 닫기로 끝난다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ReviewPrompt onSubmit={onSubmit} onClose={onClose} />);
    await userEvent.click(screen.getByRole('radio', { name: '4점' }));
    await userEvent.type(screen.getByRole('textbox'), '  남은 학점이 잘 보여요 ');
    await userEvent.click(screen.getByRole('button', { name: '보내기' }));
    expect(onSubmit).toHaveBeenCalledWith({ rating: 4, content: '남은 학점이 잘 보여요' });
    expect(await screen.findByText('고마워요!')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('보내지 못하면 창에 남아 다시 누를 수 있게 알린다', async () => {
    render(<ReviewPrompt onSubmit={vi.fn().mockRejectedValue(new Error('x'))} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: '5점' }));
    await userEvent.click(screen.getByRole('button', { name: '보내기' }));
    expect(await screen.findByText('후기를 보내지 못했어요. 잠시 후 다시 눌러주세요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보내기' })).toBeEnabled();
  });

  it('다음에는 아무것도 보내지 않고 닫는다', async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<ReviewPrompt onSubmit={onSubmit} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: '다음에' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
