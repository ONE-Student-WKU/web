import React, { useEffect, useState } from 'react';
import { getAdminStatsComposition } from '../api/chatApi.js';

const GROUPINGS = [
  { key: 'department', tab: '학과별' },
  { key: 'cohort', tab: '학번별' },
];
const MEASURES = [
  { key: 'members', tab: '가입자' },
  { key: 'visitors7d', tab: '최근 7일 방문자' },
];

/**
 * AdminCompositionView
 * 관리자 "학과·학번별 사용자" — 학교에 보여줄 이용 현황(GET /api/admin/stats/composition). 학과·학번마다 가입자와 최근 7일 방문자를
 * 막대로 보여준다. 5명 미만 칸은 서버가 "기타"로 묶어 내려준다(학과·학번만으로 누가 쓰는지 짐작되지 않게).
 * 관리자 화면(Admin.jsx)의 하위 화면이라 뒤로가기는 Admin이 대시보드로 되돌린다.
 */
function AdminCompositionView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [grouping, setGrouping] = useState('department');
  const [measure, setMeasure] = useState('members');

  useEffect(() => {
    let cancelled = false;
    getAdminStatsComposition()
      .then((fresh) => {
        if (!cancelled) setData(fresh);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs = (items, value, onChange, label) => (
    <div className="admin-sub-tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === value}
          className={`admin-sub-tab ${item.key === value ? 'active' : ''}`}
          onClick={() => onChange(item.key)}
        >
          {item.tab}
        </button>
      ))}
    </div>
  );

  const group = data?.[grouping]?.[measure];
  const max = group ? Math.max(1, ...group.rows.map((r) => r.count), group.other?.count || 0) : 1;
  const percent = (n) => (group && group.total > 0 ? Math.round((n / group.total) * 100) : 0);
  const nameOf = (name) => (grouping === 'cohort' ? `${name}학번` : name);
  const groupingTab = GROUPINGS.find((g) => g.key === grouping).tab;
  const measureTab = MEASURES.find((m) => m.key === measure).tab;

  return (
    <>
      {tabs(GROUPINGS, grouping, setGrouping, '나눠 볼 기준')}
      {tabs(MEASURES, measure, setMeasure, '셀 사람')}

      {!data ? (
        error ? (
          <p className="home-error">사용자 현황을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.</p>
        ) : (
          <div className="skeleton skeleton-card" style={{ height: 300 }} aria-busy="true" aria-label="불러오는 중" />
        )
      ) : (
        <div className="admin-trend-card">
          <p className="admin-stat-label">
            {groupingTab} {measureTab}
          </p>
          <div className="admin-stat-value admin-trend-total">
            {group.total.toLocaleString()}
            <span className="admin-trend-unit">명</span>
          </div>

          {group.rows.length === 0 && !group.other ? (
            <p className="courses-manual-hint">아직 셀 사람이 없어요.</p>
          ) : (
            <ul className="admin-composition-list">
              {group.rows.map((row) => (
                <li className="admin-composition-row" key={row.name}>
                  <span className="admin-composition-name">{nameOf(row.name)}</span>
                  <span className="admin-composition-count">
                    {row.count.toLocaleString()}명 · {percent(row.count)}%
                  </span>
                  <div className="home-progress-track" aria-hidden="true">
                    <div className="home-progress-fill" style={{ width: `${(row.count / max) * 100}%` }} />
                  </div>
                </li>
              ))}
              {group.other && (
                <li className="admin-composition-row admin-composition-row--other">
                  <span className="admin-composition-name">
                    기타 ({data.minGroupSize}명 미만 {grouping === 'cohort' ? '학번' : '학과'} {group.other.groups}곳)
                  </span>
                  <span className="admin-composition-count">
                    {group.other.count.toLocaleString()}명 · {percent(group.other.count)}%
                  </span>
                  <div className="home-progress-track" aria-hidden="true">
                    <div className="home-progress-fill" style={{ width: `${(group.other.count / max) * 100}%` }} />
                  </div>
                </li>
              )}
            </ul>
          )}

          <p className="courses-manual-hint">
            {data.minGroupSize}명 미만인 {grouping === 'cohort' ? '학번은' : '학과는'} 누군지 짐작되지 않게 기타로 묶었어요.
            {grouping === 'department' && data.noDepartment > 0 && ` 학과를 아직 고르지 않은 ${data.noDepartment.toLocaleString()}명은 빠져 있어요.`}
            {measure === 'visitors7d' && ' 최근 7일 방문자는 7일 안에 한 번이라도 접속한 사람이에요.'}
          </p>
        </div>
      )}
    </>
  );
}

export default AdminCompositionView;
