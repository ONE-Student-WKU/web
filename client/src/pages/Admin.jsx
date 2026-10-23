import React, { useCallback, useEffect, useRef, useState } from 'react';
import AccountMenu from '../components/AccountMenu.jsx';
import AdminDashboard from '../components/admin/AdminDashboard.jsx';
import AdminStats, { STATS_TABS } from '../components/admin/AdminStats.jsx';
import AdminReports from '../components/admin/AdminReports.jsx';
import AdminApproval from '../components/admin/AdminApproval.jsx';
import AdminInquiries from '../components/admin/AdminInquiries.jsx';
import AdminSanctions from '../components/admin/AdminSanctions.jsx';
import { TREND_METRICS, TREND_RANGES, DEFAULT_TREND_RANGE } from '../utils/adminTrendMetrics.js';
import { readCache, writeCache, clearCache } from '../utils/sessionCache.js';
import { IconChevronLeft, IconCheck } from '../components/icons.jsx';

// report·inquiry는 신고함·문의함의 상세(어느 것을 열었는지는 detail에 담는다).
const ADMIN_VIEWS = ['dashboard', 'stats', 'reports', 'report', 'approval', 'inquiries', 'inquiry', 'sanctions'];
const DETAIL_PARENT = { report: 'reports', inquiry: 'inquiries' };
const VIEW_TITLE = {
  dashboard: '관리자',
  stats: '통계',
  reports: '신고함',
  report: '신고 보기',
  approval: '커뮤니티 관리',
  inquiries: '문의함',
  inquiry: '문의 보기',
  sanctions: '제재 관리',
};

// 새로고침해도 남기고 관리자 화면을 떠나면(언마운트) 지우는 값 — 하위 화면, 통계 탭, 추이 지표·기간.
function useSessionState(key, isValid, fallback) {
  const [value, setValue] = useState(() => {
    const saved = readCache(key);
    return isValid(saved) ? saved : fallback;
  });
  useEffect(() => {
    writeCache(key, value);
  }, [key, value]);
  useEffect(() => () => clearCache(key), [key]);
  return [value, setValue];
}

/**
 * Admin Page
 * 관리자 전용(이슈 #164) — 첫 화면(처리할 일 → 이용 현황 → 최근 24시간 → 관리 메뉴)에서 신고함·문의함·커뮤니티 관리·제재 관리·통계로
 * 들어간다(2026-10-23 개편). 각 화면은 components/admin/에 있고, 이 파일은 머리글·화면 전환·뒤로가기 히스토리·알림만 맡는다.
 * AccountMenu.jsx가 user.role === 'admin'일 때만 이 화면 진입점을 보여준다. 실제 접근 제어는 서버(server/middleware/auth.js의
 * requireAdmin)가 매 요청마다 다시 하므로, admin이 아닌 사용자가 어쩌다 들어와도 API가 403을 낼 뿐 안전하다.
 *
 * Props:
 * - user, onGoHome, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile, onOpenInquiry
 * - onOpenPost: function(postId) — 신고된 글을 커뮤니티 상세로 연다.
 */
