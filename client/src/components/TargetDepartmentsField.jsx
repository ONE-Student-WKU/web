import React, { useMemo, useState } from 'react';
import { getDepartments } from '../api/chatApi.js';
import SearchScreen from './SearchScreen.jsx';
import { closeSearchScreen } from './searchScreenHistory.js';
import useSearchInput from '../hooks/useSearchInput.js';
import { searchDepartments } from '../utils/departmentTree.js';
import { IconPlus, IconX } from './icons.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * TargetDepartmentsField
 * 커뮤니티 글쓰기의 "모집 학과" 칸(2026-10-22 피드백) — "학과 상관없음 / 특정 학과만"을 고르고, 특정 학과면 학과 칩을 최대 3개 붙인다.
 * 학과는 온보딩과 같은 학과 검색(searchDepartments)으로 고른다. 학과 목록은 처음 "학과 추가"를 누를 때 한 번만 불러온다.
 *
 * Props:
 * - mode: 'any' | 'specific'
 * - departments: [{ id, name }] — 고른 순서
 * - onChange: ({ mode, departments }) => void
 */

const MAX_TARGET_DEPARTMENTS = 3;

// 학과 목록은 화면을 다시 열어도 바뀌지 않아 모듈 스코프에 한 번만 받아 둔다.
let departmentListPromise = null;
function loadDepartmentList() {
  if (!departmentListPromise) {
    departmentListPromise = getDepartments().catch((err) => {
      departmentListPromise = null; // 실패하면 다음에 다시 시도
      throw err;
    });
  }
  return departmentListPromise;
}

function TargetDepartmentsField({ mode, departments, onChange }) {
  const { t } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [allDepartments, setAllDepartments] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const deptSearch = useSearchInput(setQuery);

  const trimmed = query.trim();
  const chosenIds = new Set(departments.map((d) => d.id));
  const results = useMemo(() => (allDepartments && trimmed ? searchDepartments(allDepartments, trimmed) : []), [allDepartments, trimmed]);

  const openSearch = () => {
    setSearchOpen(true);
    setLoadError(false);
    loadDepartmentList()
      .then(setAllDepartments)
      .catch(() => setLoadError(true));
  };

  const dismissSearch = () => {
    deptSearch.reset();
    setQuery('');
    setSearchOpen(false);
  };

  const add = (department) => {
    if (!chosenIds.has(department.id) && departments.length < MAX_TARGET_DEPARTMENTS) {
      onChange({ mode, departments: [...departments, { id: department.id, name: department.name }] });
    }
    closeSearchScreen(); // SearchScreen이 onClose(dismissSearch)를 부른다
  };

  const remove = (id) => onChange({ mode, departments: departments.filter((d) => d.id !== id) });

  const renderResults = () => {
    if (loadError) return <p className="home-error">{t('community.write.deptLoadError')}</p>;
    if (!allDepartments) return <p className="search-screen-hint">{t('search.loading')}</p>;
    if (!trimmed) return <p className="search-screen-hint">{t('dept.search.hint')}</p>;
    if (results.length === 0) return <p className="search-screen-hint">{t('dept.search.empty', { query: trimmed })}</p>;
    return (
      <>
        <p className="search-screen-count">{t('dept.search.count', { count: results.length })}</p>
        <div className="onb-option-list">
          {results.map((d) => (
            <button key={d.id} type="button" className={'onb-option-card' + (chosenIds.has(d.id) ? ' selected' : '')} onClick={() => add(d)}>
              <span className="onb-option-title">{d.name}</span>
              {(d.college || d.former) && (
                <span className="onb-option-caption">
                  {d.college ? `${d.college}${d.former ? ` (${t('dept.former')})` : ''}` : t('dept.formerClosed')}
                </span>
              )}
            </button>
          ))}
        </div>
      </>
    );
  };

  return (
    // 커뮤니티 글쓰기의 "모집 정보" 한 줄(write-set) — 이름은 왼쪽, "상관없음 / 특정 학과" 고르기는 오른쪽, 학과 칩은 그 아래.
    <div className="write-set write-set--stack">
      <div className="write-set-row">
        <span className="write-set-label" id="community-write-dept">
          {t('community.write.dept')}
        </span>
        <div className="seg" role="group" aria-labelledby="community-write-dept">
          <button type="button" className={mode === 'any' ? 'active' : ''} aria-pressed={mode === 'any'} onClick={() => onChange({ mode: 'any', departments })}>
            {t('community.write.deptAny')}
          </button>
          <button type="button" className={mode === 'specific' ? 'active' : ''} aria-pressed={mode === 'specific'} onClick={() => onChange({ mode: 'specific', departments })}>
            {t('community.write.deptSpecific')}
          </button>
        </div>
      </div>
      {mode === 'specific' && (
        <>
          <div className="dept-chips">
            {departments.map((d) => (
              <span key={d.id} className="dept-chip">
                {d.name}
                <button type="button" aria-label={t('community.write.deptRemoveAria', { name: d.name })} onClick={() => remove(d.id)}>
                  <IconX size={12} />
                </button>
              </span>
            ))}
            {departments.length < MAX_TARGET_DEPARTMENTS && (
              <button type="button" className="dept-chip-add" onClick={openSearch}>
                <IconPlus size={13} />
                {t('community.write.deptAdd')}
              </button>
            )}
          </div>
          <p className="post-write-help">{t('community.write.deptMax', { n: MAX_TARGET_DEPARTMENTS })}</p>
        </>
      )}
      {searchOpen && (
        <SearchScreen search={deptSearch} onClose={dismissSearch} placeholder={t('dept.search.placeholder')} ariaLabel={t('dept.search.aria')}>
          {renderResults()}
        </SearchScreen>
      )}
    </div>
  );
}

export default TargetDepartmentsField;
