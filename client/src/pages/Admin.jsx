import React, { useEffect, useRef, useState } from 'react';
import {
  getAdminCommunityPosts,
  approveAdminPost,
  rejectAdminPost,
  deleteAdminPost,
  getAdminReports,
  resolveAdminReport,
  sanctionReport,
  getAdminSanctions,
  liftSanction,
  getAdminInquiries,
  resolveAdminInquiry,
  getAdminStats,
  getReportedStudentSummary,
} from '../api/chatApi.js';
import AccountMenu from '../components/AccountMenu.jsx';
import { readCache, writeCache, clearCache } from '../utils/sessionCache.js';
import { IconChevronLeft, IconCheck, IconSiren, IconMessageCircle, IconUsers, IconBan, IconAlertTriangle } from '../components/icons.jsx';

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

const SUB_FILTER_LABEL = { pending: '대기중', approved: '승인됨', rejected: '반려됨' };
const CATEGORY_LABEL = { study: '스터디', project: '팀 활동·공모전' };
const SUB_FILTERS = ['pending', 'approved', 'rejected'];
const REPORT_SUB_FILTER_LABEL = { pending: '대기중', resolved: '처리완료' };
const REPORT_SUB_FILTERS = ['pending', 'resolved'];
const INQUIRY_SUB_FILTER_LABEL = { open: '대기중', resolved: '처리완료' };
const INQUIRY_SUB_FILTERS = ['open', 'resolved'];
const ADMIN_VIEWS = ['dashboard', 'approval', 'reports', 'inquiries', 'sanctions'];
// 제재 사유 입력란의 기본값. 신고자가 쓴 신고 사유를 그대로 채우면 그 말이 제재받는 사용자에게 "제재 사유"로 전달된다
// (사용자 화면의 제재 안내가 이 사유를 보여줌) — 신고자의 주장·비난·개인정보가 섞일 수 있고, 관리자가 확인한 사실도 아니다.
// 그래서 중립 고정 문구를 기본으로 두고 관리자가 필요하면 구체적으로 고쳐 쓴다. 신고 사유는 이 화면에서 참고용으로만 보인다.
const DEFAULT_SANCTION_REASON = '커뮤니티 운영 정책 위반';
// 신고자에게 보이는 처리 안내의 기본 문구 — 신고자의 "내 신고 내역"이 안내가 없을 때 보여주는 문구와 같다.
const DEFAULT_RESOLUTION_NOTE = '신고를 검토했고 커뮤니티 운영 정책에 따라 처리했어요. 신고해 주셔서 고마워요.';
const RESOLUTION_NOTE_MAX_LENGTH = 500;
const SANCTION_STATE_LABEL = { active: '적용 중', lifted: '해제됨', expired: '기간 종료' };
const VIEW_TITLE = { dashboard: '관리자', approval: '커뮤니티 승인', reports: '신고함', inquiries: '문의함', sanctions: '제재 관리' };
// 제재 팝업의 기간 선택지(#201) — 관리자가 매번 자유롭게 날짜를 정하면 기준이 들쭉날쭉해질
// 수 있어 프리셋으로 제한한다. permanent는 ends_at을 NULL로 저장(영구정지).
const SANCTION_DURATIONS = [
  { value: '1d', label: '1일' },
  { value: '3d', label: '3일' },
  { value: '7d', label: '7일' },
  { value: '30d', label: '30일' },
  { value: 'permanent', label: '영구정지' },
];
const SANCTION_SCOPES = [
  { value: 'post_apply', label: '경고성 (글쓰기·신청 금지)' },
  { value: 'full', label: '전면 정지 (커뮤니티 진입 차단)' },
];
const SANCTION_SCOPE_BADGE_LABEL = { post_apply: '경고성', full: '전면 정지' };

