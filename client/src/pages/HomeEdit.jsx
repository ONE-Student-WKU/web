import React, { useEffect, useState } from 'react';
import { updateProfile } from '../api/chatApi.js';
import { TAB_ICONS } from '../components/BottomTabBar.jsx';
import { IconChevronLeft, IconMessageCircle } from '../components/icons.jsx';
import useSwapSlots from '../hooks/useSwapSlots.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import { resolveLayout, isDefaultLayout, TAB_OPTIONS, MENU_VIEWS, TAB_LABEL_KEYS } from '../utils/homeLayout.js';

/**
 * HomeEdit Page
 * 홈 화면 편집 — 홈 메뉴 카드(위)와 하단 바(아래: 켜기·끄기, 챗봇 버튼을 뺀 4자리)를 바꾼다. 홈 헤더의 편집 버튼으로 들어온다.
 * - 하단 바: 4자리를 다 채우지 않아도 저장된다. 빈 자리는 null로 위치를 지키고, 모두 비우면 바 없이 챗봇 버튼만 남는다.
 *   기능 목록(한 줄에 하나)의 스위치로 넣고 빼며, 넣으면 첫 빈 자리에 들어가고 빼면 그 자리가 빈 자리가 된다.
 * - 메뉴: 기능 목록의 스위치로 카드를 넣고 빼며(넣으면 맨 끝, 빼면 뒤 카드가 당겨진다), 순서를 바꾼다. 모두 빼면 홈에 메뉴가 없다.
 *   하단 바와 따로 정한다(하단 바를 꺼도 메뉴는 홈에 있으니 이 영역은 항상 보인다).
 * - 자리 옮기기(두 미리보기 공통, hooks/useSwapSlots.js): 끌어서 다른 자리에 놓거나, 누른 뒤 다른 자리를 누르면 두 자리를 맞바꾼다.
 * 이수학점 진행률·부족 요건 카드는 고정이라 여기서 다루지 않는다. 메뉴와 하단 바를 모두 비워도 막지 않는다(이 화면에서 언제든 되돌린다).
 * 저장하면 계정(students.home_layout)에 남아 기기가 바뀌어도 같다. 기본 배치와 같으면 null로 보내 "편집한 적 없음"과 같게 둔다.
 * 저장 버튼은 목록이 길어도 화면 아래에 떠 있고, 바꾼 것을 저장하지 않고 나가려 하면(헤더 뒤로 버튼·뒤로가기) 한 번 묻는다
 * — 저장 버튼이 맨 아래에만 있어 바꿔 두고 그냥 나가는 흐름이 생길 수 있었다(2026-10-27 피드백).
 *
 * Props:
 * - user: 현재 학생(homeLayout)
 * - onCancel: function — 저장하지 않고 나가기
 * - onSaved(student): 저장된 뒤 서버가 돌려준 학생 정보로 호출
 * - leaveGuardRef: (선택) App의 뒤로가기 확인 자리 — 이 화면이 떠 있는 동안 "나가도 되는지" 함수를 넣어 둔다
 */
