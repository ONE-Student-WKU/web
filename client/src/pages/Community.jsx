import React, { useEffect, useRef, useState } from 'react';
import { getCommunityPosts, getMyCommunityPosts, getCommunityPost, createCommunityPost } from '../api/chatApi.js';
import AccountMenu from '../components/AccountMenu.jsx';
import { IconChevronLeft, IconCheck, IconPlus } from '../components/icons.jsx';

// Home.jsx와 동일한 이유(재진입 시 빈 화면 깜빡임 방지)로 모듈 스코프에 캐시해둔다.
const communityCache = { posts: null, myPosts: null };

// App.jsx의 resetAllUserCaches가 로그아웃/계정 삭제 시 호출.
// eslint-disable-next-line react-refresh/only-export-components -- App.jsx가 재사용하는 캐시 리셋 함수라 의도적으로 컴포넌트와 같이 export함.
export function resetCommunityCache() {
  communityCache.posts = null;
  communityCache.myPosts = null;
}

const MY_POST_STATUS_LABEL = { pending: '대기중', approved: '승인됨', rejected: '반려됨' };

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Community Page
 * 커뮤니티(스터디/프로젝트 모집) 게시판 — 2단계: 글쓰기 + 목록/상세.
 * 신청/수락·반려/모집마감/이메일 공개는 3단계에서 추가된다(관리자 승인 전까지 글은
 * 비공개이므로, 지금은 승인을 서버 API를 직접 호출해서 처리한다 — 관리자 화면은 4단계).
 *
 * Props:
 * - user: object
 * - onGoHome: function
 * - onLogout: function
 * - onOpenSettings: function
 * - onOpenOnboarding: function
 * - onOpenProfile: function
 */
