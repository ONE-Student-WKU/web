import React, { useEffect, useState } from 'react';
import { getAdminStats } from '../../api/chatApi.js';
import { IconSiren, IconMessageCircle, IconUsers, IconBan, IconBarChart, IconCheck, IconChevronRight } from '../icons.jsx';

// 지난주(8~14일 전) 방문자 중 이번 주(최근 7일)에도 온 비율. 방문 기록이 2주가 안 돼 지난주 방문자가 없으면 "—".
function returnRate(weekly) {
  if (!weekly || !weekly.previous) return '—';
  return `${Math.round((weekly.returned / weekly.previous) * 100)}%`;
}

function returnNote(weekly) {
  if (!weekly) return null;
  return weekly.previous ? `지난주 ${weekly.previous}명 중 ${weekly.returned}명` : '방문 기록이 2주 쌓이면 보여요';
}

// "지난주보다 N명 많아요" — 방문 기록이 지난주(13일 전)부터 있을 때만. 그 전에는 지난주 숫자가 일부만 세져 비교가 틀린다.
function weekCompare(stats) {
  const since = stats?.last14d?.since;
  const daily = stats?.last14d?.daily;
  if (!since || !daily?.length || since > daily[0].at) return null;
  const diff = stats.last7d.visitors - stats.last7d.previousVisitors;
  if (diff === 0) return { text: '지난주와 같아요', tone: '' };
  return { text: `지난주보다 ${Math.abs(diff).toLocaleString()}명 ${diff > 0 ? '많아요' : '적어요'}`, tone: diff > 0 ? 'up' : 'down' };
}

function dayLabel(at) {
  const [, m, d] = at.split('-');
  return `${Number(m)}/${Number(d)}`;
}

// 최근 24시간 줄 — 어제(24~48시간 전)와 비교한다. 답 못 찾은 질문은 질문 중 비율이 더 중요한 신호라 비율로 보여준다.
const DAY_ROWS = [
  { key: 'chatQuestions', label: '챗봇 질문', unit: '건' },
  { key: 'chatNotFound', label: '답 못 찾은 질문', unit: '건', warn: true },
  { key: 'signups', label: '신규 가입', unit: '명' },
  { key: 'visitors', label: '방문자', unit: '명' },
];

function dayCompare(stats, key) {
  if (key === 'visitors') return null;
  if (key === 'chatNotFound') {
    const questions = stats.last24h.chatQuestions;
    return questions > 0 ? `질문의 ${Math.round((stats.last24h.chatNotFound / questions) * 100)}%` : null;
  }
  const prev = stats.previous24h?.[key];
  return prev == null ? null : `어제 ${prev.toLocaleString()}`;
}

/**
 * AdminDashboard
 * 관리자 첫 화면 — 처리할 일(신고·문의·승인 대기, 0건이면 한 줄) → 이용 현황(최근 7일 방문자와 14일 막대·지난주 비교, 작은 칸 셋)
 * → 최근 24시간(어제와 비교) → 관리 메뉴. GET /api/admin/stats 한 번으로 그리고, 들어올 때마다 새로 부른다(처리하고 돌아왔을 때
 * 건수가 그대로 남아 있으면 실제로 처리됐는지 헷갈린다).
 *
 * Props:
 * - onOpen(view, options): 'reports' | 'inquiries' | 'approval' | 'sanctions' | 'stats'({ tab, metric, range })
 */
