import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconSearch, IconX } from './icons.jsx';
import { getYearRange, describeSuccessors } from '../utils/onboardingYears.js';
import { groupDepartmentsByCollege, searchDepartments, FORMER_GROUP_LABEL } from '../utils/departmentTree.js';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * DepartmentPicker
 * 온보딩·학적정보 수정의 학과 선택 — 맨 위 검색창 + "소속(단과대학) → 학과" 트리.
 * 검색어가 있으면 트리를 접어 두고 일치하는 학과만 한 줄 목록(소속 표시)으로 보여준다.
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
  // 입력창에 보이는 글(inputValue)과 실제로 필터에 쓰는 검색어(query)를 나눈다. 한글은 자음+모음이 조합돼야 완성된 글자가 되는데
  // ("컴" = ㅋ+ㅓ+ㅁ), 조합 중간의 낱자("컴ㅍ")로 바로 걸러 내면 "맞는 학과가 없어요"와 결과가 깜빡인다 — 과목 카탈로그 검색
  // (CourseManagement)과 같은 방식으로 조합 중에는 검색을 보류하고 글자가 완성되는 순간(compositionend)에만 반영한다.
  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const isComposingRef = useRef(false);
  const resultsRef = useRef(null);
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

  // 검색 결과가 새로 생기면 목록이 보이는 위치까지 맞춘다(과목 카탈로그 검색과 동일). 이미 보이면 block: 'nearest'라 매 타이핑마다 튀지 않는다.
  useEffect(() => {
    if (results.length > 0) resultsRef.current?.scrollIntoView?.({ behavior: 'instant', block: 'nearest' });
  }, [results]);

  const handleChange = (e) => {
    setInputValue(e.target.value);
    if (!isComposingRef.current) setQuery(e.target.value);
  };
  const handleCompositionEnd = (e) => {
    isComposingRef.current = false;
    setQuery(e.target.value);
  };
  const clearSearch = () => {
    setInputValue('');
    setQuery('');
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
      <div className="courses-search-box onb-search">
        <IconSearch />
        <input
          type="text"
          role="searchbox"
          value={inputValue}
          onChange={handleChange}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={handleCompositionEnd}
          placeholder={t('dept.search.placeholder')}
          aria-label={t('dept.search.aria')}
          autoComplete="off"
        />
        {inputValue && (
          <button type="button" className="onb-search-clear" onClick={clearSearch} aria-label={t('dept.search.clear')}>
            <IconX size={14} />
          </button>
        )}
      </div>

      {trimmed ? (
        results.length === 0 ? (
          <p className="onb-search-empty">
            {t('dept.search.empty', { query: trimmed })}
          </p>
        ) : (
          <>
            <p className="onb-search-count">{t('dept.search.count', { count: results.length })}</p>
            <div className="onb-option-list" ref={resultsRef}>
              {results.map((d) => (
                <DepartmentCard key={d.id} department={d} selected={selectedId === d.id} onSelect={onSelect} showCollege />
              ))}
            </div>
          </>
        )
      ) : hasTree ? (
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
    </div>
  );
}

export default DepartmentPicker;
