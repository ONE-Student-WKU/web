import React, { useState } from 'react';
import { createNotice, updateNotice, deleteNotice } from '../api/chatApi.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import MoreMenu from './MoreMenu.jsx';
import { IconChevronRight, IconPlus } from './icons.jsx';

const TITLE_MAX = 60;
const BODY_MAX = 3000;
// 전체 글 위에 줄로 보여줄 안 읽은 공지 수. 더 있으면 "외 n개 더 보기"로 목록에 보낸다.
const PIN_ROWS = 3;

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

// 목록에서 제목 아래 한 줄로 보여줄 본문 — 첫 번째 빈 줄이 아닌 줄.
function excerptOf(body) {
  return (
    String(body || '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || ''
  );
}

// 작성자 자리 — 기본 사람 아이콘에 작은 인증 체크를 붙여 일반 학생 프로필과 구별한다(2026-10-23 결정, 로고 대신).
function TeamAvatar() {
  return (
    <span className="notice-avatar" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.6" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
      <span className="notice-avatar-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 12.5 10.2 16.5 18 8" />
        </svg>
      </span>
    </span>
  );
}

/**
 * 전체 글 탭 맨 위의 공지(2026-10-23 개편). 안 읽은 공지가 있으면 몇 개인지와 최대 3개를 줄로 보여주고, 줄을 누르면 바로 그 공지가
 * 열린다. 다 읽었으면 최근 공지 한 줄로 줄어든다. 공지가 없으면 아무것도 그리지 않는다.
 * - notices: 공지 목록(최신 순)
 * - onOpenList(), onOpenNotice(notice)
 * - when(dateStr): 날짜 글자(커뮤니티 글과 같은 "오늘·어제·n일 전")
 */
export function NoticePin({ notices, onOpenList, onOpenNotice, when }) {
  const { t } = useI18n();
  if (!notices || notices.length === 0) return null;
  const unread = notices.filter((n) => n.isNew);
  if (unread.length === 0) {
    return (
      <button type="button" className="notice-pin" onClick={onOpenList}>
        <span className="notice-pin-label">{t('community.notice.badge')}</span>
        <span className="notice-pin-title">{notices[0].title}</span>
        <span className="notice-pin-more">{t('community.notice.all', { n: notices.length })} ›</span>
      </button>
    );
  }
  return (
    <div className="notice-pin notice-pin--unread">
      <div className="notice-pin-head">
        <span className="notice-pin-label">{t('community.notice.badge')}</span>
        <span className="notice-pin-count">{t('community.notice.unreadCount', { n: unread.length })}</span>
        <button type="button" className="notice-pin-all" onClick={onOpenList}>
          {t('community.notice.all', { n: notices.length })}
          <IconChevronRight size={14} />
        </button>
      </div>
      {unread.slice(0, PIN_ROWS).map((n) => (
        <button type="button" key={n.id} className="notice-pin-row" onClick={() => onOpenNotice(n)}>
          <i aria-hidden="true" />
          <span>{n.title}</span>
          <em>{when(n.createdAt)}</em>
        </button>
      ))}
      {unread.length > PIN_ROWS && (
        <button type="button" className="notice-pin-rest" onClick={onOpenList}>
          {t('community.notice.moreUnread', { n: unread.length - PIN_ROWS })}
        </button>
      )}
    </div>
  );
}

/**
 * CommunityNotices — 공지 목록·상세·관리자 글쓰기(운영팀이 쓰고 학생은 읽기만, 신청·신고·댓글 없음). 커뮤니티 글과 같은 모양(줄 목록,
 * 상자 없는 본문, 아래에 붙는 버튼)이다. 화면 단계(view)는 Community가 들고 있어 머리글 뒤로가기와 함께 움직인다.
 *
 * Props:
 * - view: { mode: 'list' | 'detail' | 'write', notice?: object } — write에 notice가 있으면 수정
 * - onChangeView(view | null): null이면 공지에서 나가 전체 글로 돌아간다
 * - notices: 공지 목록(최신 순) | null(불러오는 중)
 * - isAdmin: 관리자면 공지 쓰기·수정·삭제가 보인다(서버도 관리자만 받는다)
 * - onOpenNotice(notice): 상세를 연다(Community가 읽음으로 기록한다)
 * - onMarkAllRead(): "모두 읽음으로 표시"
 * - onChanged(): 공지를 쓰거나 고치거나 지운 뒤 목록을 다시 불러온다
 * - onToast(message)
 * - when(dateStr): 날짜 글자
 */
function CommunityNotices({ view, onChangeView, notices, isAdmin, onOpenNotice, onMarkAllRead, onChanged, onToast, when }) {
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
      <form className="post-write" onSubmit={handleSubmit}>
        <div className="post-write-inner">
          {error && <p className="home-error">{error}</p>}
          <p className="post-write-note">{t(editing ? 'community.notice.form.editHint' : 'community.notice.form.hint')}</p>
          <label htmlFor="notice-title" className="sr-only">
            {t('community.write.title')}
          </label>
          <input
            id="notice-title"
            className="post-write-title"
            type="text"
            maxLength={TITLE_MAX}
            placeholder={t('community.write.title')}
            value={fields.title}
            onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
            required
          />
          <label htmlFor="notice-body" className="sr-only">
            {t('community.write.body')}
          </label>
          <textarea
            id="notice-body"
            className="post-write-body"
            rows={8}
            maxLength={BODY_MAX}
            placeholder={t('community.write.body')}
            value={fields.body}
            onChange={(e) => setFields((f) => ({ ...f, body: e.target.value }))}
            required
          />
          <span className="post-write-count">
            {fields.body.length} / {BODY_MAX}
          </span>
        </div>
        <div className="post-dock">
          <button type="submit" className="post-btn post-btn--ink post-btn--block post-btn--lg" disabled={submitting}>
            {submitting ? t('community.write.saving') : editing ? t('community.write.update') : t('community.notice.submit')}
          </button>
        </div>
      </form>
    );
  }

  if (view.mode === 'detail' && view.notice) {
    const notice = view.notice;
    const menuItems = isAdmin
      ? [
          { label: t('community.edit'), onClick: () => openWrite(notice) },
          { label: t('community.delete'), onClick: () => handleDelete(notice), danger: true },
        ]
      : [];
    return (
      <div className="post-detail">
        {error && <p className="home-error">{error}</p>}
        <div className="post-over">
          <span className="post-cat notice-cat">{t('community.notice.badge')}</span>
        </div>
        <h2 className="post-detail-title">{notice.title}</h2>
        <div className="post-author">
          <TeamAvatar />
          <div className="post-author-text">
            <span className="post-author-name">{t('community.notice.author')}</span>
            <span className="post-author-sub">
              {formatDate(notice.createdAt)}
              {notice.updatedAt && ` · ${t('community.notice.edited')}`}
            </span>
          </div>
          <MoreMenu items={menuItems} />
        </div>
        <p className="post-body notice-body">{notice.body}</p>
        <p className="notice-readonly-note">{t('community.notice.readOnly')}</p>
      </div>
    );
  }

  const unreadCount = notices ? notices.filter((n) => n.isNew).length : 0;
  return (
    <>
      <div className="post-list-head">
        <h3>
          {t('community.notice.heading')}
          {notices?.length > 0 && <em>{notices.length}</em>}
        </h3>
        <span className="notice-head-actions">
          {unreadCount > 0 && (
            <button type="button" className="post-btn post-btn--text notice-markall" onClick={onMarkAllRead}>
              {t('community.notice.markAll')}
            </button>
          )}
          {isAdmin && (
            <button type="button" className="post-write-btn" onClick={() => openWrite()}>
              <IconPlus size={15} />
              {t('community.notice.write')}
            </button>
          )}
        </span>
      </div>
      {notices === null ? (
        <p className="courses-manual-hint community-pad">{t('community.loading')}</p>
      ) : notices.length === 0 ? (
        <p className="courses-manual-hint community-pad">{t('community.notice.empty')}</p>
      ) : (
        <div className="post-list">
          {notices.map((n) => {
            const excerpt = excerptOf(n.body);
            return (
              <button key={n.id} type="button" className={`post-row notice-row${n.isNew ? ' notice-row--new' : ''}`} onClick={() => onOpenNotice(n)}>
                {n.isNew && <span className="post-status post-status--no">{t('community.notice.new')}</span>}
                <span className="post-title">{n.title}</span>
                {excerpt && <span className="post-excerpt">{excerpt}</span>}
                <span className="post-meta">
                  {t('community.notice.author')} · {when(n.createdAt)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export default CommunityNotices;
