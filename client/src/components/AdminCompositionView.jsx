import React, { useEffect, useState } from 'react';
import { getAdminStatsComposition } from '../api/chatApi.js';

const GROUPINGS = [
  { key: 'department', tab: '학과별' },
  { key: 'cohort', tab: '학번별' },
];

/**
 * AdminCompositionView
 * 관리자 통계의 "학과·학번" 탭 — 학교에 보여줄 이용 현황(GET /api/admin/stats/composition). 학과·학번마다 가입자와 최근 7일 방문자를
 * 한 줄에 같이 보여준다. 1명짜리 학과·학번도 묶지 않고 그대로 보여준다(2026-11-10 결정 — 예전에는 5명 미만을 "기타"로 묶었다).
 */
function AdminCompositionView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [grouping, setGrouping] = useState('department');

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

  const members = data?.[grouping]?.members;
  const visitors = data?.[grouping]?.visitors7d;
  const max = members ? Math.max(1, ...members.rows.map((r) => r.count)) : 1;
  const nameOf = (name) => (grouping === 'cohort' ? `${name}학번` : name);
  const unitWord = grouping === 'cohort' ? '학번' : '학과';
  const visitorsOf = (name) => {
    const row = visitors?.rows.find((r) => r.name === name);
    return `${(row?.count ?? 0).toLocaleString()}명`;
  };

  return (
    <>
      <div className="seg admin-filter" role="tablist" aria-label="나눠 볼 기준">
        {GROUPINGS.map((g) => (
          <button key={g.key} type="button" role="tab" aria-selected={g.key === grouping} className={g.key === grouping ? 'active' : ''} onClick={() => setGrouping(g.key)}>
            {g.tab}
          </button>
        ))}
      </div>

      {!data ? (
        error ? (
          <p className="home-error">사용자 현황을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.</p>
        ) : (
          <div className="skeleton skeleton-card" style={{ height: 300 }} aria-busy="true" aria-label="불러오는 중" />
        )
      ) : (
        <div className="admin-card">
          <p className="admin-composition-total">
            가입자 <b>{members.total.toLocaleString()}</b>명 · 최근 7일 방문 <b>{visitors.total.toLocaleString()}</b>명
          </p>
          {members.rows.length === 0 ? (
            <p className="courses-manual-hint">아직 셀 사람이 없어요.</p>
          ) : (
            <table className="admin-composition-table">
              <thead>
                <tr>
                  <th scope="col">{unitWord}</th>
                  <th scope="col" className="num">
                    가입자
                    <small>최근 7일 방문</small>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.rows.map((row) => (
                  <tr key={row.name}>
                    <th scope="row">
                      <span className="admin-composition-name">{nameOf(row.name)}</span>
                      <span className="admin-feature-bar" aria-hidden="true">
                        <i style={{ width: `${(row.count / max) * 100}%` }} />
                      </span>
                    </th>
                    <td className="num">
                      <b>{row.count.toLocaleString()}명</b>
                      <small>{visitorsOf(row.name)}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="courses-manual-hint">
            최근 7일 방문자는 7일 안에 한 번이라도 접속한 사람이에요.
            {grouping === 'department' && data.noDepartment > 0 && ` 학과를 아직 고르지 않은 ${data.noDepartment.toLocaleString()}명은 빠져 있어요.`}
          </p>
        </div>
      )}
    </>
  );
}

export default AdminCompositionView;
