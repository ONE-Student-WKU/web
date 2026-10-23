import React, { useEffect, useRef, useState } from 'react';
import { IconMore } from './icons.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * "⋯" 메뉴 — 자주 쓰지 않는 동작(신고·수정·마감·삭제)을 접어 둔다. 바깥을 누르거나 Esc를 누르면 닫힌다.
 * items: [{ label, onClick, disabled?, danger?, hint? }] — hint는 막힌 이유(예: 신청자가 있어야 마감 가능)를 항목 아래에 보여준다.
 */
function MoreMenu({ items }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div className="more-menu" ref={rootRef}>
      <button type="button" className="more-menu-btn" aria-label={t('community.more')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <IconMore />
      </button>
      {open && (
        <div className="more-menu-list" role="menu">
          {items.map((item) => (
            <React.Fragment key={item.label}>
              <button
                type="button"
                role="menuitem"
                className={item.danger ? 'danger' : ''}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.label}
              </button>
              {item.hint && <p className="more-menu-hint">{item.hint}</p>}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

export default MoreMenu;
