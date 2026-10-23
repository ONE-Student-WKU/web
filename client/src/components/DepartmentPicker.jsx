import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowRight, IconSearch } from './icons.jsx';
import SearchScreen from './SearchScreen.jsx';
import { closeSearchScreen } from './searchScreenHistory.js';
import useSearchInput from '../hooks/useSearchInput.js';
import { getYearRange, describeSuccessors } from '../utils/onboardingYears.js';
import { groupDepartmentsByCollege, searchDepartments, groupSearchResults, matchedTracks, splitByMatch, FORMER_GROUP_LABEL } from '../utils/departmentTree.js';
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
 * - onSelectAndContinue: (department) => void (선택) — 검색 결과에서 고를 때와 목록에서 엔터로 고를 때. 없으면 onSelect.
 *   온보딩은 이걸로 고른 뒤 바로 다음 질문으로 간다("다음"을 누른 것처럼).
 * - onSelectSuccessor: (successor, former) => void (선택) — 있으면 이전 학과 카드 아래에 "○○학번부터는 △△" 바로가기를 둔다.
 *   학교 문서로 확인된(confirmed) 이후 학과만. 이름이 비슷해서 이은 추정 연결은 잘못 보낼 수 있어 글자 안내만 남긴다.
 */

// 검색어와 일치한 글자를 칠한다(검색 결과에서만 — 목록에서는 query가 비어 그대로).
function Highlighted({ text, query }) {
  if (!query) return text;
  return splitByMatch(text, query).map((part, i) =>
    part.hit ? (
      <mark key={i} className="search-hit">
        {part.text}
      </mark>
    ) : (
      <React.Fragment key={i}>{part.text}</React.Fragment>
    )
  );
}

// cohortLabel: 개편 전후 묶음 안에서 카드 맨 앞에 붙는 학번 기준("2025학번까지" / "2026학번부터"). 묶음 안에서는 "이후 학과" 안내와 바로가기를 뺀다.
function DepartmentCard({ department, selected, active = false, onSelect, showCollege, query = '', shortcuts = [], onSelectSuccessor, cohortLabel = null, cohortOld = false }) {
  const { t } = useI18n();
  const range = getYearRange(department, 'GENERAL');
  const ref = useRef(null);
  // 검색 결과를 ↑↓로 옮길 때 가리킨 학과가 화면 밖이면 보이게 스크롤한다.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  // 학과 이름이 아니라 세부전공 이름으로 찾은 경우, 어느 세부전공이 맞았는지 보여 준다(예: 공학3계열 · 세부전공 컴퓨터·소프트웨어공학전공).
  const tracks = query && !splitByMatch(department.name, query).some((p) => p.hit) ? matchedTracks(department, query) : [];
  const card = (
    <button
      ref={ref}
      type="button"
      data-dept-id={department.id}
      className={'onb-option-card' + (selected ? ' selected' : '') + (active ? ' active' : '')}
      onClick={() => onSelect(department)}
    >
      {cohortLabel && <span className={'dept-cohort' + (cohortOld ? ' old' : '')}>{cohortLabel}</span>}
      <span className="onb-option-title">
        <Highlighted text={department.name} query={query} />
      </span>
      <span className="onb-option-caption">
        {/* 일반·편입 학생이 실제로 고를 수 있는 범위(요건이 있는 학번)를 보여준다 */}
        {/* 한 해뿐인 학과는 "2026~2026학번"이 아니라 "2026학번"(#378) */}
        {department.maxAdmissionYear && range.max !== range.min ? t('dept.cohortRange', { min: range.min, max: range.max }) : t('dept.cohortSingle', { min: range.min })}
        {showCollege && department.college && ` · ${department.college}${department.former ? ` (${t('dept.former')})` : ''}`}
        {showCollege && !department.college && department.former && ` · ${t('dept.formerClosed')}`}
      </span>
      {tracks.length > 0 && (
        <span className="onb-option-note">
          {t('dept.trackMatch')}{' '}
          {tracks.map((tr, i) => (
            <React.Fragment key={tr.id}>
              {i > 0 && ', '}
              <Highlighted text={tr.name} query={query} />
            </React.Fragment>
          ))}
        </span>
      )}
      {!cohortLabel && describeSuccessors(department, t) && <span className="onb-option-note">{describeSuccessors(department, t)}</span>}
    </button>
  );
  if (shortcuts.length === 0) return card;
  // 카드 자체가 버튼이라 바로가기는 카드 안이 아니라 바로 아래에 둔다(버튼 안에 버튼을 넣을 수 없다).
  return (
    <div className="onb-option-item">
      {card}
      {shortcuts.map((s) => (
        <button key={s.department.id} type="button" className="onb-successor-shortcut" onClick={() => onSelectSuccessor(s.department, department)}>
          {t('dept.successorShortcut', { year: s.year, name: s.department.name })}
          <IconArrowRight />
        </button>
      ))}
    </div>
  );
}

