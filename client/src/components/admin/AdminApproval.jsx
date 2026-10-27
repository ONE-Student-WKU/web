import React, { useEffect, useState } from 'react';
import { getAdminCommunityPosts, approveAdminPost, rejectAdminPost, deleteAdminPost } from '../../api/chatApi.js';
import { refreshAdminPending } from '../../utils/adminPending.js';
import AdminTabs from './AdminTabs.jsx';
import { formatDate, CATEGORY_LABEL } from './adminFormat.js';
import { AiSuggestionBadge, HighlightedText } from './AiSuggestion.jsx';
import { IconMore } from '../icons.jsx';

const STATUS_TABS = [
  { key: 'pending', label: '승인 대기' },
  { key: 'approved', label: '승인됨' },
  { key: 'rejected', label: '반려됨' },
];
const STATUS_STYLE = { pending: ['wait', '승인 대기'], approved: ['ok', '승인됨'], rejected: ['no', '반려됨'] };

/**
 * AdminApproval
 * 관리자 "커뮤니티 관리" — 승인 대기·승인됨·반려됨 글. 글마다 학생 상세 화면과 같은 칸(종류·인원·모집 학과·마감)을 보여주고,
 * 반려 사유 칸은 "반려"를 눌렀을 때만 펼친다. 삭제는 ⋯ 메뉴에 둔다(승인·반려와 같은 크기로 나란히 두지 않는다).
 *
 * Props:
 * - showToast(message)
 */
function AdminApproval({ showToast }) {
  const [status, setStatus] = useState('pending');
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);
  const [actionId, setActionId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [menuId, setMenuId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setPosts(null);
    setError(null);
    setRejectingId(null);
    getAdminCommunityPosts(status)
      .then((list) => !cancelled && setPosts(list))
      .catch(() => !cancelled && setError('목록을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'));
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (menuId === null) return undefined;
    const close = () => setMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuId]);

  const removeFromList = (id) => setPosts((prev) => prev.filter((p) => p.id !== id));

  const handleDecide = async (id, action) => {
    setActionId(id);
    setError(null);
    try {
      if (action === 'approve') await approveAdminPost(id);
      else await rejectAdminPost(id, rejectReason.trim() || undefined);
      removeFromList(id);
      setRejectingId(null);
      showToast(action === 'approve' ? '승인했어요.' : '반려했어요.');
      refreshAdminPending();
    } catch {
      setError('처리하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (id) => {
    setMenuId(null);
    if (!window.confirm('이 글을 완전히 삭제할까요? 신청 내역도 함께 삭제되고 되돌릴 수 없어요.')) return;
    setActionId(id);
    setError(null);
    try {
      await deleteAdminPost(id);
      removeFromList(id);
      showToast('삭제했어요.');
      refreshAdminPending();
    } catch {
      setError('삭제하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setActionId(null);
    }
  };

  return (
    <>
      <AdminTabs
        tabs={STATUS_TABS.map((t) => ({ ...t, count: t.key === 'pending' && status === 'pending' ? posts?.length : null }))}
        active={status}
        onChange={setStatus}
        label="글 상태"
      />
      <div className="admin-pad">
        {error && <p className="home-error">{error}</p>}
        {!posts ? (
          <p className="courses-manual-hint">불러오는 중...</p>
        ) : posts.length === 0 ? (
          <p className="courses-manual-hint">{status === 'pending' ? '승인을 기다리는 글이 없어요.' : `${STATUS_STYLE[status][1]} 글이 없어요.`}</p>
        ) : (
          posts.map((p) => {
            const [tone, label] = STATUS_STYLE[status];
            const rejecting = rejectingId === p.id;
            return (
              <article className="admin-post" key={p.id}>
                <div className="admin-row-top">
                  <span className={`post-status post-status--${tone}`}>{label}</span>
                  <span className="post-meta">
                    {p.author} · {formatDate(p.createdAt)}
                  </span>
                  {status === 'pending' && <AiSuggestionBadge suggestion={p.aiSuggestion} />}
                  <div className="admin-more" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="admin-more-btn" aria-label="더 보기" aria-expanded={menuId === p.id} onClick={() => setMenuId(menuId === p.id ? null : p.id)}>
                      <IconMore size={18} />
                    </button>
                    {menuId === p.id && (
                      <div className="account-menu-dropdown" role="menu">
                        <button type="button" role="menuitem" className="account-menu-item danger" onClick={() => handleDelete(p.id)} disabled={actionId === p.id}>
                          글 삭제
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <p className="post-title admin-post-heading">{p.title}</p>
                <p className="admin-body">
                  <HighlightedText text={p.body} highlights={status === 'pending' ? p.aiSuggestion?.highlights : []} />
                </p>
                <dl className="admin-facts">
                  <div>
                    <dt>종류</dt>
                    <dd>{CATEGORY_LABEL[p.category] || p.category}</dd>
                  </div>
                  <div>
                    <dt>모집 인원</dt>
                    <dd>{p.capacity ? `${p.capacity}명` : '정하지 않음'}</dd>
                  </div>
                  {p.targetDepartments && (
                    <div>
                      <dt>모집 학과</dt>
                      <dd>{p.targetDepartments.length ? p.targetDepartments.map((d) => d.name).join(', ') : '모든 학과'}</dd>
                    </div>
                  )}
                  {p.recruitEndDate !== undefined && (
                    <div>
                      <dt>마감</dt>
                      <dd>{p.recruitEndDate ? p.recruitEndDate.replace(/-/g, '.') : '없음'}</dd>
                    </div>
                  )}
                </dl>
                {status === 'rejected' && p.rejectReason && (
                  <p className="admin-body admin-note-line">
                    <b>반려 사유</b> · {p.rejectReason}
                  </p>
                )}
                {status === 'pending' &&
                  (rejecting ? (
                    <div className="admin-reject">
                      <label className="admin-section first" htmlFor={`reject-${p.id}`}>
                        반려 사유 <small>글쓴이에게 보여요 · 비워도 돼요</small>
                      </label>
                      <textarea
                        id={`reject-${p.id}`}
                        className="post-input admin-textarea"
                        rows={2}
                        maxLength={500}
                        value={rejectReason}
                        placeholder="예: 오픈카톡 링크 대신 신청 기능을 써주세요"
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <div className="admin-actions">
                        <button type="button" className="post-btn post-btn--text" onClick={() => setRejectingId(null)}>
                          취소
                        </button>
                        <button type="button" className="post-btn post-btn--ink" onClick={() => handleDecide(p.id, 'reject')} disabled={actionId === p.id}>
                          반려하기
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="admin-actions">
                      <button
                        type="button"
                        className="post-btn post-btn--outline"
                        onClick={() => {
                          setRejectingId(p.id);
                          setRejectReason('');
                        }}
                        disabled={actionId === p.id}
                      >
                        반려
                      </button>
                      <button type="button" className="post-btn post-btn--ink" onClick={() => handleDecide(p.id, 'approve')} disabled={actionId === p.id}>
                        승인
                      </button>
                    </div>
                  ))}
              </article>
            );
          })
        )}
      </div>
    </>
  );
}

export default AdminApproval;