function HomeEdit({ user, onCancel, onSaved, leaveGuardRef }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => resolveLayout(user?.homeLayout));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(resolveLayout(user?.homeLayout));
  const confirmLeave = () => !dirty || window.confirm(t('homeEdit.confirmLeave'));
  const handleCancel = () => {
    if (confirmLeave()) onCancel();
  };

  useEffect(() => {
    if (!leaveGuardRef) return undefined;
    leaveGuardRef.current = confirmLeave;
    return () => {
      leaveGuardRef.current = null;
    };
  });

  const filledCount = draft.tabs.filter(Boolean).length;
  const emptyIndex = draft.tabs.indexOf(null);

  // draft[key]의 두 자리를 맞바꾼다(하단 바에서 빈 자리와 바꾸면 그 기능이 빈 자리로 옮겨 간다).
  const swapIn = (key) => (a, b) =>
    setDraft((d) => {
      const next = [...d[key]];
      [next[a], next[b]] = [next[b], next[a]];
      return { ...d, [key]: next };
    });
  const bar = useSwapSlots({ isMovable: (i) => Boolean(draft.tabs[i]), onSwap: swapIn('tabs'), dragScale: 0.8 });
  const menu = useSwapSlots({ isMovable: () => true, onSwap: swapIn('menu'), dragScale: 0.92 });

  // 하단 바 스위치: 켜면 첫 빈 자리에 넣고, 끄면 그 자리를 비운다.
  const toggleTab = (view, on) => {
    bar.clearSelection();
    setDraft((d) => {
      const next = [...d.tabs];
      if (on) {
        const empty = next.indexOf(null);
        if (empty === -1) return d;
        next[empty] = view;
      } else {
        next[next.indexOf(view)] = null;
      }
      return { ...d, tabs: next };
    });
  };

  // 메뉴 스위치: 켜면 맨 끝에 넣고, 끄면 빼서 뒤 카드가 앞으로 당겨진다(격자라 빈 자리를 두지 않는다).
  const toggleMenu = (view, on) => {
    menu.clearSelection();
    setDraft((d) => ({ ...d, menu: on ? [...d.menu, view] : d.menu.filter((v) => v !== view) }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(false);
    try {
      onSaved(await updateProfile({ homeLayout: isDefaultLayout(draft) ? null : draft }));
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const nameOf = (view) => (view ? t(TAB_LABEL_KEYS[view]) : t('homeEdit.slot.empty'));
  const stateClasses = (state) =>
    [state.selected && 'selected', state.dragging && 'dragging', state.dropTarget && 'drop-target'].filter(Boolean);

  // 하단 바 미리보기 자리 — 하단 바와 같은 모양의 버튼. 빈 자리는 점선.
  const barSlot = (index) => {
    const view = draft.tabs[index];
    const classes = ['bottom-tab', 'home-edit-slot', ...stateClasses(bar.slotState(index))];
    if (!view) classes.push('home-edit-preview-empty');
    const Icon = view ? TAB_ICONS[view] : null;
    return (
      <button
        key={index}
        type="button"
        className={classes.join(' ')}
        aria-label={t('homeEdit.slot.label', { n: index + 1, name: nameOf(view) })}
        {...bar.slotProps(index)}
      >
        {Icon && <Icon size={21} />}
      </button>
    );
  };

  // 기능 목록(한 줄에 하나) — 스위치로 넣고 뺀다. full이면 꺼진 기능은 켤 수 없다.
  const featureSwitches = (views, selectedViews, onToggle, full = false) => (
    <>
      <p className="home-edit-group-label">{t('homeEdit.features')}</p>
      <ul className="home-edit-list">
        {views.map((view) => {
          const Icon = TAB_ICONS[view];
          const on = selectedViews.includes(view);
          return (
            <li key={view}>
              <label className={on || !full ? 'home-edit-row' : 'home-edit-row disabled'}>
                <span className="home-edit-row-name">
                  <Icon size={17} />
                  {nameOf(view)}
                </span>
                <input type="checkbox" role="switch" checked={on} disabled={!on && full} onChange={(e) => onToggle(view, e.target.checked)} />
              </label>
            </li>
          );
        })}
      </ul>
    </>
  );

  const barHint =
    bar.selected !== null
      ? t('homeEdit.tabs.selecting', { name: nameOf(draft.tabs[bar.selected]) })
      : t(filledCount === 0 ? 'homeEdit.tabs.chatOnly' : 'homeEdit.tabs.move');

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={handleCancel} aria-label={t('homeEdit.cancel')}>
            <IconChevronLeft />
          </button>
          <span className="screen-title">{t('homeEdit.title')}</span>
        </div>
      </header>

      <div className="courses-body home-edit-body">
        <section className="home-card">
          <p className="home-card-label">{t('homeEdit.menu.title')}</p>
          <p className="settings-field-hint">{t('homeEdit.menu.sub')}</p>
          <div className={draft.menu.length ? 'home-quick-actions home-edit-menu' : 'home-edit-menu'} role="group" aria-label={t('homeEdit.menu.preview')}>
            {draft.menu.map((view, index) => {
              const Icon = TAB_ICONS[view];
              const classes = ['home-quick-btn', 'home-edit-slot', ...stateClasses(menu.slotState(index))];
              return (
                <button
                  key={view}
                  type="button"
                  className={classes.join(' ')}
                  aria-label={t('homeEdit.menu.label', { n: index + 1, name: nameOf(view) })}
                  {...menu.slotProps(index)}
                >
                  <Icon />
                  <span>{nameOf(view)}</span>
                </button>
              );
            })}
          </div>
          {draft.menu.length === 0 && <p className="settings-field-hint">{t('homeEdit.menu.empty')}</p>}
          {menu.selected !== null && (
            <p className="settings-field-hint" aria-live="polite">
              {t('homeEdit.tabs.selecting', { name: nameOf(draft.menu[menu.selected]) })}
            </p>
          )}
          {featureSwitches(MENU_VIEWS, draft.menu, toggleMenu)}
        </section>

        <section className="home-card">
          <label className="home-edit-toggle">
            <span>
              <span className="home-card-label">{t('homeEdit.showTabBar')}</span>
              <span className="settings-field-hint">{t(draft.showTabBar ? 'homeEdit.showTabBar.on' : 'homeEdit.showTabBar.off')}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={draft.showTabBar}
              onChange={(e) => setDraft((d) => ({ ...d, showTabBar: e.target.checked }))}
            />
          </label>
        </section>

        {draft.showTabBar && (
          <section className="home-card">
            <p className="home-card-label">{t('homeEdit.tabs.title')}</p>
            <p className="settings-field-hint">{t('homeEdit.tabs.sub', { count: filledCount })}</p>
            <div className="bottom-tab-bar home-edit-preview" role="group" aria-label={t('homeEdit.preview')}>
              {barSlot(0)}
              {barSlot(1)}
              <span className="bottom-tab-chat" aria-hidden="true">
                <IconMessageCircle size={20} />
              </span>
              {barSlot(2)}
              {barSlot(3)}
            </div>
            <p className="settings-field-hint" aria-live="polite">
              {barHint}
            </p>

            {featureSwitches(TAB_OPTIONS, draft.tabs, toggleTab, emptyIndex === -1)}
            {emptyIndex === -1 && <p className="settings-field-hint">{t('homeEdit.tabs.full')}</p>}
          </section>
        )}

        <button
          type="button"
          className="onb-skip-link"
          onClick={() => {
            bar.clearSelection();
            menu.clearSelection();
            setDraft(resolveLayout(null));
          }}
          disabled={saving}
        >
          {t('homeEdit.reset')}
        </button>

        {/* 저장 버튼은 온보딩 주 버튼처럼 화면 아래에 떠 있게 한다 — 내용 끝까지 내리지 않아도 보인다. */}
        <div className="onb-float-action">
          {error && <p className="home-error">{t('homeEdit.err')}</p>}
          <button type="button" className="auth-submit-btn" onClick={handleSave} disabled={saving}>
            {saving ? t('homeEdit.saving') : t('homeEdit.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default HomeEdit;
