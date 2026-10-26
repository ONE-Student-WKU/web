import React, { useEffect, useRef, useState } from 'react';
import { createInquiry, getMyInquiries } from '../api/chatApi.js';
import { IconChevronLeft, IconCheck, IconHelpCircle, IconPlus } from '../components/icons.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import { track } from '../utils/track.js';

// 상태는 커뮤니티와 같은 점 + 글자(post-status)로 보여준다 — 답변 기다리는 중은 노랑, 답변 완료는 초록.
const STATUS_TONE = { open: 'wait', resolved: 'ok' };
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
 * - draft: { title, content } | null — 다른 화면이 미리 채워 보낸 문의(예: 졸업요건 진단의 "결과가 이상해요")
 * - onDraftConsumed: function — 미리 채운 값을 입력 칸에 옮긴 뒤 호출(App이 지워서 다음에 메뉴로 들어올 땐 빈 칸)
 */
function Inquiry({ onGoHome, draft, onDraftConsumed }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('write'); // 'write' | 'mine'
  const [title, setTitle] = useState(draft?.title ?? '');
  const [content, setContent] = useState(draft?.content ?? '');
  // 입력 칸은 처음 그릴 때만 draft를 읽으므로, 옮긴 직후 App의 draft를 지워도 이 화면의 값은 그대로다.
  useEffect(() => {
    if (draft) onDraftConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 처음 그릴 때 한 번만
  }, []);
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
      track('inquiry.sent');
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

      {/* 커뮤니티 개편(2026-10-22)과 같은 배치 — 글자 탭, 큰 제목 칸, 화면 아래에 붙는 보내기, 상자 없는 목록. */}
      <div className="courses-body community-body">
        <div className="community-tabs">
          <button type="button" className={`community-tab ${tab === 'write' ? 'active' : ''}`} onClick={() => setTab('write')}>
            {t('inquiry.tab.write')}
          </button>
          <button type="button" className={`community-tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>
            {t('inquiry.tab.mine')}
          </button>
        </div>

        {error && (
          <div className="community-alerts">
            <p className="home-error">{typeof error === 'object' ? t(error.key) : error}</p>
          </div>
        )}

        {tab === 'write' ? (
          <form className="post-write" onSubmit={handleSubmit}>
            <div className="post-write-inner">
              <label htmlFor="inquiry-title" className="sr-only">
                {t('inquiry.field.title')}
              </label>
              <input
                id="inquiry-title"
                className="post-write-title"
                type="text"
                maxLength={TITLE_MAX_LENGTH}
                placeholder={t('inquiry.field.title')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
              <span className="post-write-count">
                {title.length} / {TITLE_MAX_LENGTH}
              </span>
              <label htmlFor="inquiry-content" className="sr-only">
                {t('inquiry.field.content')}
              </label>
              <textarea
                id="inquiry-content"
                className="post-write-body"
                rows={8}
                maxLength={CONTENT_MAX_LENGTH}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('inquiry.placeholder')}
                required
              />
              {/* 확인이 빨라지는 세 가지를 적어 둔다 — 문의를 받아 보면 "어디서·무엇을·어떻게"가 빠진 경우가 많다. */}
              <div className="post-tip">
                <b>{t('inquiry.tip.title')}</b>
                <ul>
                  <li>{t('inquiry.tip.where')}</li>
                  <li>{t('inquiry.tip.what')}</li>
                  <li>{t('inquiry.tip.result')}</li>
                </ul>
              </div>
            </div>
            <div className="post-dock">
              <button type="submit" className="post-btn post-btn--ink post-btn--block post-btn--lg" disabled={submitting}>
                {submitting ? t('inquiry.sending') : t('inquiry.send')}
              </button>
            </div>
          </form>
        ) : loading ? (
          <p className="post-empty">{t('inquiry.loading')}</p>
        ) : myInquiries.length === 0 ? (
          <div className="post-empty-state">
            <span className="post-empty-icon">
              <IconHelpCircle size={24} />
            </span>
            <p>{t('inquiry.empty')}</p>
            <span>{t('inquiry.emptySub')}</span>
            <button type="button" className="post-write-btn" onClick={() => setTab('write')}>
              <IconPlus size={15} />
              {t('inquiry.writeBtn')}
            </button>
          </div>
        ) : (
          <div className="post-list">
            {myInquiries.map((i) => (
              <div key={i.id} className="post-row post-row--static">
                <span className="post-over">
                  <span className={`post-status post-status--${STATUS_TONE[i.status] || 'mute'}`}>{t(`inquiry.status.${i.status}`)}</span>
                  <span className="post-over-end">{formatDate(i.createdAt)}</span>
                </span>
                <span className="post-title">{i.title}</span>
                <p className="post-section-desc post-pre">{i.content}</p>
                {i.resolutionNote && (
                  <p className="post-quote post-quote--answer">
                    <b className="post-quote-label">{t('inquiry.reply')}</b>
                    {i.resolutionNote}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Inquiry;