function AdminDashboard({ onOpen }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAdminStats()
      .then((s) => !cancelled && setStats(s))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="home-error">현황을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.</p>;
  if (!stats) return <div className="skeleton skeleton-card" style={{ height: 420 }} aria-busy="true" aria-label="불러오는 중" />;

  const pending = stats.pending || { reports: 0, inquiries: 0, posts: 0 };
  const todos = [
    { view: 'reports', label: '신고함', count: pending.reports, Icon: IconSiren },
    { view: 'inquiries', label: '문의함', count: pending.inquiries, Icon: IconMessageCircle },
    { view: 'approval', label: '커뮤니티 승인 대기', count: pending.posts, Icon: IconUsers },
  ].filter((t) => t.count > 0);
  const compare = weekCompare(stats);
  const daily = stats.last14d?.daily || [];
  const maxDaily = Math.max(1, ...daily.map((d) => d.visitors));
  const dayValue = (key) => (key === 'visitors' ? stats.last24h.activeStudents : stats.last24h[key]);

  return (
    <>
      <p className="home-quick-label">처리할 일</p>
      {todos.length === 0 ? (
        <p className="admin-done">
          <IconCheck size={16} />
          지금 처리할 일이 없어요
        </p>
      ) : (
        <div className="admin-list">
          {todos.map(({ view, label, count, Icon }) => (
            <button type="button" key={view} className="admin-list-row" onClick={() => onOpen(view)} aria-label={`${label}, 처리 대기 ${count}건`}>
              <span className="admin-list-icon">
                <Icon size={18} />
              </span>
              <span className="admin-list-name">{label}</span>
              <span className="admin-count" aria-hidden="true">
                {count > 99 ? '99+' : count}
              </span>
              <IconChevronRight size={16} />
            </button>
          ))}
        </div>
      )}

      <p className="home-quick-label">이용 현황</p>
      <button type="button" className="admin-hero" onClick={() => onOpen('stats', { tab: 'trend', metric: 'visitors', range: '7d' })} aria-label="최근 7일 방문자 추이 보기">
        <span className="admin-hero-top">
          <span className="admin-stat-label">최근 7일 방문자</span>
          <span className="admin-hero-more">
            통계 <IconChevronRight size={14} />
          </span>
        </span>
        <span className="admin-hero-num">
          <b>{stats.last7d.visitors.toLocaleString()}</b>명
          {compare && <em className={`admin-compare ${compare.tone}`}>{compare.text}</em>}
        </span>
        {daily.length > 0 && (
          <>
            <span className="admin-spark" aria-hidden="true">
              {daily.map((d, i) => (
                <i
                  key={d.at}
                  className={i === daily.length - 1 ? 'today' : i >= daily.length - 7 ? 'week' : ''}
                  style={{ height: `${Math.max(4, (d.visitors / maxDaily) * 100)}%` }}
                />
              ))}
            </span>
            <span className="admin-axis" aria-hidden="true">
              <span>{dayLabel(daily[0].at)}</span>
              <span>오늘</span>
            </span>
          </>
        )}
      </button>
      <div className="admin-mini">
        <div>
          <span>지금 접속 중</span>
          <b>{stats.activeSessions.toLocaleString()}</b>
        </div>
        <div>
          <span>전체 가입자</span>
          <b>{(stats.totalStudents ?? 0).toLocaleString()}</b>
        </div>
        <div>
          <span>다시 온 비율</span>
          <b>{returnRate(stats.weeklyReturn)}</b>
          {returnNote(stats.weeklyReturn) && <small>{returnNote(stats.weeklyReturn)}</small>}
        </div>
      </div>

      <p className="home-quick-label">최근 24시간</p>
      <div className="admin-list">
        {DAY_ROWS.map((row) => (
          <button
            type="button"
            key={row.key}
            className={`admin-list-row${row.warn && stats.last24h.chatNotFound > 0 ? ' warn' : ''}`}
            onClick={() => onOpen('stats', { tab: 'trend', metric: row.key, ...(row.key === 'visitors' ? { range: '7d' } : {}) })}
            aria-label={`최근 24시간 ${row.label} ${dayValue(row.key).toLocaleString()}${row.unit}, 추이 보기`}
          >
            <span className="admin-list-name">{row.label}</span>
            <b className="admin-list-value">{dayValue(row.key).toLocaleString()}</b>
            <span className="admin-list-sub">{dayCompare(stats, row.key)}</span>
            <IconChevronRight size={16} />
          </button>
        ))}
      </div>

      <p className="home-quick-label">관리</p>
      <div className="admin-list">
        {[
          { view: 'reports', label: '신고함', Icon: IconSiren },
          { view: 'inquiries', label: '문의함', Icon: IconMessageCircle },
          { view: 'approval', label: '커뮤니티 관리', Icon: IconUsers },
          { view: 'sanctions', label: '제재 관리', Icon: IconBan },
          { view: 'stats', label: '통계', sub: '추이 · 기능 사용 · 학과·학번', Icon: IconBarChart },
        ].map(({ view, label, sub, Icon }) => (
          <button type="button" key={view} className="admin-list-row" onClick={() => onOpen(view)}>
            <span className="admin-list-icon">
              <Icon size={18} />
            </span>
            <span className="admin-list-name">{label}</span>
            {sub && <span className="admin-list-sub">{sub}</span>}
            <IconChevronRight size={16} />
          </button>
        ))}
      </div>
    </>
  );
}

export default AdminDashboard;
