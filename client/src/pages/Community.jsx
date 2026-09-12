import React, { useEffect, useRef, useState } from 'react';
import {
  getCommunityPosts,
  getMyCommunityPosts,
  getCommunityPost,
  createCommunityPost,
  editCommunityPost,
  deleteCommunityPost,
  closeCommunityPost,
  applyToCommunityPost,
  getMyCommunityApplications,
  getCommunityApplicants,
  acceptCommunityApplication,
  rejectCommunityApplication,
} from '../api/chatApi.js';
import AccountMenu from '../components/AccountMenu.jsx';
import { IconChevronLeft, IconCheck, IconPlus } from '../components/icons.jsx';

// Home.jsx와 동일한 이유(재진입 시 빈 화면 깜빡임 방지)로 모듈 스코프에 캐시해둔다.
const communityCache = { posts: null, myPosts: null, myApplications: null };

// App.jsx의 resetAllUserCaches가 로그아웃/계정 삭제 시 호출.
// eslint-disable-next-line react-refresh/only-export-components -- App.jsx가 재사용하는 캐시 리셋 함수라 의도적으로 컴포넌트와 같이 export함.
export function resetCommunityCache() {
  communityCache.posts = null;
  communityCache.myPosts = null;
  communityCache.myApplications = null;
}

