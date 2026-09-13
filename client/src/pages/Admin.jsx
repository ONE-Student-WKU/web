import React, { useEffect, useRef, useState } from 'react';
import {
  getAdminCommunityPosts,
  approveAdminPost,
  rejectAdminPost,
  deleteAdminPost,
  deleteAdminApplication,
  getAdminReports,
  resolveAdminReport,
  getAdminInquiries,
  resolveAdminInquiry,
} from '../api/chatApi.js';
import AccountMenu from '../components/AccountMenu.jsx';
import { IconChevronLeft, IconCheck, IconSiren, IconMessageCircle, IconUsers } from '../components/icons.jsx';

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

const SUB_FILTER_LABEL = { pending: '대기중', approved: '승인됨', rejected: '반려됨' };
const CATEGORY_LABEL = { study: '스터디', project: '프로젝트' };
const SUB_FILTERS = ['pending', 'approved', 'rejected'];
const REPORT_SUB_FILTER_LABEL = { pending: '대기중', resolved: '처리완료' };
const REPORT_SUB_FILTERS = ['pending', 'resolved'];
const INQUIRY_SUB_FILTER_LABEL = { open: '대기중', resolved: '처리완료' };
const INQUIRY_SUB_FILTERS = ['open', 'resolved'];
const VIEW_TITLE = { dashboard: '관리자', approval: '커뮤니티 승인', reports: '신고함', inquiries: '문의함' };

/**
 * Admin Page
 * 관리자 전용(이슈 #164 4단계) — 학생 홈 화면과 같은 구조(위: 현황 대시보드, 아래: 기능
 * 타일)로 진입해서, 타일을 누르면 커뮤니티 승인/신고함(#187)/문의함(#166)으로 들어간다.
 * 대시보드 통계 카드는 지금은 자리만 잡아둔 상태(값 표시 없음) — 가입자 수/미처리
 * 건수/현재 접속자 수를 집계하는 API가 아직 없어서, 그건 후속 작업으로 남겨둔다.
 * AccountMenu.jsx가 user.role === 'admin'일 때만 이 화면 진입점을 보여준다.
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
 * - onOpenInquiry: function
 */
