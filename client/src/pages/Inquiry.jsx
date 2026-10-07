import React, { useEffect, useRef, useState } from 'react';
import { createInquiry, getMyInquiries } from '../api/chatApi.js';
import { IconChevronLeft, IconCheck } from '../components/icons.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

// App.css에 open/resolved 전용 배지 색이 없어서(커뮤니티 글 상태용 pending/approved만 있음),
// 새 CSS를 추가하는 대신 의미가 같은 기존 클래스를 재사용한다 — open은 pending과, resolved는
// approved와 같은 "아직 대기 중 / 처리 끝남" 의미라 색상도 자연스럽게 맞아떨어진다.
const STATUS_BADGE_CLASS = { open: 'pending', resolved: 'approved' };
// 목록 불러오기 실패는 이펙트가 부르는 loadMine 안에서 세팅되므로, 번역 함수에 의존하지 않게 문구 대신 키를 담고 렌더에서 번역한다.
const LOAD_ERROR = { key: 'inquiry.err.load' };
const TITLE_MAX_LENGTH = 50;
const CONTENT_MAX_LENGTH = 2000;

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Inquiry Page
 * 문의하기(#166) — 버그/문제 제보, 커뮤니티와 무관한 범용 채널. 어느 화면에서 문제를
 * 겪었든 그 자리에서 바로 올 수 있도록 AccountMenu를 쓰는 모든 화면에서 진입 가능.
 *
 * Props:
 * - onGoHome: function
 */
function Inquiry({ onGoHome }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('write'); // 'write' | 'mine'
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [myInquiries, setMyInquiries] = useState([]);
  const [loading, setLoading] = useState(false);

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const loadMine = () => {
    setLoading(true);
    setError(null);
    getMyInquiries()
      .then(setMyInquiries)
      .catch(() => setError(LOAD_ERROR))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (tab === 'mine') loadMine();
  }, [tab]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createInquiry(title.trim(), content.trim());
      showToast(t('inquiry.toast.sent'));
      setTitle('');
      setContent('');
      setTab('mine');
    } catch {
      setError(t('inquiry.err.send'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label={t('common.backHome')}>
            <IconChevronLeft />
          </button>
          <span className="screen-title">{t('inquiry.title')}</span>
        </div>
      </header>

      {toast && (
        <div className="import-toast">
          <IconCheck size={13} />
          <span>{toast}</span>
        </div>
      )}

      <div className="courses-body">
        <div className="courses-year-tabs">
          <button type="button" className={`courses-year-tab ${tab === 'write' ? 'active' : ''}`} onClick={() => setTab('write')}>
            {t('inquiry.tab.write')}
          </button>
          <button type="button" className={`courses-year-tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>
            {t('inquiry.tab.mine')}
          </button>
        </div>

        {error && <p className="home-error">{typeof error === 'object' ? t(error.key) : error}</p>}

        {tab === 'write' ? (
          <form className="courses-manual-fields" onSubmit={handleSubmit}>
            <p className="courses-manual-hint">{t('inquiry.hint')}</p>
            <div className="auth-field">
              <label>{t('inquiry.field.title')}</label>
              <input type="text" maxLength={TITLE_MAX_LENGTH} value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="auth-field">
              <label>{t('inquiry.field.content')}</label>
              <textarea
                rows={8}
                maxLength={CONTENT_MAX_LENGTH}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('inquiry.placeholder')}
                required
              />
            </div>
            <button type="submit" className="auth-submit-btn" disabled={submitting}>
              {submitting ? t('inquiry.sending') : t('inquiry.send')}
            </button>
          </form>
        ) : loading ? (
          <p className="courses-manual-hint">{t('inquiry.loading')}</p>
        ) : myInquiries.length === 0 ? (
          <p className="courses-manual-hint">{t('inquiry.empty')}</p>
        ) : (
          <div className="community-post-list">
            {myInquiries.map((i) => (
              <div key={i.id} className="community-post-list-item">
                <span className="community-post-list-row">
                  <span className="community-post-list-title">{i.title}</span>
                  <span className={`community-badge community-badge-${STATUS_BADGE_CLASS[i.status]}`}>{t(`inquiry.status.${i.status}`)}</span>
                </span>
                <p className="community-detail-body">{i.content}</p>
                <span className="courses-list-item-meta">{formatDate(i.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Inquiry;
