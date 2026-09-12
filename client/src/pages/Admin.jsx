import React, { useEffect, useRef, useState } from 'react';
import {
  getAdminCommunityPosts,
  approveAdminPost,
  rejectAdminPost,
  deleteAdminPost,
  getAdminStats,
} from '../api/chatApi.js';
import AccountMenu from '../components/AccountMenu.jsx';
import { IconChevronLeft, IconCheck } from '../components/icons.jsx';

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

const SUB_FILTER_LABEL = { pending: '대기중', approved: '승인됨', rejected: '반려됨' };
const CATEGORY_LABEL = { study: '스터디', project: '프로젝트' };
const SUB_FILTERS = ['pending', 'approved', 'rejected'];

/**
 * Admin Page
 * 관리자 전용(이슈 #164 4단계) — 지금은 커뮤니티 승인/통계 2개 탭만. 신고함/문의함은
 * 후속 이슈. AccountMenu.jsx가 user.role === 'admin'일 때만 이 화면 진입점을 보여준다.
 * 실제 접근 제어는 서버(server/middleware/auth.js의 requireAdmin)가 매 요청마다 다시
 * 하므로, 여기서는 admin이 아닌 사용자가 어쩌다 들어와도 API가 403을 낼 뿐 안전하다.
 *
 * 캐시(모듈 스코프)를 안 둔 이유: 관리자만 드나드는 화면이라 재진입 깜빡임 방지의 가치가
 * 낮고, 승인 대기열은 오히려 매번 최신 상태를 보는 게 더 중요하다.
 *
 * Props:
 * - user: object
 * - onGoHome: function
 * - onLogout: function
 * - onOpenSettings: function
 * - onOpenOnboarding: function
 * - onOpenProfile: function
 */
function Admin({ user, onGoHome, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile }) {
  const [mainTab, setMainTab] = useState('approval'); // 'approval' | 'stats'
  const [subFilter, setSubFilter] = useState('pending');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionId, setActionId] = useState(null); // 승인/반려/삭제 처리 중인 글 id
  // 반려 사유(선택) 입력값 — 글 id별로 따로 들고 있어야 여러 대기중 카드가 서로 안 섞인다.
  const [rejectReasons, setRejectReasons] = useState({});

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  useEffect(() => {
    if (mainTab !== 'approval') return;
    setLoading(true);
    setError(null);
    getAdminCommunityPosts(subFilter)
      .then(setPosts)
      .catch(() => setError('목록을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'))
      .finally(() => setLoading(false));
  }, [mainTab, subFilter]);

  const loadStats = () => {
    setStatsLoading(true);
    setError(null);
    getAdminStats()
      .then((data) => setStats(data))
      .catch(() => setError('통계를 불러오지 못했어요.'))
      .finally(() => setStatsLoading(false));
  };

  useEffect(() => {
    if (mainTab === 'stats' && stats === null) loadStats();
  }, [mainTab]); // eslint-disable-line react-hooks/exhaustive-deps -- stats를 deps에 넣으면 새로고침마다 다시 도는 루프가 됨, mainTab 진입 시 1회만 자동 로드하면 충분

  const handleDecide = async (id, action) => {
    setActionId(id);
    setError(null);
    try {
      if (action === 'approve') await approveAdminPost(id);
      else await rejectAdminPost(id, rejectReasons[id]);
      setPosts((prev) => prev.filter((p) => p.id !== id));
      setRejectReasons((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      showToast(action === 'approve' ? '승인했어요.' : '반려했어요.');
    } catch {
      setError('처리하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('이 글을 완전히 삭제할까요? 신청 내역도 함께 삭제되고 되돌릴 수 없어요.')) return;
    setActionId(id);
    setError(null);
    try {
      await deleteAdminPost(id);
      setPosts((prev) => prev.filter((p) => p.id !== id));
      showToast('삭제했어요.');
    } catch {
      setError('삭제하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onGoHome} aria-label="홈으로">
            <IconChevronLeft />
          </button>
          <span className="screen-title">관리자</span>
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
        <div className="courses-year-tabs">
          <button type="button" className={`courses-year-tab ${mainTab === 'approval' ? 'active' : ''}`} onClick={() => setMainTab('approval')}>
            커뮤니티 승인
          </button>
          <button type="button" className={`courses-year-tab ${mainTab === 'stats' ? 'active' : ''}`} onClick={() => setMainTab('stats')}>
            통계
          </button>
        </div>

        {error && <p className="home-error">{error}</p>}

        {mainTab === 'approval' ? (
          <>
            <div className="admin-sub-tabs">
              {SUB_FILTERS.map((f) => (
                <button key={f} type="button" className={`admin-sub-tab ${subFilter === f ? 'active' : ''}`} onClick={() => setSubFilter(f)}>
                  {SUB_FILTER_LABEL[f]}
                </button>
              ))}
            </div>

            {loading ? (
              <p className="courses-manual-hint">불러오는 중...</p>
            ) : posts.length === 0 ? (
              <p className="courses-manual-hint">{SUB_FILTER_LABEL[subFilter]} 글이 없어요.</p>
            ) : (
              <div className="admin-post-list">
                {posts.map((p) => (
                  <div className="admin-post-card" key={p.id}>
                    <p className="admin-post-title">{p.title}</p>
                    <p className="community-detail-meta">
                      {p.author} · {formatDate(p.createdAt)}
                      <span className={`community-badge community-badge-${p.category}`}>{CATEGORY_LABEL[p.category]}</span>
                      {p.capacity && <span className="community-badge community-badge-capacity">모집인원 {p.capacity}명</span>}
                    </p>
                    <p className="community-detail-body">{p.body}</p>
                    {subFilter === 'rejected' && p.rejectReason && (
                      <p className="admin-reject-reason">
                        <b>반려 사유</b> · {p.rejectReason}
                      </p>
                    )}
                    {subFilter === 'pending' && (
                      <textarea
                        className="admin-reject-reason-input"
                        rows={2}
                        placeholder="반려 사유(선택) — 반려할 때만 사용돼요."
                        value={rejectReasons[p.id] || ''}
                        onChange={(e) => setRejectReasons((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      />
                    )}
                    <div className="community-applicant-actions">
                      {subFilter === 'pending' && (
                        <>
                          <button
                            type="button"
                            className="community-act-btn community-act-accept"
                            onClick={() => handleDecide(p.id, 'approve')}
                            disabled={actionId === p.id}
                          >
                            승인
                          </button>
                          <button
                            type="button"
                            className="community-act-btn community-act-reject"
                            onClick={() => handleDecide(p.id, 'reject')}
                            disabled={actionId === p.id}
                          >
                            반려
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="community-outline-btn community-danger"
                        onClick={() => handleDelete(p.id)}
                        disabled={actionId === p.id}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="home-card">
            <p className="home-card-label">현재 활성 세션</p>
            <div className="admin-stat-value">{statsLoading ? '-' : (stats?.activeSessions ?? '-')}개</div>
            <p className="admin-stat-desc">
              로그인 상태가 유지 중인 세션 수예요(만료되지 않은 세션 기준). 실제 동시 접속자 수와는 다를 수 있어요.
            </p>
            <button type="button" className="community-outline-btn" onClick={loadStats} disabled={statsLoading}>
              {statsLoading ? '불러오는 중...' : '새로고침'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Admin;
