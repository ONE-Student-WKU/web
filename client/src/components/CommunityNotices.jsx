import React, { useState } from 'react';
import { createNotice, updateNotice, deleteNotice } from '../api/chatApi.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import { IconPlus } from './icons.jsx';

const TITLE_MAX = 60;
const BODY_MAX = 3000;

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 전체 글 탭 맨 위에 고정하는 최신 공지 한 줄(B안, 2026-10-22). 누르면 공지 목록으로 간다.
 * - notices: 공지 목록(최신 순). 비어 있으면 아무것도 그리지 않는다.
 */
export function NoticePin({ notices, onOpen }) {
  const { t } = useI18n();
  if (!notices || notices.length === 0) return null;
  const latest = notices[0];
  return (
    <button type="button" className="notice-pin" onClick={onOpen}>
      <span className="notice-pin-label">{t('community.notice.badge')}</span>
      <span className="notice-pin-title">{latest.title}</span>
      {notices.some((n) => n.isNew) && <span className="tab-dot" aria-label={t('community.notice.newAria')} />}
      <span className="notice-pin-more">{t('community.notice.pinMore', { n: notices.length })}</span>
    </button>
  );
}

/**
 * CommunityNotices — 공지 목록·상세·관리자 글쓰기(운영자가 쓰고 학생은 읽기만, 신청·신고·댓글 없음).
 * 화면 단계(view)는 Community가 들고 있어 머리글 뒤로가기와 함께 움직인다.
 *
 * Props:
 * - view: { mode: 'list' | 'detail' | 'write', notice?: object } — write에 notice가 있으면 수정
 * - onChangeView(view | null): null이면 공지에서 나가 전체 글로 돌아간다
 * - notices: 공지 목록(최신 순) | null(불러오는 중)
 * - isAdmin: 관리자면 공지 쓰기·수정·삭제가 보인다(서버도 관리자만 받는다)
 * - onChanged(): 공지를 쓰거나 고치거나 지운 뒤 목록을 다시 불러온다
 * - onToast(message)
 */
function CommunityNotices({ view, onChangeView, notices, isAdmin, onChanged, onToast }) {
  const { t } = useI18n();
  const editing = view.mode === 'write' ? view.notice || null : null;
  const [fields, setFields] = useState(() => ({ title: editing?.title || '', body: editing?.body || '' }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const openWrite = (notice = null) => {
    setFields({ title: notice?.title || '', body: notice?.body || '' });
    setError(null);
    onChangeView({ mode: 'write', notice });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = { title: fields.title.trim(), body: fields.body.trim() };
    if (!payload.title || !payload.body) return;
    setSubmitting(true);
    setError(null);
    try {
      if (editing) await updateNotice(editing.id, payload);
      else await createNotice(payload);
      onToast(t(editing ? 'community.notice.toast.updated' : 'community.notice.toast.created'));
      await onChanged();
      onChangeView({ mode: 'list' });
    } catch {
      setError(t('community.notice.err.save'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (notice) => {
    if (!window.confirm(t('community.notice.confirmDelete'))) return;
    try {
      await deleteNotice(notice.id);
      onToast(t('community.notice.toast.deleted'));
      await onChanged();
      onChangeView({ mode: 'list' });
    } catch {
      setError(t('community.notice.err.save'));
    }
  };

  if (view.mode === 'write') {
    return (
      <form className="courses-manual-fields community-write-form" onSubmit={handleSubmit}>
        {error && <p className="home-error">{error}</p>}
        <p className="courses-manual-hint">{t('community.notice.form.hint')}</p>
        <div className="auth-field">
          <label htmlFor="notice-title">{t('community.write.title')}</label>
          <input id="notice-title" type="text" maxLength={TITLE_MAX} value={fields.title} onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))} required />
        </div>
        <div className="auth-field">
          <label htmlFor="notice-body">{t('community.write.body')}</label>
          <textarea id="notice-body" rows={8} maxLength={BODY_MAX} value={fields.body} onChange={(e) => setFields((f) => ({ ...f, body: e.target.value }))} required />
        </div>
        <button type="submit" className="auth-submit-btn" disabled={submitting}>
          {submitting ? t('community.write.saving') : editing ? t('community.write.update') : t('community.notice.submit')}
        </button>
        <button type="button" className="courses-manual-only-note courses-catalog-back" onClick={() => onChangeView(editing ? { mode: 'detail', notice: editing } : { mode: 'list' })}>
          {t('onb.cancel')}
        </button>
      </form>
    );
  }

  if (view.mode === 'detail' && view.notice) {
    const notice = view.notice;
    return (
      <div className="community-detail">
        {error && <p className="home-error">{error}</p>}
        <div className="community-detail-title-row">
          <h2 className="community-detail-title">{notice.title}</h2>
        </div>
        {/* 글 상세와 같이 작성자·날짜 줄 끝에 배지를 두고, 그 아래 구분선으로 본문과 나눈다. */}
        <p className="community-detail-meta community-detail-meta-divider">
          {t('community.notice.author')} · {formatDate(notice.createdAt)}
          {notice.updatedAt && ` · ${t('community.notice.edited')}`}
          <span className="community-badge community-badge-notice">{t('community.notice.badge')}</span>
        </p>
        <p className="community-detail-body community-detail-body-card">{notice.body}</p>
        <p className="notice-readonly-note">{t('community.notice.readOnly')}</p>
        {isAdmin && (
          <div className="community-owner-actions">
            <button type="button" className="community-outline-btn" onClick={() => openWrite(notice)}>
              {t('community.edit')}
            </button>
            <button type="button" className="community-outline-btn community-danger" onClick={() => handleDelete(notice)}>
              {t('community.delete')}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <p className="home-quick-label">{t('community.notice.heading')}</p>
      {notices === null ? (
        <p className="courses-manual-hint">{t('community.loading')}</p>
      ) : notices.length === 0 ? (
        <p className="courses-manual-hint">{t('community.notice.empty')}</p>
      ) : (
        <div className="community-post-list">
          {notices.map((n) => (
            <button key={n.id} className="community-post-list-item" onClick={() => onChangeView({ mode: 'detail', notice: n })}>
              <span className="community-post-list-row">
                <span className="community-post-list-title">{n.title}</span>
                {n.isNew && <span className="community-badge community-badge-new">{t('community.notice.new')}</span>}
              </span>
              <span className="courses-list-item-meta">
                {t('community.notice.author')} · {formatDate(n.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}
      {isAdmin && (
        <button type="button" className="community-write-btn" onClick={() => openWrite()}>
          <IconPlus />
          {t('community.notice.write')}
        </button>
      )}
    </>
  );
}

export default CommunityNotices;