function Admin({ user, onGoHome, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile, onOpenInquiry }) {
  const [adminView, setAdminView] = useState('dashboard'); // 'dashboard' | 'approval' | 'reports' | 'inquiries'
  const [subFilter, setSubFilter] = useState('pending');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionId, setActionId] = useState(null); // 승인/반려/삭제 처리 중인 글 id
  // 반려 사유(선택) 입력값 — 글 id별로 따로 들고 있어야 여러 대기중 카드가 서로 안 섞인다.
  const [rejectReasons, setRejectReasons] = useState({});

  const [reportSubFilter, setReportSubFilter] = useState('pending');
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportActionId, setReportActionId] = useState(null); // 처리완료/대상삭제 처리 중인 신고 id

  const [inquirySubFilter, setInquirySubFilter] = useState('open');
  const [inquiries, setInquiries] = useState([]);
  const [inquiriesLoading, setInquiriesLoading] = useState(true);
  const [inquiryActionId, setInquiryActionId] = useState(null); // 처리완료 처리 중인 문의 id

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  useEffect(() => {
    if (adminView !== 'approval') return;
    setLoading(true);
    setError(null);
    getAdminCommunityPosts(subFilter)
      .then(setPosts)
      .catch(() => setError('목록을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'))
      .finally(() => setLoading(false));
  }, [adminView, subFilter]);

  useEffect(() => {
    if (adminView !== 'reports') return;
    setReportsLoading(true);
    setError(null);
    getAdminReports(reportSubFilter)
      .then(setReports)
      .catch(() => setError('신고 목록을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'))
      .finally(() => setReportsLoading(false));
  }, [adminView, reportSubFilter]);

  useEffect(() => {
    if (adminView !== 'inquiries') return;
    setInquiriesLoading(true);
    setError(null);
    getAdminInquiries(inquirySubFilter)
      .then(setInquiries)
      .catch(() => setError('문의 목록을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'))
      .finally(() => setInquiriesLoading(false));
  }, [adminView, inquirySubFilter]);

  // 대시보드 → 타일 클릭 시 해당 화면으로, 그 화면에서 뒤로가기를 누르면 다시
  // 대시보드로 돌아간다(대시보드에서 뒤로가기를 누르면 그때 홈으로 나간다).
  const handleBack = () => {
    if (adminView === 'dashboard') onGoHome();
    else setAdminView('dashboard');
  };

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

  const handleResolveReport = async (id) => {
    setReportActionId(id);
    setError(null);
    try {
      await resolveAdminReport(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
      showToast('처리완료로 표시했어요.');
    } catch {
      setError('처리하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setReportActionId(null);
    }
  };

  const handleResolveInquiry = async (id) => {
    setInquiryActionId(id);
    setError(null);
    try {
      await resolveAdminInquiry(id);
      setInquiries((prev) => prev.filter((i) => i.id !== id));
      showToast('처리완료로 표시했어요.');
    } catch {
      setError('처리하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setInquiryActionId(null);
    }
  };

  // 신고된 대상(글/신청)을 삭제하고, 신고 자체도 같이 처리완료로 넘긴다 — 조치를 했는데
  // 신고함에 그대로 남아있으면 관리자가 또 확인해야 하는 번거로움이 생긴다.
  const handleDeleteReportTarget = async (report) => {
    if (!report.target) return;
    if (!window.confirm('신고된 대상을 완전히 삭제할까요? 되돌릴 수 없어요.')) return;
    setReportActionId(report.id);
    setError(null);
    try {
      if (report.target.type === 'post') await deleteAdminPost(report.target.id);
      else await deleteAdminApplication(report.target.id);
      await resolveAdminReport(report.id);
      setReports((prev) => prev.filter((r) => r.id !== report.id));
      showToast('삭제하고 처리완료로 표시했어요.');
    } catch {
      setError('삭제하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setReportActionId(null);
    }
  };

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={handleBack} aria-label={adminView === 'dashboard' ? '홈으로' : '뒤로'}>
            <IconChevronLeft />
          </button>
          <span className="screen-title">{VIEW_TITLE[adminView]}</span>
        </div>
        <AccountMenu
          user={user}
          onLogout={onLogout}
          onOpenSettings={onOpenSettings}
          onOpenOnboarding={onOpenOnboarding}
          onOpenProfile={onOpenProfile}
          onOpenInquiry={onOpenInquiry}
        />
      </header>

      {toast && (
        <div className="import-toast">
          <IconCheck size={13} />
          <span>{toast}</span>
        </div>
      )}

      <div className="courses-body">
        {error && <p className="home-error">{error}</p>}

        {adminView === 'dashboard' ? (
          <>
            <p className="home-quick-label">현황</p>
            <div className="admin-dashboard-stats">
              <div className="admin-stat-cell">
                <p className="admin-stat-label">가입 이메일</p>
                <div className="admin-stat-value placeholder">—</div>
              </div>
              <div className="admin-stat-cell">
                <p className="admin-stat-label">현재 접속자</p>
                <div className="admin-stat-value placeholder">—</div>
              </div>
              <div className="admin-stat-cell">
                <p className="admin-stat-label">미처리 신고</p>
                <div className="admin-stat-value placeholder">—</div>
              </div>
              <div className="admin-stat-cell">
                <p className="admin-stat-label">미처리 문의</p>
                <div className="admin-stat-value placeholder">—</div>
              </div>
            </div>

            <p className="home-quick-label">메뉴</p>
            <div className="admin-tiles">
              <button type="button" className="admin-tile" onClick={() => setAdminView('reports')}>
                <IconSiren size={22} />
                <span>신고함</span>
              </button>
              <button type="button" className="admin-tile" onClick={() => setAdminView('inquiries')}>
                <IconMessageCircle size={22} />
                <span>문의함</span>
              </button>
              <button type="button" className="admin-tile wide" onClick={() => setAdminView('approval')}>
                <IconUsers size={22} />
                <span>커뮤니티 관리</span>
              </button>
            </div>
          </>
        ) : adminView === 'approval' ? (
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
        ) : adminView === 'reports' ? (
          <>
            <div className="admin-sub-tabs">
              {REPORT_SUB_FILTERS.map((f) => (
                <button key={f} type="button" className={`admin-sub-tab ${reportSubFilter === f ? 'active' : ''}`} onClick={() => setReportSubFilter(f)}>
                  {REPORT_SUB_FILTER_LABEL[f]}
                </button>
              ))}
            </div>

            {reportsLoading ? (
              <p className="courses-manual-hint">불러오는 중...</p>
            ) : reports.length === 0 ? (
              <p className="courses-manual-hint">{REPORT_SUB_FILTER_LABEL[reportSubFilter]} 신고가 없어요.</p>
            ) : (
              <div className="admin-post-list">
                {reports.map((r) => (
                  <div className="admin-post-card" key={r.id}>
                    <p className="admin-post-title">
                      {r.target
                        ? r.target.type === 'post'
                          ? `글 신고 · ${r.target.title}`
                          : `신청 신고 · ${r.target.postTitle}`
                        : '대상이 삭제된 신고'}
                    </p>
                    <p className="community-detail-meta">
                      신고자 {r.reporter} · {formatDate(r.createdAt)}
                    </p>
                    <p className="community-detail-body">
                      <b>신고 사유</b> · {r.reason}
                    </p>
                    {r.target?.type === 'application' && (
                      <p className="community-applicant-msg">
                        <b>신고된 메시지</b> · {r.target.message}
                      </p>
                    )}
                    {reportSubFilter === 'pending' && (
                      <div className="community-applicant-actions">
                        <button
                          type="button"
                          className="community-act-btn community-act-accept"
                          onClick={() => handleResolveReport(r.id)}
                          disabled={reportActionId === r.id}
                        >
                          처리완료
                        </button>
                        {r.target && (
                          <button
                            type="button"
                            className="community-outline-btn community-danger"
                            onClick={() => handleDeleteReportTarget(r)}
                            disabled={reportActionId === r.id}
                          >
                            대상 삭제
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : adminView === 'inquiries' ? (
          <>
            <div className="admin-sub-tabs">
              {INQUIRY_SUB_FILTERS.map((f) => (
                <button key={f} type="button" className={`admin-sub-tab ${inquirySubFilter === f ? 'active' : ''}`} onClick={() => setInquirySubFilter(f)}>
                  {INQUIRY_SUB_FILTER_LABEL[f]}
                </button>
              ))}
            </div>

            {inquiriesLoading ? (
              <p className="courses-manual-hint">불러오는 중...</p>
            ) : inquiries.length === 0 ? (
              <p className="courses-manual-hint">{INQUIRY_SUB_FILTER_LABEL[inquirySubFilter]} 문의가 없어요.</p>
            ) : (
              <div className="admin-post-list">
                {inquiries.map((i) => (
                  <div className="admin-post-card" key={i.id}>
                    <p className="admin-post-title">{i.title}</p>
                    <p className="community-detail-meta">
                      {i.student} · {formatDate(i.createdAt)}
                    </p>
                    <p className="community-detail-body">{i.content}</p>
                    {inquirySubFilter === 'open' && (
                      <div className="community-applicant-actions">
                        <button
                          type="button"
                          className="community-act-btn community-act-accept"
                          onClick={() => handleResolveInquiry(i.id)}
                          disabled={inquiryActionId === i.id}
                        >
                          처리완료
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default Admin;
