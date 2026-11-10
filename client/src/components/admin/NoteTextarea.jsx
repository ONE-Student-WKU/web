import React, { useLayoutEffect, useRef } from 'react';
import { NOTE_MAX_LENGTH } from './adminFormat.js';

/**
 * 학생에게 보내는 답변·처리 안내 입력칸(관리자 문의함·신고함).
 * - 글이 길어지면 칸이 따라 늘어난다(화면 높이의 60%까지, 그 뒤로는 칸 안에서 스크롤). 4줄 고정 칸에서는 긴 답변이 몇 줄만 보였다.
 * - maxLength로 자르지 않는다 — 긴 글을 붙여넣으면 말없이 뒤가 잘려 학생에게 반쯤 끊긴 답변이 갈 뻔했다(2026-11-10).
 *   대신 남은 글자 수를 보여 주고, 넘으면 빨갛게 알린다. 넘었을 때 보내기를 막는 건 부르는 쪽이 noteTooLong()으로 한다.
 *
 * Props: id, value, onChange(value), minRows(기본 4)
 */
export function noteTooLong(value) {
  return String(value ?? '').trim().length > NOTE_MAX_LENGTH;
}

function NoteTextarea({ id, value, onChange, minRows = 4 }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 내용 높이에 맞춘다: 먼저 줄인 뒤 scrollHeight를 읽어야 글을 지울 때도 칸이 다시 줄어든다. 최소 높이는 rows, 최대는 CSS max-height.
    el.style.height = 'auto';
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  }, [value]);

  const length = String(value ?? '').trim().length;
  const over = length > NOTE_MAX_LENGTH;
  return (
    <>
      <textarea
        ref={ref}
        id={id}
        className="post-input admin-textarea admin-note-textarea"
        rows={minRows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={over || undefined}
        aria-describedby={`${id}-count`}
      />
      <p id={`${id}-count`} className={`admin-note-count${over ? ' over' : ''}`} aria-live="polite">
        {over ? `${(length - NOTE_MAX_LENGTH).toLocaleString()}자 넘었어요 · ` : ''}
        {length.toLocaleString()} / {NOTE_MAX_LENGTH.toLocaleString()}자
      </p>
    </>
  );
}

export default NoteTextarea;
