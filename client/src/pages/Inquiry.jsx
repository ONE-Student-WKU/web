import React, { useEffect, useRef, useState } from 'react';
import { createInquiry, getMyInquiries } from '../api/chatApi.js';
import { IconChevronLeft, IconCheck } from '../components/icons.jsx';

const STATUS_LABEL = { open: '대기중', resolved: '처리완료' };
// App.css에 open/resolved 전용 배지 색이 없어서(커뮤니티 글 상태용 pending/approved만 있음),
// 새 CSS를 추가하는 대신 의미가 같은 기존 클래스를 재사용한다 — open은 pending과, resolved는
// approved와 같은 "아직 대기 중 / 처리 끝남" 의미라 색상도 자연스럽게 맞아떨어진다.
const STATUS_BADGE_CLASS = { open: 'pending', resolved: 'approved' };
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
      .catch(() => setError('문의 목록을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'))
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
      showToast('문의를 보냈어요.');
      setTitle('');
      setContent('');
      setTab('mine');
    } catch {
      setError('문의를 보내지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label="홈으로">
            <IconChevronLeft />
          </button>
          <span className="screen-title">문의하기</span>
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
            문의하기
          </button>
          <button type="button" className={`courses-year-tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>
            내 문의
          </button>
        </div>

        {error && <p className="home-error">{error}</p>}

        {tab === 'write' ? (
          <form className="courses-manual-fields" onSubmit={handleSubmit}>
            <p className="courses-manual-hint">버그나 문제가 생겼을 때 알려주세요. 화면·상황을 자세히 적을수록 확인이 빨라져요.</p>
            <div className="auth-field">
              <label>제목</label>
              <input type="text" maxLength={TITLE_MAX_LENGTH} value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="auth-field">
              <label>내용</label>
              <textarea
                rows={8}
                maxLength={CONTENT_MAX_LENGTH}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="어떤 화면에서, 무엇을 하다가, 어떤 문제가 생겼는지 적어주세요."
                required
              />
            </div>
            <button type="submit" className="auth-submit-btn" disabled={submitting}>
              {submitting ? '보내는 중...' : '보내기'}
            </button>
          </form>
        ) : loading ? (
          <p className="courses-manual-hint">불러오는 중...</p>
        ) : myInquiries.length === 0 ? (
          <p className="courses-manual-hint">아직 보낸 문의가 없어요.</p>
        ) : (
          <div className="community-post-list">
            {myInquiries.map((i) => (
              <div key={i.id} className="community-post-list-item">
                <span className="community-post-list-row">
                  <span className="community-post-list-title">{i.title}</span>
                  <span className={`community-badge community-badge-${STATUS_BADGE_CLASS[i.status]}`}>{STATUS_LABEL[i.status]}</span>
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
