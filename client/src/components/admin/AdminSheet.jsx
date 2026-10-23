import React, { useEffect } from 'react';

/**
 * AdminSheet
 * 관리자 화면의 처리 창(제재·조치 없이 처리) — 아래에서 올라오는 시트. 예전 가운데 상자(career-confirm-modal)는 내용이 길면
 * 화면보다 커져 위 제목과 아래 취소 버튼이 화면 밖으로 잘렸다(768px 화면에서 제재 팝업을 닫을 수 없었다). 시트는 화면 높이의
 * 90%까지만 커지고 가운데만 스크롤돼서, 위 제목·닫기와 아래 확정 버튼은 항상 보인다. 바깥을 누르거나 Esc로 닫는다.
 *
 * Props:
 * - title: string
 * - onClose: function
 * - onSubmit: function — 아래 버튼(폼 제출)
 * - submitLabel: string
 * - submitting: boolean
 * - submitDisabled: boolean
 * - children: 가운데(스크롤되는) 내용
 */
function AdminSheet({ title, onClose, onSubmit, submitLabel, submitting = false, submitDisabled = false, children }) {
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="admin-sheet-overlay" onClick={onClose}>
      <form
        className="admin-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="admin-sheet-head">
          <span className="admin-sheet-grip" aria-hidden="true" />
          <b>{title}</b>
          <button type="button" className="post-btn post-btn--text" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="admin-sheet-body">{children}</div>
        <div className="admin-sheet-foot">
          <button type="submit" className="post-btn post-btn--ink post-btn--lg post-btn--block" disabled={submitting || submitDisabled}>
            {submitting ? '처리하는 중...' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export default AdminSheet;
