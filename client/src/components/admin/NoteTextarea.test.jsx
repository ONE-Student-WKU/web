import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NoteTextarea, { noteTooLong } from './NoteTextarea.jsx';
import { NOTE_MAX_LENGTH } from './adminFormat.js';

function Harness({ initial = '' }) {
  const [value, setValue] = useState(initial);
  return <NoteTextarea id="note" value={value} onChange={setValue} />;
}

describe('NoteTextarea', () => {
  it('상한은 2000자이고, 앞뒤 공백을 뺀 길이로 넘었는지 본다', () => {
    expect(NOTE_MAX_LENGTH).toBe(2000);
    expect(noteTooLong('ㅇ'.repeat(2000))).toBe(false);
    expect(noteTooLong(`  ${'ㅇ'.repeat(2000)}  `)).toBe(false);
    expect(noteTooLong('ㅇ'.repeat(2001))).toBe(true);
    expect(noteTooLong(null)).toBe(false);
  });

  it('긴 글을 붙여넣어도 자르지 않고, 넘은 글자 수를 알린다(500자에서 말없이 잘렸다)', () => {
    render(<Harness />);
    const box = screen.getByRole('textbox');
    expect(box).not.toHaveAttribute('maxLength');
    fireEvent.change(box, { target: { value: 'ㅇ'.repeat(2005) } });
    expect(box.value).toHaveLength(2005);
    expect(screen.getByText(/5자 넘었어요/)).toHaveClass('over');
    expect(box).toHaveAttribute('aria-invalid', 'true');
  });

  it('상한 안이면 지금 글자 수만 보여 준다', () => {
    render(<Harness initial="안녕하세요" />);
    expect(screen.getByText('5 / 2,000자')).not.toHaveClass('over');
  });
});
