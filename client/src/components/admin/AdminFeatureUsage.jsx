import React, { useEffect, useMemo, useState } from 'react';
import { getAdminFeatureUsage } from '../../api/chatApi.js';
import { featureLabel, screenOf, SCREEN_LABEL, SHARED_MENU_VIEWS, viewLabel, RECOMMEND_BINS } from '../../utils/adminFeatureLabels.js';
import { IconChevronRight } from '../icons.jsx';

const RANGES = [
  { key: '7d', tab: '7일', days: 7 },
  { key: '30d', tab: '30일', days: 30 },
  { key: 'all', tab: '전체', days: null },
];
// 화면 묶음을 접어 둘 때 보이는 줄 수.
const COLLAPSED_ROWS = 3;
// 진로 추천 버튼이 진해지는 대화 횟수(CareerExploration.jsx READY_TURNS와 같은 값).
const READY_TURNS = '3';

function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
}

/**
 * AdminFeatureUsage
 * 관리자 통계의 "기능 사용" 탭(GET /api/admin/stats/features) — 화면·버튼이 몇 번 쓰였는지의 합계(누가 썼는지는 없다).
 * 위에는 미뤄 둔 질문에 바로 답하는 카드(같은 기능을 하단 바와 홈 메뉴 중 어디서 더 누르나, 진로 추천을 몇 번째 대화에서 누르나),
 * 아래는 화면별로 묶어 많이 쓴 순서. "하루 평균 n대"는 날마다 그 기능을 쓴 기기 수의 평균(대략)이다.
 */