const MY_POST_STATUS_LABEL = { pending: '대기중', approved: '승인됨', rejected: '반려됨' };
const APPLICATION_STATUS_LABEL = { pending: '대기중', accepted: '수락됨', rejected: '반려됨' };

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Community Page
 * 커뮤니티(스터디/프로젝트 모집) 게시판 — 2단계(글쓰기+목록/상세) + 3단계(신청+수락/반려+
 * 모집마감+수정/삭제). 관리자 승인 화면은 아직 없음(4단계) — 승인/반려는 서버 API를
 * 직접 호출해서 처리한다.
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
  const [tab, setTab] = useState('list'); // 'list' | 'mine' | 'applications'
  const [posts, setPosts] = useState(communityCache.posts || []);
  const [myPosts, setMyPosts] = useState(communityCache.myPosts || []);
  const [myApplications, setMyApplications] = useState(communityCache.myApplications || []);
  const [loading, setLoading] = useState(communityCache.posts === null);
  const [error, setError] = useState(null);

  const [selectedPost, setSelectedPost] = useState(null); // 상세 뷰(목록 클릭 시)
  const [detailLoading, setDetailLoading] = useState(false);
  // 내 글 상세에서만 쓰는 신청자 목록 — selectedPost.isMine일 때만 채워짐.
  const [applicants, setApplicants] = useState([]);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  const [applicantActionId, setApplicantActionId] = useState(null); // 수락/반려 처리 중인 신청 id

  const [showWriteForm, setShowWriteForm] = useState(false);
  const [writeFields, setWriteFields] = useState({ title: '', body: '' });
  const [writeSubmitting, setWriteSubmitting] = useState(false);
  // null이면 새 글 작성, 값이 있으면 그 id의 글을 수정 중(같은 폼을 재사용).
  const [editingPostId, setEditingPostId] = useState(null);

  const [applyMessage, setApplyMessage] = useState('');
  const [applySubmitting, setApplySubmitting] = useState(false);
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  useEffect(() => {
    Promise.all([getCommunityPosts(), getMyCommunityPosts(), getMyCommunityApplications()])
      .then(([list, mine, myApps]) => {
        setPosts(list);
        setMyPosts(mine);
        setMyApplications(myApps);
        communityCache.posts = list;
        communityCache.myPosts = mine;
        communityCache.myApplications = myApps;
      })
      .catch(() => setError('커뮤니티 글을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'))
      .finally(() => setLoading(false));
  }, []);

  const openPost = (id) => {
    setDetailLoading(true);
    setError(null);
    setApplyMessage('');
    setApplicants([]);
    getCommunityPost(id)
      .then((post) => {
        setSelectedPost(post);
        if (post.isMine) {
          setApplicantsLoading(true);
          getCommunityApplicants(id)
            .then(setApplicants)
            .catch(() => setError('신청자 목록을 불러오지 못했어요.'))
            .finally(() => setApplicantsLoading(false));
        }
      })
      .catch(() => setError('글을 불러오지 못했어요.'))
      .finally(() => setDetailLoading(false));
  };

  // 목록 3개(전체 글/내가 쓴 글/내 신청)를 전부 다시 불러온다 — 글/신청 상태가 바뀌는
  // 액션(작성/수정/삭제/신청/수락/반려/마감) 뒤에는 여러 목록에 동시에 영향을 주므로
  // 하나씩 골라 갱신하기보다 한 번에 새로고침하는 편이 안전하다.
  const refreshLists = async () => {
    const [list, mine, myApps] = await Promise.all([getCommunityPosts(), getMyCommunityPosts(), getMyCommunityApplications()]);
    setPosts(list);
    setMyPosts(mine);
    setMyApplications(myApps);
    communityCache.posts = list;
    communityCache.myPosts = mine;
    communityCache.myApplications = myApps;
  };

  const resetAfterWrite = () => {
    setWriteFields({ title: '', body: '' });
    setEditingPostId(null);
    setShowWriteForm(false);
  };

  // 헤더 좌측 화살표 — 목록/상세/글쓰기 중 어디에 있는지에 따라 한 단계만 뒤로 간다.
  // 글쓰기·상세 화면에서도 그냥 onGoHome을 쓰면 커뮤니티 목록을 건너뛰고 바로 홈으로
  // 나가버려서(글 쓰던 중이면 작성 중이던 내용까지 예고 없이 날아감), 서브뷰가 열려있을
  // 땐 그 서브뷰만 닫고 목록으로 돌아가게 한다.
  const handleHeaderBack = () => {
    if (showWriteForm) {
      resetAfterWrite();
    } else if (selectedPost) {
      setSelectedPost(null);
    } else {
      onGoHome();
    }
  };

  const handleWriteSubmit = async (e) => {
    e.preventDefault();
    if (!writeFields.title.trim() || !writeFields.body.trim()) return;
    setWriteSubmitting(true);
    setError(null);
    try {
      const payload = { title: writeFields.title.trim(), body: writeFields.body.trim() };
      if (editingPostId) {
        await editCommunityPost(editingPostId, payload);
        showToast('수정했어요 — 다시 승인 대기 중이에요.');
      } else {
        await createCommunityPost(payload);
        showToast('글을 올렸어요 — 승인 후 목록에 노출돼요.');
      }
      resetAfterWrite();
      setSelectedPost(null);
      setTab('mine');
      await refreshLists();
    } catch {
      setError(editingPostId ? '수정하지 못했어요. 잠시 후 다시 시도해주세요.' : '글을 올리지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setWriteSubmitting(false);
    }
  };

  const startEdit = (post) => {
    setWriteFields({ title: post.title, body: post.body });
    setEditingPostId(post.id);
    setSelectedPost(null);
    setShowWriteForm(true);
  };

  const handleDelete = async (post) => {
    if (!window.confirm('정말 이 글을 삭제할까요? 신청 내역도 함께 삭제되고 되돌릴 수 없어요.')) return;
    setDeleteSubmitting(true);
    setError(null);
    try {
      await deleteCommunityPost(post.id);
      showToast('삭제했어요.');
      setSelectedPost(null);
      setTab('mine');
      await refreshLists();
    } catch {
      setError('삭제하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const handleClose = async (post) => {
    setCloseSubmitting(true);
    setError(null);
    try {
      await closeCommunityPost(post.id);
      showToast('모집을 마감했어요.');
      openPost(post.id);
      await refreshLists();
    } catch {
      setError('마감하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setCloseSubmitting(false);
    }
  };

  const handleApply = async (e) => {
    e.preventDefault();
    if (!applyMessage.trim() || !selectedPost) return;
    setApplySubmitting(true);
    setError(null);
    try {
      await applyToCommunityPost(selectedPost.id, applyMessage.trim());
      showToast('신청했어요 — 글쓴이가 검토하면 알 수 있어요.');
      setApplyMessage('');
      openPost(selectedPost.id);
      const myApps = await getMyCommunityApplications();
      setMyApplications(myApps);
      communityCache.myApplications = myApps;
    } catch (err) {
      setError(err.code === 'DUPLICATE_APPLICATION' ? '이미 이 글에 신청했어요.' : '신청하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setApplySubmitting(false);
    }
  };

  const handleDecideApplication = async (applicationId, decision) => {
    setApplicantActionId(applicationId);
    setError(null);
    try {
      if (decision === 'accepted') await acceptCommunityApplication(applicationId);
      else await rejectCommunityApplication(applicationId);
      showToast(decision === 'accepted' ? '수락했어요.' : '반려했어요.');
      if (selectedPost) {
        const updated = await getCommunityApplicants(selectedPost.id);
        setApplicants(updated);
      }
    } catch {
      setError('처리하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setApplicantActionId(null);
    }
  };

  const renderDetail = () => {
    const post = selectedPost;
    return (
      <div className="community-detail">
        <button
          type="button"
          className="courses-manual-only-note courses-catalog-back"
          onClick={() => setSelectedPost(null)}
        >
          ‹ 목록으로 돌아가기
        </button>
        <h2 className="community-detail-title">{post.title}</h2>
        <p className="community-detail-meta">
          {post.author} · {formatDate(post.createdAt)}
          {post.closedAt && <span className="community-badge community-badge-closed">모집 마감</span>}
          {post.status !== 'approved' && (
            <span className={`community-badge community-badge-${post.status}`}>{MY_POST_STATUS_LABEL[post.status]}</span>
          )}
        </p>
        <p className="community-detail-body">{post.body}</p>

        {post.isMine ? (
          <>
            {post.status === 'approved' && !post.closedAt && (
              <>
                <button
                  type="button"
                  className="community-close-btn"
                  onClick={() => handleClose(post)}
                  disabled={closeSubmitting || applicantsLoading || applicants.length === 0}
                >
                  {closeSubmitting ? '처리 중...' : '모집 마감하기'}
                </button>
                {!applicantsLoading && applicants.length === 0 && (
                  <p className="community-close-hint">신청자가 1명 이상 있어야 마감할 수 있어요.</p>
                )}
              </>
            )}
            <div className="community-owner-actions">
              <button type="button" className="community-outline-btn" onClick={() => startEdit(post)}>
                수정
              </button>
              <button type="button" className="community-outline-btn community-danger" onClick={() => handleDelete(post)} disabled={deleteSubmitting}>
                {deleteSubmitting ? '삭제 중...' : '삭제'}
              </button>
            </div>

            <p className="community-section-label">신청자 {applicants.length}명</p>
            {applicantsLoading ? (
              <p className="courses-manual-hint">불러오는 중...</p>
            ) : applicants.length === 0 ? (
              <p className="courses-manual-hint">아직 신청자가 없어요.</p>
            ) : (
              <div className="community-applicant-list">
                {applicants.map((a) => (
                  <div className="community-applicant-card" key={a.id}>
                    <div className="community-applicant-top">
                      <span className="community-applicant-name">{a.applicant}</span>
                      {a.hasAppliedBefore && <span className="community-badge community-badge-reapply">재신청</span>}
                      <span className={`community-badge community-badge-${a.status}`}>{APPLICATION_STATUS_LABEL[a.status]}</span>
                    </div>
                    <p className="community-applicant-msg">{a.message}</p>
                    <div className="community-applicant-date">{formatDate(a.createdAt)}</div>
                    {a.status === 'pending' && (
                      <div className="community-applicant-actions">
                        <button
                          type="button"
                          className="community-act-btn community-act-accept"
                          onClick={() => handleDecideApplication(a.id, 'accepted')}
                          disabled={applicantActionId === a.id}
                        >
                          수락
                        </button>
                        <button
                          type="button"
                          className="community-act-btn community-act-reject"
                          onClick={() => handleDecideApplication(a.id, 'rejected')}
                          disabled={applicantActionId === a.id}
                        >
                          거부
                        </button>
                      </div>
                    )}
                    {a.status === 'accepted' && a.contactEmail && (
                      <div className="community-contact-box">
                        <b>연락 이메일</b> · {a.contactEmail}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : post.myApplication === null ? (
          post.closedAt ? (
            <p className="courses-manual-hint">모집이 마감됐어요.</p>
          ) : (
            <form className="community-apply-form" onSubmit={handleApply}>
              <div className="auth-field">
                <label>신청 메시지</label>
                <textarea
                  rows={5}
                  value={applyMessage}
                  onChange={(e) => setApplyMessage(e.target.value)}
                  placeholder="간단한 소개나 참여하고 싶은 이유를 적어주세요."
                  required
                />
              </div>
              <button type="submit" className="auth-submit-btn" disabled={applySubmitting}>
                {applySubmitting ? '신청하는 중...' : '신청하기'}
              </button>
            </form>
          )
        ) : (
          <div className="community-status-box">
            <div className="community-status-top">
              <span className="community-status-label">내 신청</span>
              <span className={`community-badge community-badge-${post.myApplication.status}`}>
                {APPLICATION_STATUS_LABEL[post.myApplication.status]}
              </span>
            </div>
            {post.myApplication.status === 'pending' && (
              <p className="community-status-desc">글쓴이가 아직 검토하지 않았어요.</p>
            )}
            {post.myApplication.status === 'accepted' && (
              <p className="community-status-desc">수락됐어요! "내 신청" 탭에서 연락 이메일을 확인해보세요.</p>
            )}
            {post.myApplication.status === 'rejected' && !post.closedAt && (
              <>
                <p className="community-status-desc">아쉽지만 이번엔 선정되지 않았어요. 메시지를 보완해서 다시 신청할 수 있어요.</p>
                <form className="community-apply-form" onSubmit={handleApply}>
                  <div className="auth-field">
                    <label>다시 신청하기</label>
                    <textarea
                      rows={4}
                      value={applyMessage}
                      onChange={(e) => setApplyMessage(e.target.value)}
                      placeholder="이전과 다른 점을 보완해서 다시 적어보세요."
                      required
                    />
                  </div>
                  <button type="submit" className="auth-submit-btn" disabled={applySubmitting}>
                    {applySubmitting ? '신청하는 중...' : '재신청하기'}
                  </button>
                </form>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderWriteForm = () => (
    <form className="courses-manual-fields community-write-form" onSubmit={handleWriteSubmit}>
      <p className="courses-manual-hint">
        {editingPostId
          ? '수정하면 다시 관리자 승인을 받아야 목록에 노출돼요.'
          : '스터디·프로젝트 팀원을 구하는 글을 올려보세요. 관리자 승인 후 목록에 노출돼요.'}
      </p>
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
        <textarea rows={6} value={writeFields.body} onChange={(e) => setWriteFields((f) => ({ ...f, body: e.target.value }))} required />
      </div>
      <button type="submit" className="auth-submit-btn" disabled={writeSubmitting}>
        {writeSubmitting ? '저장하는 중...' : editingPostId ? '수정하기' : '등록하기'}
      </button>
      <button type="button" className="courses-manual-only-note courses-catalog-back" onClick={resetAfterWrite}>
        취소
      </button>
    </form>
  );

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={handleHeaderBack} aria-label={showWriteForm || selectedPost ? '목록으로' : '홈으로'}>
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
          renderDetail()
        ) : showWriteForm ? (
          renderWriteForm()
        ) : (
          <>
            {error && <p className="home-error">{error}</p>}

            <div className="courses-year-tabs">
              <button type="button" className={`courses-year-tab ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>
                전체 글
              </button>
              <button type="button" className={`courses-year-tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>
                내가 쓴 글
              </button>
              <button
                type="button"
                className={`courses-year-tab ${tab === 'applications' ? 'active' : ''}`}
                onClick={() => setTab('applications')}
              >
                내 신청
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
            ) : tab === 'mine' ? (
              myPosts.length === 0 ? (
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
              )
            ) : myApplications.length === 0 ? (
              <p className="courses-manual-hint">아직 신청한 글이 없어요.</p>
            ) : (
              <div className="courses-search-results community-post-list">
                {myApplications.map((a) => (
                  <button key={a.id} className="courses-search-result" onClick={() => openPost(a.postId)} disabled={detailLoading}>
                    <span className="courses-list-item-name">
                      {a.postTitle}
                      <span className={`community-badge community-badge-${a.status}`}>{APPLICATION_STATUS_LABEL[a.status]}</span>
                    </span>
                    <span className="courses-list-item-meta">
                      {a.author} · 신청일 {formatDate(a.createdAt)}
                    </span>
                    {a.contactEmail && <span className="community-row-contact">연락 이메일 · {a.contactEmail}</span>}
                  </button>
                ))}
              </div>
            )}

            {tab !== 'applications' && (
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
