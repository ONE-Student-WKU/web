import React, { useEffect, useMemo, useState } from 'react';
import { IconSearch } from './icons.jsx';
import SearchScreen from './SearchScreen.jsx';
import { closeSearchScreen } from './searchScreenHistory.js';
import useSearchInput from '../hooks/useSearchInput.js';
import { getYearRange, describeSuccessors } from '../utils/onboardingYears.js';
import { groupDepartmentsByCollege, searchDepartments, FORMER_GROUP_LABEL } from '../utils/departmentTree.js';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * DepartmentPicker
 * 온보딩·학적정보 수정의 학과 선택 — 맨 위 검색창 모양 진입 버튼 + "소속(단과대학) → 학과" 트리.
 * 검색은 과목·커뮤니티 검색처럼 별도 전체 화면(SearchScreen)에서 하고, 일치하는 학과만 한 줄 목록(소속 표시)으로 보여준다.
 * 검색 결과에서 학과를 고르면 검색 화면이 닫히고, 트리에서 그 학과가 든 묶음이 펼쳐진 채 선택 표시가 된다.
 * 소속 정보를 못 받은 경우(서버가 college를 안 내려주는 배포 순서, 자료 읽기 실패)에는 기존처럼 평평한 목록이 된다.
 *
 * Props:
 * - departments: [{ id, name, college, former, collegeOrder, successors, ...요건 학번 범위 }]
 * - selectedId: number | null
 * - onSelect: (department) => void
 */
function DepartmentCard({ department, selected, onSelect, showCollege }) {
  const { t } = useI18n();
  const range = getYearRange(department, 'GENERAL');
  return (
    <button type="button" className={'onb-option-card' + (selected ? ' selected' : '')} onClick={() => onSelect(department)}>
      <span className="onb-option-title">{department.name}</span>
      <span className="onb-option-caption">
        {/* 일반·편입 학생이 실제로 고를 수 있는 범위(요건이 있는 학번)를 보여준다 */}
        {department.maxAdmissionYear ? t('dept.cohortRange', { min: range.min, max: range.max }) : t('dept.cohortSingle', { min: range.min })}
        {showCollege && department.college && ` · ${department.college}${department.former ? ` (${t('dept.former')})` : ''}`}
        {showCollege && !department.college && department.former && ` · ${t('dept.formerClosed')}`}
      </span>
      {describeSuccessors(department, t) && <span className="onb-option-note">{describeSuccessors(department, t)}</span>}
    </button>
  );
}

function DepartmentPicker({ departments, selectedId, onSelect }) {
  const { t } = useI18n();
  // 검색 입력 칸의 상태와 한글 조합 처리(조합 중 낱자로 걸러 내면 "맞는 학과가 없어요"가 깜빡인다)는 useSearchInput이 맡는다.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const deptSearch = useSearchInput(setQuery);
  const groups = useMemo(() => groupDepartmentsByCollege(departments), [departments]);
  const hasTree = groups.some((g) => g.college !== FORMER_GROUP_LABEL) || groups.length > 1;
  // 처음 열 때는 고른 학과가 들어 있는 묶음만 펼쳐 둔다(없으면 전부 접힘). 이후는 사용자가 누른 대로.
  const [openGroups, setOpenGroups] = useState(() => {
    const open = new Set();
    for (const g of groupDepartmentsByCollege(departments)) if (g.departments.some((d) => d.id === selectedId)) open.add(g.college);
    return open;
  });

  // 학과 목록이 나중에 도착하거나 선택이 바뀌어도, 고른 학과가 든 묶음은 항상 열려 있게 한다(닫는 건 사용자가 누를 때만).
  useEffect(() => {
    if (selectedId == null) return;
    const group = groups.find((g) => g.departments.some((d) => d.id === selectedId));
    if (group) setOpenGroups((prev) => (prev.has(group.college) ? prev : new Set(prev).add(group.college)));
  }, [groups, selectedId]);

  const trimmed = query.trim();
  const results = useMemo(() => (trimmed ? searchDepartments(departments, trimmed) : []), [departments, trimmed]);

  const dismissSearch = () => {
    deptSearch.reset();
    setQuery('');
    setSearchOpen(false);
  };

  const handleSelectFromSearch = (department) => {
    onSelect(department);
    closeSearchScreen(); // 시스템 뒤로가기와 같은 경로 — SearchScreen이 onClose(dismissSearch)를 부른다
  };

  const renderSearchResults = () => {
    if (!trimmed) return <p className="search-screen-hint">{t('dept.search.hint')}</p>;
    if (results.length === 0) return <p className="search-screen-hint">{t('dept.search.empty', { query: trimmed })}</p>;
    return (
      <>
        <p className="search-screen-count">{t('dept.search.count', { count: results.length })}</p>
        <div className="onb-option-list">
          {results.map((d) => (
            <DepartmentCard key={d.id} department={d} selected={selectedId === d.id} onSelect={handleSelectFromSearch} showCollege />
          ))}
        </div>
      </>
    );
  };

  const toggle = (college) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(college)) next.delete(college);
      else next.add(college);
      return next;
    });

  return (
    <div className="onb-dept-picker">
      <button type="button" className="search-entry" onClick={() => setSearchOpen(true)} aria-label={t('dept.search.aria')}>
        <IconSearch />
        <span>{t('dept.search.placeholder')}</span>
      </button>

      {hasTree ? (
        <div className="onb-college-tree">
          {groups.map((g) => {
            const open = openGroups.has(g.college);
            return (
              <div key={g.college} className="onb-college-group">
                <button
                  type="button"
                  className={'onb-college-head' + (open ? ' open' : '')}
                  onClick={() => toggle(g.college)}
                  aria-expanded={open}
                >
                  <span className="onb-college-name">{g.college === FORMER_GROUP_LABEL ? t('dept.formerGroup') : g.college}</span>
                  <span className="onb-college-count">{g.departments.length}</span>
                  <span className="onb-college-chevron" aria-hidden="true">
                    {open ? '▾' : '▸'}
                  </span>
                </button>
                {open && (
                  <div className="onb-option-list onb-college-body">
                    {g.college === FORMER_GROUP_LABEL && (
                      <p className="onb-college-hint">{t('dept.formerHint')}</p>
                    )}
                    {g.departments.map((d) => (
                      <DepartmentCard key={d.id} department={d} selected={selectedId === d.id} onSelect={onSelect} showCollege={false} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="onb-option-list">
          {departments.map((d) => (
            <DepartmentCard key={d.id} department={d} selected={selectedId === d.id} onSelect={onSelect} showCollege={false} />
          ))}
        </div>
      )}

      {searchOpen && (
        <SearchScreen search={deptSearch} onClose={dismissSearch} placeholder={t('dept.search.placeholder')} ariaLabel={t('dept.search.aria')}>
          {renderSearchResults()}
        </SearchScreen>
      )}
    </div>
  );
}

export default DepartmentPicker;