function Community({ user, onGoHome, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile }) {
  const [tab, setTab] = useState('list'); // 'list' | 'mine'
  const [posts, setPosts] = useState(communityCache.posts || []);
  const [myPosts, setMyPosts] = useState(communityCache.myPosts || []);
  const [loading, setLoading] = useState(communityCache.posts === null);
  const [error, setError] = useState(null);

  const [selectedPost, setSelectedPost] = useState(null); // 상세 뷰(목록 클릭 시)
  const [detailLoading, setDetailLoading] = useState(false);

  const [showWriteForm, setShowWriteForm] = useState(false);
  const [writeFields, setWriteFields] = useState({ title: '', body: '' });
  const [writeSubmitting, setWriteSubmitting] = useState(false);

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  useEffect(() => {
    Promise.all([getCommunityPosts(), getMyCommunityPosts()])
      .then(([list, mine]) => {
        setPosts(list);
        setMyPosts(mine);
        communityCache.posts = list;
        communityCache.myPosts = mine;
      })
      .catch(() => setError('커뮤니티 글을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'))
      .finally(() => setLoading(false));
  }, []);

  const openPost = (id) => {
    setDetailLoading(true);
    setError(null);
    getCommunityPost(id)
      .then(setSelectedPost)
      .catch(() => setError('글을 불러오지 못했어요.'))
      .finally(() => setDetailLoading(false));
  };

  const handleWriteSubmit = async (e) => {
    e.preventDefault();
    if (!writeFields.title.trim() || !writeFields.body.trim()) return;
    setWriteSubmitting(true);
    setError(null);
    try {
      await createCommunityPost({ title: writeFields.title.trim(), body: writeFields.body.trim() });
      const mine = await getMyCommunityPosts();
      setMyPosts(mine);
      communityCache.myPosts = mine;
      setWriteFields({ title: '', body: '' });
      setShowWriteForm(false);
      setTab('mine');
      showToast('글을 올렸어요 — 승인 후 목록에 노출돼요.');
    } catch {
      setError('글을 올리지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setWriteSubmitting(false);
    }
  };

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label="홈으로">
            <IconChevronLeft />
          </button>
          <span className="screen-title">커뮤니티</span>
        </div>
        <AccountMenu
          user={user}
          onLogout={onLogout}
          onOpenSettings={onOpenSettings}
          onOpenOnboarding={onOpenOnboarding}
          onOpenProfile={onOpenProfile}
        />
      </header>

      {toast && (
        <div className="import-toast">
          <IconCheck size={13} />
          <span>{toast}</span>
        </div>
      )}

      <div className="courses-body">
        {selectedPost ? (
          <div className="community-detail">
            <button type="button" className="courses-manual-only-note courses-catalog-back" onClick={() => setSelectedPost(null)}>
              ‹ 목록으로 돌아가기
            </button>
            <h2 className="community-detail-title">{selectedPost.title}</h2>
            <p className="community-detail-meta">
              {selectedPost.author} · {formatDate(selectedPost.createdAt)}
              {selectedPost.closedAt && <span className="community-badge community-badge-closed">모집 마감</span>}
              {selectedPost.status && selectedPost.status !== 'approved' && (
                <span className={`community-badge community-badge-${selectedPost.status}`}>
                  {MY_POST_STATUS_LABEL[selectedPost.status]}
                </span>
              )}
            </p>
            <p className="community-detail-body">{selectedPost.body}</p>
          </div>
        ) : (
          <>
            {error && <p className="home-error">{error}</p>}

            <div className="courses-year-tabs">
              <button
                type="button"
                className={`courses-year-tab ${tab === 'list' ? 'active' : ''}`}
                onClick={() => setTab('list')}
              >
                전체 글
              </button>
              <button
                type="button"
                className={`courses-year-tab ${tab === 'mine' ? 'active' : ''}`}
                onClick={() => setTab('mine')}
              >
                내가 쓴 글
              </button>
            </div>

            {loading ? (
              <p className="courses-manual-hint">불러오는 중...</p>
            ) : tab === 'list' ? (
              posts.length === 0 ? (
                <p className="courses-manual-hint">아직 등록된 글이 없어요.</p>
              ) : (
                <div className="courses-search-results community-post-list">
                  {posts.map((p) => (
                    <button key={p.id} className="courses-search-result" onClick={() => openPost(p.id)} disabled={detailLoading}>
                      <span className="courses-list-item-name">
                        {p.title}
                        {p.closedAt && <span className="community-badge community-badge-closed">마감</span>}
                      </span>
                      <span className="courses-list-item-meta">
                        {p.author} · {formatDate(p.createdAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )
            ) : myPosts.length === 0 ? (
              <p className="courses-manual-hint">아직 쓴 글이 없어요.</p>
            ) : (
              <div className="courses-search-results community-post-list">
                {myPosts.map((p) => (
                  <button key={p.id} className="courses-search-result" onClick={() => openPost(p.id)} disabled={detailLoading}>
                    <span className="courses-list-item-name">
                      {p.title}
                      <span className={`community-badge community-badge-${p.status}`}>{MY_POST_STATUS_LABEL[p.status]}</span>
                      {p.closedAt && <span className="community-badge community-badge-closed">마감</span>}
                    </span>
                    <span className="courses-list-item-meta">{formatDate(p.createdAt)}</span>
                  </button>
                ))}
              </div>
            )}

            {showWriteForm ? (
              <form className="courses-manual-fields community-write-form" onSubmit={handleWriteSubmit}>
                <p className="courses-manual-hint">스터디·프로젝트 팀원을 구하는 글을 올려보세요. 관리자 승인 후 목록에 노출돼요.</p>
                <div className="auth-field">
                  <label>제목</label>
                  <input
                    type="text"
                    maxLength={100}
                    value={writeFields.title}
                    onChange={(e) => setWriteFields((f) => ({ ...f, title: e.target.value }))}
                    required
                  />
                </div>
                <div className="auth-field">
                  <label>내용</label>
                  <textarea
                    rows={6}
                    value={writeFields.body}
                    onChange={(e) => setWriteFields((f) => ({ ...f, body: e.target.value }))}
                    required
                  />
                </div>
                <button type="submit" className="auth-submit-btn" disabled={writeSubmitting}>
                  {writeSubmitting ? '올리는 중...' : '등록하기'}
                </button>
                <button
                  type="button"
                  className="courses-manual-only-note courses-catalog-back"
                  onClick={() => setShowWriteForm(false)}
                >
                  취소
                </button>
              </form>
            ) : (
              <button type="button" className="community-write-btn" onClick={() => setShowWriteForm(true)}>
                <IconPlus size={16} />글 쓰기
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Community;