function Admin({ user, onGoHome, onLogout, onOpenSettings, onOpenOnboarding, onOpenProfile, onOpenInquiry, onOpenPost }) {
  // 새로고침해도 보던 하위 화면(문의함 등)에 머문다 — App.jsx가 관리자 화면 자체를 복원하고, 이 값이 그 안의 화면을 복원한다.
  // 상세(신고 보기·문의 보기)는 무엇을 열었는지가 새로고침 뒤에 남지 않아 그 목록으로 돌아간다.
  const [adminView, setAdminView] = useSessionState('admin_view', (v) => ADMIN_VIEWS.includes(v), 'dashboard');
  const [detail, setDetail] = useState(null);
  const [statsTab, setStatsTab] = useSessionState('admin_stats_tab', (v) => STATS_TABS.some((t) => t.key === v), 'trend');
  const [trendMetric, setTrendMetric] = useSessionState('admin_trend_metric', (v) => TREND_METRICS.some((m) => m.key === v), TREND_METRICS[0].key);
  const [trendRange, setTrendRange] = useSessionState('admin_trend_range', (v) => TREND_RANGES.some((r) => r.key === v), DEFAULT_TREND_RANGE);
  const shownView = DETAIL_PARENT[adminView] && detail === null ? DETAIL_PARENT[adminView] : adminView;

  // App.jsx의 view 히스토리 관리와 같은 이유·같은 방식 — 하위 화면 전환은 App.jsx 입장에서 view가 그대로 'admin'이라 히스토리에
  // 안 쌓여서, 모바일 뒤로가기가 첫 화면을 거치지 않고 곧장 홈으로 나가버린다. popstate에 따로 반응해 adminView·detail만 반영하고,
  // state를 펼쳐 써서 App.jsx가 쓰는 view 필드는 그대로 둔다.
  const skipHistoryPush = useRef(true);
  useEffect(() => {
    function handlePopState(event) {
      skipHistoryPush.current = true;
      setAdminView(event.state?.adminView || 'dashboard');
      setDetail(event.state?.adminDetail ?? null);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [setAdminView]);

  useEffect(() => {
    const state = { ...window.history.state, adminView, adminDetail: detail };
    if (skipHistoryPush.current) {
      window.history.replaceState(state, '');
      skipHistoryPush.current = false;
      return;
    }
    window.history.pushState(state, '');
  }, [adminView, detail]);

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const openView = (view, options = {}) => {
    if (view === 'stats') {
      if (options.tab) setStatsTab(options.tab);
      if (options.metric) setTrendMetric(options.metric);
      if (options.range) setTrendRange(options.range);
    }
    setDetail(null);
    setAdminView(view);
  };
  const openDetail = useCallback(
    (view) => (key) => {
      setDetail(key);
      setAdminView(view);
    },
    [setAdminView]
  );
  const closeDetail = useCallback(() => {
    setAdminView((v) => DETAIL_PARENT[v] || v);
    setDetail(null);
  }, [setAdminView]);

  // 상세에서는 목록으로, 하위 화면에서는 첫 화면으로, 첫 화면에서는 홈으로.
  const handleBack = () => {
    if (DETAIL_PARENT[shownView]) closeDetail();
    else if (shownView === 'dashboard') onGoHome();
    else openView('dashboard');
  };

  const flush = shownView !== 'dashboard';
  const reportsView = shownView === 'reports' || shownView === 'report';
  const inquiriesView = shownView === 'inquiries' || shownView === 'inquiry';

  return (
    <div className="courses-page admin-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={handleBack} aria-label={shownView === 'dashboard' ? '홈으로' : '뒤로'}>
            <IconChevronLeft />
          </button>
          <span className="screen-title">{VIEW_TITLE[shownView]}</span>
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

      <div className={flush ? 'courses-body admin-body-flush' : 'courses-body'}>
        {shownView === 'dashboard' ? (
          <AdminDashboard onOpen={openView} />
        ) : shownView === 'stats' ? (
          <AdminStats
            tab={statsTab}
            onChangeTab={setStatsTab}
            metric={trendMetric}
            onChangeMetric={setTrendMetric}
            range={trendRange}
            onChangeRange={setTrendRange}
          />
        ) : reportsView ? (
          <AdminReports
            detailKey={shownView === 'report' ? detail : null}
            onOpenDetail={openDetail('report')}
            onCloseDetail={closeDetail}
            onOpenPost={onOpenPost}
            showToast={showToast}
          />
        ) : inquiriesView ? (
          <AdminInquiries
            detailId={shownView === 'inquiry' ? detail : null}
            onOpenDetail={openDetail('inquiry')}
            onCloseDetail={closeDetail}
            showToast={showToast}
          />
        ) : shownView === 'approval' ? (
          <AdminApproval showToast={showToast} />
        ) : shownView === 'sanctions' ? (
          <AdminSanctions showToast={showToast} />
        ) : null}
      </div>
    </div>
  );
}

export default Admin;