/**
 * Admin Page
 * 관리자 전용(이슈 #164 4단계) — 학생 홈 화면과 같은 구조(위: 현황 대시보드, 아래: 기능
 * 타일)로 진입해서, 타일을 누르면 커뮤니티 승인/신고함(#187)/문의함(#166)으로 들어간다.
 * 대시보드 통계(가입 이메일/현재 접속자/미처리 신고/미처리 문의)는 기존 GET /api/admin/stats
 * (+ totalStudents 추가)와 신고함/문의함이 이미 쓰던 목록 API를 그대로 재사용해서 뽑아낸
 * 값이라 새 스키마·집계 로직이 필요 없었다 — 대시보드 진입할 때마다 다시 불러온다.
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
 * - onOpenPost: function(postId) — 신고함 카드를 눌렀을 때 그 글의 커뮤니티 상세로 이동.
 */
function Admin({ user, onGoHome, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile, onOpenInquiry, onOpenPost }) {
  // 새로고침해도 보던 하위 화면(문의함 등)에 머문다 — App.jsx가 관리자 화면 자체를 복원하고, 이 값이 그 안의 탭을 복원한다.
  // 화면을 떠날 때(언마운트)는 지워서, 나중에 관리자 화면에 다시 들어오면 대시보드부터 시작한다(새로고침은 언마운트 정리가 안 돈다).
  const [adminView, setAdminView] = useState(() => {
    const saved = readCache('admin_view');
    return ADMIN_VIEWS.includes(saved) ? saved : 'dashboard';
  }); // 'dashboard' | 'approval' | 'reports' | 'inquiries' | 'sanctions'
  useEffect(() => {
    writeCache('admin_view', adminView);
  }, [adminView]);
  useEffect(() => () => clearCache('admin_view'), []);

  // App.jsx의 view 히스토리 관리와 같은 이유·같은 방식 — adminView 전환은 App.jsx 입장에서
  // view가 그대로 'admin'이라 히스토리에 전혀 안 쌓여서, 신고함/문의함 등 하위 화면에 있을 때
  // 모바일 뒤로가기를 누르면 대시보드를 거치지 않고 곧장 admin 진입 전 화면(홈)으로 나가버리는
  // 문제가 있었다(실사용 확인). App.jsx의 popstate 리스너와 같은 이벤트에 별도로 반응해서
  // adminView만 추가로 히스토리에 반영한다 — state를 덮어쓰지 않고 펼쳐써서 App.jsx가 쓰는
  // view 필드는 그대로 보존한다.
  const skipHistoryPush = useRef(true);

  useEffect(() => {
    function handlePopState(event) {
      skipHistoryPush.current = true;
      setAdminView(event.state?.adminView || 'dashboard');
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (skipHistoryPush.current) {
      window.history.replaceState({ ...window.history.state, adminView }, '');
      skipHistoryPush.current = false;
      return;
    }
    window.history.pushState({ ...window.history.state, adminView }, '');
  }, [adminView]);
  const [dashboardStats, setDashboardStats] = useState(null); // { totalStudents, activeSessions, pendingReports, pendingInquiries }
  const [dashboardLoading, setDashboardLoading] = useState(true);
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

  const [sanctions, setSanctions] = useState([]);
  const [sanctionsLoading, setSanctionsLoading] = useState(true);
  const [sanctionActionId, setSanctionActionId] = useState(null); // 조기 해제 처리 중인 제재 id

  // 신고함 "제재" 팝업 — 대상 신고를 들고 있으면 열림, null이면 닫힘.
  const [sanctionTargetReport, setSanctionTargetReport] = useState(null);
  const [sanctionScope, setSanctionScope] = useState('post_apply');
  const [sanctionDuration, setSanctionDuration] = useState('7d');
  const [sanctionReason, setSanctionReason] = useState('');
  const [sanctionSubmitting, setSanctionSubmitting] = useState(false);
  // 신고자에게 보이는 처리 안내(제재 사유와 별개). 반려 팝업과 제재 팝업이 같은 입력 상태를 쓴다(한 번에 하나만 열림).
  const [resolutionNote, setResolutionNote] = useState(DEFAULT_RESOLUTION_NOTE);
  const [resolveTargetReport, setResolveTargetReport] = useState(null);

  // 신고 대상자 요약 팝업 — report를 들고 있으면 열림. 읽기 전용(제재·삭제 같은 조치는 이 팝업에서 하지 않는다).
  const [studentSummaryReport, setStudentSummaryReport] = useState(null);
  const [studentSummary, setStudentSummary] = useState(null);
  const [studentSummaryLoading, setStudentSummaryLoading] = useState(false);
  const [studentSummaryError, setStudentSummaryError] = useState(null);

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  // 대시보드 진입할 때마다 새로 불러온다 — 신고함/문의함에서 처리하고 돌아왔을 때 그
  // 숫자가 그대로 남아있으면(특히 미처리 건수) 실제로 처리됐는지 헷갈리게 된다.
  useEffect(() => {
    if (adminView !== 'dashboard') return;
    setDashboardLoading(true);
    setError(null);
    Promise.all([getAdminStats(), getAdminReports('pending'), getAdminInquiries('open')])
      .then(([stats, pendingReports, pendingInquiries]) => {
        setDashboardStats({
          totalStudents: stats.totalStudents,
          activeSessions: stats.activeSessions,
          pendingReports: pendingReports.length,
          pendingInquiries: pendingInquiries.length,
        });
      })
      .catch(() => setError('현황을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'))
      .finally(() => setDashboardLoading(false));
  }, [adminView]);

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

  useEffect(() => {
    if (adminView !== 'sanctions') return;
    setSanctionsLoading(true);
    setError(null);
    getAdminSanctions()
      .then(setSanctions)
      .catch(() => setError('제재 목록을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'))
      .finally(() => setSanctionsLoading(false));
  }, [adminView]);

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

  // "반려"(조치 없이 처리완료) — 신고자에게 보낼 처리 안내를 적는 팝업을 먼저 연다.
  const openResolveModal = (report) => {
    setResolveTargetReport(report);
    setResolutionNote(DEFAULT_RESOLUTION_NOTE);
  };

  const closeResolveModal = () => setResolveTargetReport(null);

  const handleResolveReport = async () => {
    if (!resolveTargetReport) return;
    const id = resolveTargetReport.id;
    setReportActionId(id);
    setError(null);
    try {
      await resolveAdminReport(id, resolutionNote.trim() || null);
      setReports((prev) => prev.filter((r) => r.id !== id));
      showToast('처리완료로 표시했어요.');
      closeResolveModal();
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

  // 신고 카드를 누르면 그 글로 이동 — 신청 신고는 신청 자체를 볼 수 있는 화면이 따로
  // 없어서(작성자 전용), 그 신청이 달린 글로 대신 이동한다(targetPostId가 두 경우 다 처리).
  // 원본이 이미 삭제됐으면(targetExists === false) 이동할 곳이 없으니 무시.
  const handleGoToReportedPost = (report) => {
    if (!report.targetExists) return;
    onOpenPost(report.targetPostId);
  };

  const openSanctionModal = (report) => {
    setSanctionTargetReport(report);
    setSanctionScope('post_apply');
    setSanctionDuration('7d');
    setSanctionReason(DEFAULT_SANCTION_REASON);
    setResolutionNote(DEFAULT_RESOLUTION_NOTE);
  };

  const openStudentSummary = (report) => {
    setStudentSummaryReport(report);
    setStudentSummary(null);
    setStudentSummaryError(null);
    setStudentSummaryLoading(true);
    getReportedStudentSummary(report.reportedStudentId)
      .then(setStudentSummary)
      .catch(() => setStudentSummaryError('대상자 정보를 불러오지 못했어요. 이미 탈퇴한 계정일 수 있어요.'))
      .finally(() => setStudentSummaryLoading(false));
  };

  const closeStudentSummary = () => setStudentSummaryReport(null);

  const closeSanctionModal = () => setSanctionTargetReport(null);

  // "제재" 확정 — 계정 정지 + 신고된 글/신청 실제 삭제 + 신고 처리완료를 서버가 한 번에
  // 처리한다(server/routes/admin.js). 셋을 따로따로 호출하면 중간에 실패했을 때 "정지는
  // 걸렸는데 글은 안 지워짐" 같은 어중간한 상태가 생길 수 있어 단일 요청으로 묶었다.
  const handleConfirmSanction = async () => {
    if (!sanctionTargetReport || !sanctionReason.trim()) return;
    setSanctionSubmitting(true);
    setError(null);
    try {
      await sanctionReport(sanctionTargetReport.id, {
        scope: sanctionScope,
        duration: sanctionDuration,
        reason: sanctionReason.trim(),
        resolutionNote: resolutionNote.trim() || null,
      });
      setReports((prev) => prev.filter((r) => r.id !== sanctionTargetReport.id));
      showToast('제재를 적용했어요.');
      closeSanctionModal();
    } catch {
      setError('제재를 적용하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSanctionSubmitting(false);
    }
  };

  const handleLiftSanction = async (id) => {
    setSanctionActionId(id);
    setError(null);
    try {
      await liftSanction(id);
      setSanctions((prev) => prev.filter((s) => s.id !== id));
      showToast('제재를 해제했어요.');
    } catch {
      setError('해제하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSanctionActionId(null);
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
                <div className={`admin-stat-value ${dashboardLoading ? 'placeholder' : ''}`}>
                  {dashboardLoading ? '—' : dashboardStats?.totalStudents ?? '—'}
                </div>
              </div>
              <div className="admin-stat-cell">
                <p className="admin-stat-label">현재 접속자</p>
                <div className={`admin-stat-value ${dashboardLoading ? 'placeholder' : ''}`}>
                  {dashboardLoading ? '—' : dashboardStats?.activeSessions ?? '—'}
                </div>
              </div>
              <div className="admin-stat-cell">
                <p className="admin-stat-label">미처리 신고</p>
                <div className={`admin-stat-value ${dashboardLoading ? 'placeholder' : ''}`}>
                  {dashboardLoading ? '—' : dashboardStats?.pendingReports ?? '—'}
                </div>
              </div>
              <div className="admin-stat-cell">
                <p className="admin-stat-label">미처리 문의</p>
                <div className={`admin-stat-value ${dashboardLoading ? 'placeholder' : ''}`}>
                  {dashboardLoading ? '—' : dashboardStats?.pendingInquiries ?? '—'}
                </div>
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
              <button type="button" className="admin-tile" onClick={() => setAdminView('sanctions')}>
                <IconBan size={22} />
                <span>제재 관리</span>
              </button>
              <button type="button" className="admin-tile" onClick={() => setAdminView('approval')}>
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
                  <div
                    className={`admin-post-card ${r.targetExists ? 'clickable' : ''}`}
                    key={r.id}
                    onClick={r.targetExists ? () => handleGoToReportedPost(r) : undefined}
                  >
                    <p className="admin-post-title">
                      {r.targetType === 'post' ? `글 신고 · ${r.targetTitle}` : `신청 신고 · ${r.targetTitle}`}
                    </p>
                    <p className="community-detail-meta">
                      신고자 {r.reporter} · {formatDate(r.createdAt)}
                    </p>
                    {r.reportedStudent && (
                      <p className="community-detail-meta" onClick={(e) => e.stopPropagation()}>
                        신고 대상 ·{' '}
                        {/* 서버가 reportedStudentId를 아직 안 내려주는 배포 순서(프론트 먼저)에서는 예전처럼 이름만 보인다. */}
                        {r.reportedStudentId ? (
                          <button type="button" className="admin-student-link" onClick={() => openStudentSummary(r)}>
                            {r.reportedStudent}
                          </button>
                        ) : (
                          <b>{r.reportedStudent}</b>
                        )}
                      </p>
                    )}
                    {r.targetType === 'application' && (
                      <p className="community-applicant-msg">
                        <b>신고된 메시지</b> · {r.targetBody}
                      </p>
                    )}
                    <p className="community-detail-body">
                      <b>신고 사유</b> · {r.reason}
                    </p>
                    {reportSubFilter === 'resolved' && r.resolutionNote && (
                      <p className="community-detail-body">
                        <b>신고자에게 보낸 안내</b> · {r.resolutionNote}
                      </p>
                    )}
                    {reportSubFilter === 'pending' && (
                      <div className="community-applicant-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="community-act-btn community-act-sanction"
                          onClick={() => openSanctionModal(r)}
                          disabled={reportActionId === r.id || !r.reportedStudent}
                          title={r.reportedStudent ? undefined : '대상 정보가 없는 구버전 신고예요. 반려만 가능해요.'}
                        >
                          제재
                        </button>
                        <button
                          type="button"
                          className="community-act-btn community-act-reject"
                          onClick={() => openResolveModal(r)}
                          disabled={reportActionId === r.id}
                        >
                          반려
                        </button>
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
        ) : adminView === 'sanctions' ? (
          <>
            <p className="community-section-label">현재 정지 중 ({sanctions.length}명)</p>
            {sanctionsLoading ? (
              <p className="courses-manual-hint">불러오는 중...</p>
            ) : sanctions.length === 0 ? (
              <p className="courses-manual-hint">지금 정지 중인 계정이 없어요.</p>
            ) : (
              <div className="admin-post-list">
                {sanctions.map((s) => (
                  <div className="admin-post-card" key={s.id}>
                    <p className="admin-post-title">
                      {s.student}
                      <span className={`community-badge ${s.scope === 'full' ? 'community-badge-rejected' : 'community-badge-pending'}`}>
                        {SANCTION_SCOPE_BADGE_LABEL[s.scope]}
                      </span>
                    </p>
                    <p className="community-detail-meta">
                      {formatDate(s.startsAt)} ~ {s.endsAt ? formatDate(s.endsAt) : '영구정지'}
                    </p>
                    <p className="community-detail-body">
                      <b>사유</b> · {s.reason}
                    </p>
                    <div className="community-applicant-actions">
                      <button
                        type="button"
                        className="community-outline-btn"
                        onClick={() => handleLiftSanction(s.id)}
                        disabled={sanctionActionId === s.id}
                      >
                        조기 해제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>

      {studentSummaryReport && (
        <div className="career-confirm-overlay" onClick={closeStudentSummary}>
          <div className="career-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <p className="admin-post-title">신고 대상자 정보</p>
            {studentSummaryLoading ? (
              <p className="courses-manual-hint">불러오는 중...</p>
            ) : studentSummaryError ? (
              <p className="home-error">{studentSummaryError}</p>
            ) : studentSummary ? (
              <>
                <p className="community-detail-meta">
                  <b>{studentSummary.nickname}</b> · {studentSummary.department || '학과 미등록'}
                  {studentSummary.admissionYear ? ` · ${studentSummary.admissionYear}학년도 입학` : ''}
                </p>
                <p className="community-detail-meta">
                  가입 {formatDate(studentSummary.joinedAt)} · 작성한 글 {studentSummary.postCount}개 · 낸 신청 {studentSummary.applicationCount}건
                </p>
                <p className="community-detail-body">
                  <b>신고 접수</b> · 총 {studentSummary.reportsReceived.total}건 (대기 {studentSummary.reportsReceived.pending}건 · 처리완료{' '}
                  {studentSummary.reportsReceived.resolved}건)
                </p>
                <p className="community-section-label">제재 이력 ({studentSummary.sanctions.length}건)</p>
                {studentSummary.sanctions.length === 0 ? (
                  <p className="courses-manual-hint">제재 이력이 없어요.</p>
                ) : (
                  <div className="admin-post-list">
                    {studentSummary.sanctions.map((s) => (
                      <div className="admin-post-card" key={s.id}>
                        <p className="admin-post-title">
                          {SANCTION_SCOPE_BADGE_LABEL[s.scope] || s.scope}
                          <span className={`community-badge ${s.state === 'active' ? 'community-badge-rejected' : 'community-badge-closed'}`}>
                            {SANCTION_STATE_LABEL[s.state]}
                          </span>
                        </p>
                        <p className="community-detail-meta">
                          {formatDate(s.startsAt)} ~ {s.endsAt ? formatDate(s.endsAt) : '영구정지'}
                          {s.liftedAt && ` · ${formatDate(s.liftedAt)} 해제`}
                        </p>
                        <p className="community-detail-body">
                          <b>사유</b> · {s.reason}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : null}
            <button type="button" className="community-outline-btn" onClick={closeStudentSummary}>
              닫기
            </button>
          </div>
        </div>
      )}

      {resolveTargetReport && (
        <div className="career-confirm-overlay" onClick={closeResolveModal}>
          <form
            className="career-confirm-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              handleResolveReport();
            }}
          >
            <p className="admin-post-title">신고 반려(조치 없이 처리완료)</p>
            <p className="community-detail-body">
              <b>신고 사유(참고용)</b> · {resolveTargetReport.reason}
            </p>
            <div className="auth-field">
              <label htmlFor="resolution-note">신고자에게 보낼 처리 안내 (신고자에게만 보여요)</label>
              <textarea
                id="resolution-note"
                rows={3}
                maxLength={RESOLUTION_NOTE_MAX_LENGTH}
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
              />
              <p className="courses-manual-hint">
                신고 대상자의 이름·학과 같은 개인 정보나 제재 내용은 쓰지 마세요. 비워 두면 기본 안내가 보여요.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button type="submit" className="community-close-btn" disabled={reportActionId === resolveTargetReport.id}>
                {reportActionId === resolveTargetReport.id ? '처리하는 중...' : '처리완료로 표시'}
              </button>
              <button type="button" className="community-outline-btn" onClick={closeResolveModal}>
                취소
              </button>
            </div>
          </form>
        </div>
      )}

      {sanctionTargetReport && (
        <div className="career-confirm-overlay" onClick={closeSanctionModal}>
          <form
            className="career-confirm-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              handleConfirmSanction();
            }}
          >
            <p className="admin-post-title">제재하기</p>
            <p className="community-detail-meta">
              대상 · <b>{sanctionTargetReport.reportedStudent}</b>
              {sanctionTargetReport.targetTitle && ` (글 "${sanctionTargetReport.targetTitle}")`}
            </p>

            <div className="admin-reject-reason" style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <IconAlertTriangle size={16} />
              <span>제재를 확정하면 신고된 글/신청도 함께 삭제되며, 되돌릴 수 없어요.</span>
            </div>

            <p className="community-detail-body">
              <b>신고 사유(참고용)</b> · {sanctionTargetReport.reason}
            </p>
            <p className="courses-manual-hint">신고 사유는 제재받는 사용자에게 전달되지 않아요. 아래 "제재 사유"만 사용자에게 보여요.</p>

            <p className="community-section-label">범위</p>
            <div className="admin-sub-tabs" style={{ flexWrap: 'wrap' }}>
              {SANCTION_SCOPES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={`admin-sub-tab ${sanctionScope === s.value ? 'active' : ''}`}
                  onClick={() => setSanctionScope(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <p className="community-section-label">기간</p>
            <div className="admin-sub-tabs" style={{ flexWrap: 'wrap' }}>
              {SANCTION_DURATIONS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  className={`admin-sub-tab ${sanctionDuration === d.value ? 'active' : ''}`}
                  onClick={() => setSanctionDuration(d.value)}
                >
                  {d.label}
                </button>
              ))}
            </div>

            <div className="auth-field">
              <label htmlFor="sanction-reason">제재 사유 (사용자에게 보여요)</label>
              <textarea id="sanction-reason" rows={2} value={sanctionReason} onChange={(e) => setSanctionReason(e.target.value)} required />
            </div>

            <div className="auth-field">
              <label htmlFor="resolution-note">신고자에게 보낼 처리 안내 (신고자에게만 보여요)</label>
              <textarea
                id="resolution-note"
                rows={3}
                maxLength={RESOLUTION_NOTE_MAX_LENGTH}
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
              />
              <p className="courses-manual-hint">
                신고 대상자의 이름·학과 같은 개인 정보나 제재 내용은 쓰지 마세요. 비워 두면 기본 안내가 보여요.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button type="submit" className="community-close-btn" disabled={sanctionSubmitting || !sanctionReason.trim()}>
                {sanctionSubmitting ? '적용하는 중...' : '제재 확정'}
              </button>
              <button type="button" className="community-outline-btn" onClick={closeSanctionModal}>
                취소
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default Admin;
