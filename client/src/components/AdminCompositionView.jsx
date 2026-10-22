import React, { useEffect, useState } from 'react';
import { getAdminStatsComposition } from '../api/chatApi.js';

const GROUPINGS = [
  { key: 'department', tab: '학과별' },
  { key: 'cohort', tab: '학번별' },
];

/**
 * AdminCompositionView
 * 관리자 통계의 "학과·학번" 탭 — 학교에 보여줄 이용 현황(GET /api/admin/stats/composition). 학과·학번마다 가입자와 최근 7일 방문자를
 * 한 줄에 같이 보여준다. 5명 미만 칸은 서버가 "기타"로 묶어 내려준다(학과·학번만으로 누가 쓰는지 짐작되지 않게) — 그래서 가입자는
 * 5명이 넘어도 방문자가 5명 미만인 칸은 숫자 대신 "5명 미만"으로 보인다.
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
  const max = members ? Math.max(1, ...members.rows.map((r) => r.count), members.other?.count || 0) : 1;
  const nameOf = (name) => (grouping === 'cohort' ? `${name}학번` : name);
  const unitWord = grouping === 'cohort' ? '학번' : '학과';
  const visitorsOf = (name) => {
    const row = visitors?.rows.find((r) => r.name === name);
    return row ? `${row.count.toLocaleString()}명` : `${data.minGroupSize}명 미만`;
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
          {members.rows.length === 0 && !members.other ? (
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
                {members.other && (
                  <tr className="other">
                    <th scope="row">
                      <span className="admin-composition-name">
                        기타 ({data.minGroupSize}명 미만 {unitWord} {members.other.groups}곳)
                      </span>
                      <span className="admin-feature-bar" aria-hidden="true">
                        <i style={{ width: `${(members.other.count / max) * 100}%` }} />
                      </span>
                    </th>
                    <td className="num">
                      <b>{members.other.count.toLocaleString()}명</b>
                      <small>—</small>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          <p className="courses-manual-hint">
            {data.minGroupSize}명 미만인 {unitWord}는 누군지 짐작되지 않게 기타로 묶고, 방문자가 {data.minGroupSize}명 미만인 칸은 숫자 대신 "{data.minGroupSize}명 미만"으로 보여요.
            {grouping === 'department' && data.noDepartment > 0 && ` 학과를 아직 고르지 않은 ${data.noDepartment.toLocaleString()}명은 빠져 있어요.`} 최근 7일 방문자는 7일 안에 한 번이라도 접속한 사람이에요.
          </p>
        </div>
      )}
    </>
  );
}

export default AdminCompositionView;