function AdminFeatureUsage() {
  const [range, setRange] = useState('7d');
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    getAdminFeatureUsage(range)
      .then((fresh) => !cancelled && setData(fresh))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [range]);

  const counts = useMemo(() => new Map((data?.events || []).map((e) => [e.event, e])), [data]);
  const countOf = (event) => counts.get(event)?.count || 0;

  // 하루 평균의 분모 — 기간의 날 수. 기록을 시작한 지 기간보다 짧으면 시작한 날부터 센다.
  const days = useMemo(() => {
    if (!data?.firstDate) return 1;
    const span = daysBetween(data.from && data.from > data.firstDate ? data.from : data.firstDate, data.to);
    const limit = RANGES.find((r) => r.key === range).days;
    return Math.max(1, limit ? Math.min(limit, span) : span);
  }, [data, range]);

  const groups = useMemo(() => {
    const byScreen = new Map();
    for (const e of data?.events || []) {
      const screen = screenOf(e.event);
      if (!byScreen.has(screen)) byScreen.set(screen, { screen, total: 0, events: [] });
      const g = byScreen.get(screen);
      g.total += e.count;
      g.events.push(e);
    }
    return [...byScreen.values()].sort((a, b) => b.total - a.total);
  }, [data]);

  const menuCompare = SHARED_MENU_VIEWS.map((view) => ({ view, home: countOf(`home.menu.${view}`), bar: countOf(`tabbar.${view}`) })).filter((r) => r.home + r.bar > 0);
  const bins = RECOMMEND_BINS.map((b) => ({ ...b, count: b.turns.reduce((sum, t) => sum + countOf(`career.recommend.turn_${t}`), 0) }));
  const binMax = Math.max(1, ...bins.map((b) => b.count));
  const confirmed = countOf('career.recommend.confirm');
  const cancelled = countOf('career.recommend.cancel');

  return (
    <>
      <div className="seg admin-filter" role="tablist" aria-label="기간 선택">
        {RANGES.map((r) => (
          <button key={r.key} type="button" role="tab" aria-selected={r.key === range} className={r.key === range ? 'active' : ''} onClick={() => setRange(r.key)}>
            {r.tab}
          </button>
        ))}
      </div>

      {!data ? (
        error ? (
          <p className="home-error">기능 사용 횟수를 불러오지 못했어요. 새로고침 후 다시 시도해주세요.</p>
        ) : (
          <div className="skeleton skeleton-card" style={{ height: 300 }} aria-busy="true" aria-label="불러오는 중" />
        )
      ) : data.events.length === 0 ? (
        <p className="courses-manual-hint">아직 기록이 없어요. 기능 사용 횟수는 이 기능을 배포한 날부터 쌓여요.</p>
      ) : (
        <>
          {menuCompare.length > 0 && (
            <div className="admin-card">
              <p className="admin-stat-label">같은 기능, 어디서 더 누를까</p>
              <ul className="admin-vs">
                {menuCompare.map((r) => {
                  const total = r.home + r.bar;
                  return (
                    <li key={r.view}>
                      <span>{viewLabel(r.view)}</span>
                      <span className="admin-vs-bar" role="img" aria-label={`${viewLabel(r.view)} 홈 메뉴 ${r.home}회, 하단 바 ${r.bar}회`}>
                        {r.home > 0 && <i className="a" style={{ width: `${(r.home / total) * 100}%` }} />}
                        {r.bar > 0 && <i className="b" style={{ width: `${(r.bar / total) * 100}%` }} />}
                      </span>
                      <span className="admin-vs-n">
                        {r.home.toLocaleString()} · {r.bar.toLocaleString()}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="admin-legend" aria-hidden="true">
                <span>
                  <i className="bar" />홈 메뉴
                </span>
                <span>
                  <i className="bar b" />하단 바
                </span>
              </p>
            </div>
          )}

          {bins.some((b) => b.count > 0) && (
            <div className="admin-card">
              <p className="admin-stat-label">진로 추천을 몇 번째 대화에서 눌렀나</p>
              <div className="admin-hist" role="img" aria-label={bins.map((b) => `${b.label}번째 ${b.count}회`).join(', ')}>
                {bins.map((b) => (
                  <span key={b.label} className={b.label === READY_TURNS ? 'on' : ''}>
                    <i style={{ height: `${(b.count / binMax) * 100}%` }} />
                    <em>{b.label}</em>
                  </span>
                ))}
              </div>
              <p className="admin-card-note">
                {READY_TURNS}번째 대화부터 버튼이 진해져요.
                {confirmed + cancelled > 0 && (
                  <>
                    {' '}누른 뒤 실제로 추천받은 비율 <b>{Math.round((confirmed / (confirmed + cancelled)) * 100)}%</b>(취소 {cancelled.toLocaleString()}회).
                  </>
                )}
              </p>
            </div>
          )}

          <p className="home-quick-label">화면별</p>
          {groups.map((g) => {
            const open = expanded[g.screen];
            const shown = open ? g.events : g.events.slice(0, COLLAPSED_ROWS);
            const max = Math.max(1, ...g.events.map((e) => e.count));
            return (
              <div className="admin-group" key={g.screen}>
                <button
                  type="button"
                  className="admin-group-head"
                  aria-expanded={Boolean(open)}
                  onClick={() => setExpanded((prev) => ({ ...prev, [g.screen]: !prev[g.screen] }))}
                  disabled={g.events.length <= COLLAPSED_ROWS}
                >
                  <span>{SCREEN_LABEL[g.screen] || g.screen}</span>
                  <b>{g.total.toLocaleString()}회</b>
                  {g.events.length > COLLAPSED_ROWS && <IconChevronRight size={16} />}
                </button>
                <ul>
                  {shown.map((e) => (
                    <li className="admin-feature-row" key={e.event}>
                      <span className="admin-feature-name">{featureLabel(e.event)}</span>
                      <span className="admin-feature-bar" aria-hidden="true">
                        <i style={{ width: `${(e.count / max) * 100}%` }} />
                      </span>
                      <span className="admin-feature-n">
                        <b>{e.count.toLocaleString()}</b>회<small>하루 평균 {Math.round(e.devices / days).toLocaleString()}대</small>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <p className="courses-manual-hint">
            누가 썼는지는 저장하지 않아요. "하루 평균 n대"는 그날 그 기능을 쓴 기기 수의 평균(대략)이에요. 관리자 계정이 누른 것은 세지 않아요.
          </p>
        </>
      )}
    </>
  );
}

export default AdminFeatureUsage;
