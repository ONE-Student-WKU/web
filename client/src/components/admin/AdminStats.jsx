import React from 'react';
import AdminTabs from './AdminTabs.jsx';
import AdminTrendView from '../AdminTrendView.jsx';
import AdminUsageDepth from './AdminUsageDepth.jsx';
import AdminCompositionView from '../AdminCompositionView.jsx';

// eslint-disable-next-line react-refresh/only-export-components -- Admin.jsx가 새로고침 때 저장된 탭이 맞는지 이 목록으로 확인한다.
export const STATS_TABS = [
  { key: 'usage', label: '사용 깊이' },
  { key: 'trend', label: '추이' },
  { key: 'composition', label: '학과·학번' },
];

/**
 * AdminStats
 * 관리자 "통계" — 사용 깊이·추이·학과·학번을 한 화면의 탭 세 개로 모은다(예전에는 각각 다른 화면이라 오가기 불편했다).
 *
 * Props:
 * - tab / onChangeTab
 * - metric / onChangeMetric, range / onChangeRange: 추이 탭의 지표·기간(새로고침에도 남게 Admin이 들고 있다)
 */
function AdminStats({ tab, onChangeTab, metric, onChangeMetric, range, onChangeRange }) {
  return (
    <>
      <AdminTabs tabs={STATS_TABS} active={tab} onChange={onChangeTab} label="통계 종류" />
      <div className="admin-pad">
        {tab === 'usage' ? (
          <AdminUsageDepth />
        ) : tab === 'composition' ? (
          <AdminCompositionView />
        ) : (
          <AdminTrendView metric={metric} onChangeMetric={onChangeMetric} range={range} onChangeRange={onChangeRange} />
        )}
      </div>
    </>
  );
}

export default AdminStats;
