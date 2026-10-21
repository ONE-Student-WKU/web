import React from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * 매칭 연락 주소 + 설명 + "연락 차단" 버튼. 연락 주소는 서비스가 만든 중계 주소라(실제 이메일을 숨긴다) 처음 보면 오류처럼
 * 보여서, 바로 아래에 무엇인지 짧게 알린다(2026-10-22 피드백).
 */
export function ContactBox({ email, onBlock }) {
  const { t } = useI18n();
  return (
    <>
      <div className="community-contact-box">
        <b>{t('community.label.contactEmail')}</b> · {email}
      </div>
      <p className="contact-relay-hint">{t('community.contact.hint')}</p>
      <button type="button" className="contact-block-link" onClick={onBlock}>
        {t('community.contact.block')}
      </button>
    </>
  );
}

/** 연락을 차단한 매칭 — 누가 차단했는지는 보여주지 않는다. */
export function ContactBlockedNote({ blockedAt, formatDate }) {
  const { t } = useI18n();
  return <p className="contact-blocked-note">{t('community.contact.blockedNote', { date: formatDate(blockedAt) })}</p>;
}

/**
 * 연락 차단 확인 팝업. target: { name } | null(닫힘). 닉네임은 사람이 정한 값이라 번역하지 않고 그대로 끼운다.
 */
export function BlockContactDialog({ target, submitting, onConfirm, onClose }) {
  const { t } = useI18n();
  if (!target) return null;
  return (
    <div className="career-confirm-overlay" onClick={onClose}>
      <div className="career-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="block-contact-title" onClick={(e) => e.stopPropagation()}>
        <p className="career-confirm-title" id="block-contact-title">
          {t('community.contact.confirmTitle', { name: target.name })}
        </p>
        <p className="career-confirm-body">{t('community.contact.confirmBody')}</p>
        <div className="community-applicant-actions">
          <button type="button" className="community-act-btn community-act-reject" onClick={onClose} disabled={submitting}>
            {t('onb.cancel')}
          </button>
          <button type="button" className="community-act-btn community-act-sanction" onClick={onConfirm} disabled={submitting}>
            {t('community.contact.confirmBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
