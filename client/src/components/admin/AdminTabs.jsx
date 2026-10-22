import React from 'react';

/**
 * AdminTabs
 * 관리자 목록 화면 위의 글자 탭 — 학생 커뮤니티 개편(community-tabs)과 같은 모양. 건수(count)가 있으면 이름 옆에 붙인다.
 *
 * Props:
 * - tabs: [{ key, label, count? }]
 * - active / onChange(key)
 * - label: 탭 묶음 이름(화면 낭독용)
 */
function AdminTabs({ tabs, active, onChange, label }) {
  return (
    <div className="community-tabs admin-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === active}
          className={`community-tab ${t.key === active ? 'active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.count > 0 && <span className="admin-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export default AdminTabs;
