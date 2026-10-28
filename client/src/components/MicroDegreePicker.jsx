import React, { useMemo, useState } from 'react';
import { IconSearch, IconX } from './icons.jsx';
import SearchScreen from './SearchScreen.jsx';
import Highlighted from './Highlighted.jsx';
import useSearchInput from '../hooks/useSearchInput.js';
import { groupByProgram, searchMicroDegrees, DEPARTMENT_MD_PREFIX } from '../utils/microDegreeSearch.js';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * MicroDegreePicker
 * 학적 수정의 마이크로디그리 고르기(#412) — 학과 고르기(DepartmentPicker)와 같은 틀: 맨 위 검색창 모양 진입 버튼,
 * 아래에 묶음(사업단·계열) 트리. 과정이 125개라 학생 학과의 계열 묶음만 펼쳐 두고 나머지는 접는다(2026-10-28 피드백).
 * 검색은 학과 검색과 같은 전체 화면(SearchScreen)·정규화·줄임말이고, 여러 개를 고르므로 고른 뒤에도 검색 화면을 닫지 않는다.
 * 고른 과정은 위에 칩으로 모아 보여 줘서, 접힌 묶음에서 고른 것도 놓치지 않게 한다(커뮤니티 모집 학과 칩과 같은 모양).
 * 과정 이름·묶음 이름은 서버 데이터라 번역하지 않는다.
 *
 * Props:
 * - options: [{ name, programGroup }]
 * - selected: string[] — 고른 과정 이름(고른 순서)
 * - onChange: (names) => void
 * - myGroup: string | null — 학생 학과의 계열 묶음(findMyMicroDegreeGroup). 없으면 모든 묶음을 접는다.
 */
function MicroDegreeRow({ option, checked, onToggle, query = '' }) {
  return (
    <label className={'onb-micro-row' + (checked ? ' checked' : '')}>
      <input type="checkbox" checked={checked} onChange={() => onToggle(option.name)} />
      <span>
        <Highlighted text={option.name} query={query} />
      </span>
    </label>
  );
}

function MicroDegreePicker({ options, selected, onChange, myGroup }) {
  const { t } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const search = useSearchInput(setQuery);
  const trimmed = query.trim();
  const chosen = new Set(selected);
  const results = useMemo(() => (trimmed ? searchMicroDegrees(options, trimmed) : []), [options, trimmed]);
  const groups = useMemo(() => groupByProgram(options), [options]);
  const mine = groups.find(([group]) => group === myGroup);
  const others = groups.filter(([group]) => group !== myGroup);

  const toggle = (name) => onChange(chosen.has(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  const toggleGroup = (group) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  const dismissSearch = () => {
    search.reset();
    setQuery('');
    setSearchOpen(false);
  };

  const renderResults = () => {
    if (!trimmed) return <p className="search-screen-hint">{t('onb.micro.searchHint')}</p>;
    if (results.length === 0) return <p className="search-screen-hint">{t('onb.micro.searchEmpty', { query: trimmed })}</p>;
    return (
      <>
        <p className="search-screen-count">{t('dept.search.count', { count: results.length })}</p>
        {results.map((m) => (
          <MicroDegreeRow key={m.name} option={m} checked={chosen.has(m.name)} onToggle={toggle} query={trimmed} />
        ))}
      </>
    );
  };

  return (
    <div className="onb-micro-picker">
      <button type="button" className="search-entry" onClick={() => setSearchOpen(true)} aria-label={t('onb.micro.search')}>
        <IconSearch />
        <span>{t('onb.micro.searchPlaceholder')}</span>
      </button>

      {selected.length > 0 && (
        <div className="onb-micro-chosen">
          <p className="onb-field-label">{t('onb.micro.chosen', { n: selected.length })}</p>
          <div className="dept-chips">
            {selected.map((name) => (
              <span key={name} className="dept-chip">
                {name}
                <button type="button" aria-label={t('onb.micro.removeAria', { name })} onClick={() => toggle(name)}>
                  <IconX size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {mine && (
        <div className="onb-micro-group">
          <p className="onb-field-label">{t('onb.micro.mine', { group: mine[0].slice(DEPARTMENT_MD_PREFIX.length).replace(/^\s*·\s*/, '') })}</p>
          {mine[1].map((m) => (
            <MicroDegreeRow key={m.name} option={m} checked={chosen.has(m.name)} onToggle={toggle} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <>
          {mine && <p className="onb-field-label">{t('onb.micro.others')}</p>}
          <div className="onb-college-tree">
            {others.map(([group, items]) => {
              const open = openGroups.has(group);
              const picked = items.filter((m) => chosen.has(m.name)).length;
              return (
                <div key={group} className="onb-college-group">
                  <button type="button" className={'onb-college-head' + (open ? ' open' : '')} onClick={() => toggleGroup(group)} aria-expanded={open}>
                    <span className="onb-college-name">{group}</span>
                    <span className="onb-college-count">{picked > 0 ? t('onb.micro.groupPicked', { picked, n: items.length }) : items.length}</span>
                    <span className="onb-college-chevron" aria-hidden="true">
                      {open ? '▾' : '▸'}
                    </span>
                  </button>
                  {open && (
                    <div className="onb-college-body">
                      {items.map((m) => (
                        <MicroDegreeRow key={m.name} option={m} checked={chosen.has(m.name)} onToggle={toggle} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {searchOpen && (
        <SearchScreen search={search} onClose={dismissSearch} placeholder={t('onb.micro.searchPlaceholder')} ariaLabel={t('onb.micro.search')}>
          {renderResults()}
        </SearchScreen>
      )}
    </div>
  );
}

export default MicroDegreePicker;