// 검색 결과를 화면에 보이는 순서로 — 개편 전후 학과 묶음은 이전 학과 다음에 이후 학과(↑↓·엔터도 이 순서를 따른다).
const displayOrder = (list) => groupSearchResults(list).flatMap((item) => (item.pair ? [item.pair.former, item.pair.successor] : [item.department]));

function DepartmentPicker({ departments, selectedId, onSelect, onSelectAndContinue = onSelect, onSelectSuccessor }) {
  const { t, tRich } = useI18n();
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
  const results = useMemo(() => (trimmed ? displayOrder(searchDepartments(departments, trimmed)) : []), [departments, trimmed]);
  // ↑↓로 가리키는 검색 결과. 검색어가 바뀌면 다시 맨 위(엔터만 치면 맨 위가 골라진다).
  const [active, setActive] = useState({ query: '', index: 0 });
  const activeIndex = active.query === trimmed ? active.index : 0;

  const dismissSearch = () => {
    deptSearch.reset();
    setQuery('');
    setSearchOpen(false);
  };

  const handleSelectFromSearch = (department) => {
    onSelectAndContinue(department);
    closeSearchScreen(); // 시스템 뒤로가기와 같은 경로 — SearchScreen이 onClose(dismissSearch)를 부른다
  };

  // 이전 학과 카드의 "○○학번부터는 △△" 바로가기 — 확인된 이후 학과가 이 목록에 있을 때만.
  const byName = useMemo(() => new Map(departments.map((d) => [d.name, d])), [departments]);
  const shortcutsFor = (department) => {
    if (!onSelectSuccessor) return [];
    return (department.successors || [])
      .filter((s) => s.confirmed)
      .map((s) => byName.get(s.name))
      .filter(Boolean)
      .map((target) => ({ department: target, year: getYearRange(target, 'GENERAL').min }));
  };
  const handleSelectSuccessorFromSearch = (successor, former) => {
    onSelectSuccessor(successor, former);
    closeSearchScreen();
  };
  // 검색 결과에서 학과를 고른다. 개편 전후 묶음의 이후 학과는 바로가기와 같은 경로(onSelectSuccessor)로 보내, 이전 학과에 이어지는
  // 세부전공까지 골라 두게 한다(컴퓨터·소프트웨어공학과 → 공학3계열 컴퓨터·소프트웨어공학전공).
  const selectFromSearch = (department) => {
    const pair = groupSearchResults(results).find((item) => item.pair && item.pair.successor === department)?.pair;
    if (pair && onSelectSuccessor) handleSelectSuccessorFromSearch(department, pair.former);
    else handleSelectFromSearch(department);
  };

  // ↑↓: 가리키는 결과를 옮긴다. 엔터(모바일 "검색" 키): 가리킨 결과를 고른다.
  const handleSearchKeyDown = (e) => {
    // 한글 조합을 끝내는 키는 건너뛴다 — 브라우저에 따라 엔터가 조합 확정용으로 한 번 더 들어와 두 번 고르게 된다.
    if (e.nativeEvent.isComposing) return;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.length > 0) {
      e.preventDefault(); // 입력 칸 커서가 맨 앞/뒤로 튀지 않게
      const next = activeIndex + (e.key === 'ArrowDown' ? 1 : -1);
      setActive({ query: trimmed, index: Math.max(0, Math.min(results.length - 1, next)) });
    } else if (e.key === 'Enter') {
      // 마지막 글자 조합이 막 끝난 순간엔 query 상태가 아직 안 바뀌었을 수 있어, 그때는 입력 칸의 지금 값으로 다시 찾아 맨 위를 고른다.
      const value = e.currentTarget.value.trim();
      const pick = value === trimmed ? results[activeIndex] : displayOrder(searchDepartments(departments, value))[0];
      if (pick) selectFromSearch(pick);
    }
  };

  const renderSearchResults = () => {
    if (!trimmed) return <p className="search-screen-hint">{t('dept.search.hint')}</p>;
    if (results.length === 0) return <p className="search-screen-hint">{t('dept.search.empty', { query: trimmed })}</p>;
    return (
      <>
        <p className="search-screen-count">{t('dept.search.count', { count: results.length })}</p>
        <div className="onb-option-list">
          {groupSearchResults(results).map((item) => {
            const card = (d, extra = {}) => (
              <DepartmentCard
                key={d.id}
                department={d}
                selected={selectedId === d.id}
                active={results.indexOf(d) === activeIndex}
                onSelect={selectFromSearch}
                showCollege
                query={trimmed}
                shortcuts={extra.cohortLabel ? [] : shortcutsFor(d)}
                onSelectSuccessor={handleSelectSuccessorFromSearch}
                {...extra}
              />
            );
            if (!item.pair) return card(item.department);
            // 개편 전후 학과 — 한 묶음으로 두고 맨 앞에 학번 기준을 보여, 학생이 자기 학번으로 바로 고르게 한다(2026-10-22 피드백).
            const { former, successor } = item.pair;
            const from = getYearRange(successor, 'GENERAL').min;
            const until = getYearRange(former, 'GENERAL').max;
            return (
              <div className="dept-pair" key={`pair-${former.id}-${successor.id}`}>
                <p className="dept-pair-head">{tRich('dept.pair.head', { year: from })}</p>
                {card(former, { cohortLabel: t('dept.cohortUntil', { year: until }), cohortOld: true })}
                {card(successor, { cohortLabel: t('dept.cohortFrom', { year: from }) })}
              </div>
            );
          })}
        </div>
      </>
    );
  };

  // 학과 목록 키보드 — 화면 어디에 포커스가 있든(처음 들어와 아무것도 안 눌렀을 때 포함) ↑↓로 전체 학과 순서대로 위·아래 학과를 고른다.
  // 다른 대학 묶음으로 넘어가면 그 묶음만 펼치고 떠난 묶음은 접는다(교학대학 원불교학과 → ↓ → 의과대학 의예과). 처음 ↓는 맨 위 학과.
  // 학과 카드에서 엔터: 그 학과를 고르고 바로 다음으로("다음"을 누른 것처럼). 처리하지 않으면 브라우저가 페이지만 스크롤했다.
  // 입력 칸, 검색 화면·확인 창(aria-modal)이 열려 있을 때는 가로채지 않는다 — 검색 결과의 ↑↓·엔터는 handleSearchKeyDown이 맡는다.
  const rootRef = useRef(null);
  const [focusId, setFocusId] = useState(null);
  const allDepartments = hasTree ? groups.flatMap((g) => g.departments) : departments;
  const groupOf = (department) => groups.find((g) => g.departments.includes(department))?.college;

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
      if (e.defaultPrevented || e.target.closest?.('input, textarea, select, [aria-modal="true"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const card = e.target.closest?.('[data-dept-id]');
      if (e.key === 'Enter') {
        if (!card || !rootRef.current?.contains(card)) return; // 다른 버튼(다음·묶음 머리 등)의 엔터는 그대로
        e.preventDefault(); // 버튼 클릭(고르기만)으로 이어지지 않게
        const department = allDepartments.find((d) => String(d.id) === card.dataset.deptId);
        if (department) onSelectAndContinue(department);
        return;
      }
      e.preventDefault();
      const fromId = card && rootRef.current?.contains(card) ? card.dataset.deptId : selectedId;
      const index = allDepartments.findIndex((d) => String(d.id) === String(fromId));
      const next = index < 0 ? (e.key === 'ArrowDown' ? allDepartments[0] : null) : allDepartments[index + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!next) return; // 맨 끝에서는 멈춘다
      onSelect(next);
      if (hasTree) setOpenGroups(new Set([groupOf(next)]));
      setFocusId(next.id);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // 키보드로 옮긴 학과 카드에 포커스를 준다 — 접혀 있던 묶음이 펼쳐진 뒤라야 카드가 있어서 렌더 후에 한다. 떠 있는 "다음" 버튼에 가리지 않게 가운데로.
  useEffect(() => {
    if (focusId == null) return;
    const el = rootRef.current?.querySelector(`[data-dept-id="${focusId}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: 'center' });
  }, [focusId, openGroups]);

  const toggle = (college) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(college)) next.delete(college);
      else next.add(college);
      return next;
    });

  return (
    <div className="onb-dept-picker" ref={rootRef}>
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
                      <DepartmentCard
                        key={d.id}
                        department={d}
                        selected={selectedId === d.id}
                        onSelect={onSelect}
                        showCollege={false}
                        shortcuts={shortcutsFor(d)}
                        onSelectSuccessor={onSelectSuccessor}
                      />
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
            <DepartmentCard
              key={d.id}
              department={d}
              selected={selectedId === d.id}
              onSelect={onSelect}
              showCollege={false}
              shortcuts={shortcutsFor(d)}
              onSelectSuccessor={onSelectSuccessor}
            />
          ))}
        </div>
      )}

      {searchOpen && (
        <SearchScreen
          search={deptSearch}
          onClose={dismissSearch}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('dept.search.placeholder')}
          ariaLabel={t('dept.search.aria')}
        >
          {renderSearchResults()}
        </SearchScreen>
      )}
    </div>
  );
}

export default DepartmentPicker;
