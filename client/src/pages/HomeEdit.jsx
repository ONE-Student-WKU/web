import React, { useState } from 'react';
import { updateProfile } from '../api/chatApi.js';
import { TAB_ICONS } from '../components/BottomTabBar.jsx';
import { IconChevronLeft, IconHome, IconMessageCircle } from '../components/icons.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import {
  resolveLayout,
  isDefaultLayout,
  TAB_OPTIONS,
  TAB_SLOTS,
  TAB_LABEL_KEYS,
  CARD_LABEL_KEYS,
  LOCKED_CARDS,
} from '../utils/homeLayout.js';

/**
 * HomeEdit Page
 * 홈 화면 편집 — 하단 바 3칸(홈·챗봇은 고정)과 홈 카드의 표시·순서를 고른다. 홈 헤더의 편집 버튼으로 들어온다.
 * 저장하면 계정(students.home_layout)에 남아 기기가 바뀌어도 같은 홈이 보인다. 기본 배치와 같으면 null로 보내
 * "편집한 적 없음"과 같게 둔다(나중에 기본값이 바뀌면 따라간다). 메뉴 카드는 모든 기능을 글자로 보여 주는 곳이라 숨길 수 없다.
 *
 * Props:
 * - user: 현재 학생(homeLayout)
 * - onCancel: function — 저장하지 않고 나가기
 * - onSaved(student): 저장된 뒤 서버가 돌려준 학생 정보로 호출
 */
function HomeEdit({ user, onCancel, onSaved }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => resolveLayout(user?.homeLayout));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const tabsFull = draft.tabs.length >= TAB_SLOTS;
  const available = TAB_OPTIONS.filter((v) => !draft.tabs.includes(v));

  const move = (list, index, dir) => {
    const next = [...list];
    const target = index + dir;
    if (target < 0 || target >= next.length) return list;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  };
  const setTabs = (tabs) => setDraft((d) => ({ ...d, tabs }));
  const setCards = (cards) => setDraft((d) => ({ ...d, cards: { ...d.cards, ...cards } }));
  const toggleCard = (id) =>
    setCards({ hidden: draft.cards.hidden.includes(id) ? draft.cards.hidden.filter((c) => c !== id) : [...draft.cards.hidden, id] });

  const handleSave = async () => {
    if (draft.tabs.length !== TAB_SLOTS) return;
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

  // 미리보기는 하단 바와 같은 모양의 아이콘만 그린다(누를 수 있는 버튼을 숨겨 두면 키보드·화면 읽기에서 문제가 된다). 빈 칸은 점선으로.
  const slot = (view, key) => {
    if (!view) return <span key={key} className="bottom-tab home-edit-preview-empty" />;
    const Icon = TAB_ICONS[view];
    return (
      <span key={key} className="bottom-tab">
        <Icon size={21} />
      </span>
    );
  };

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={onCancel} aria-label={t('homeEdit.cancel')}>
            <IconChevronLeft />
          </button>
          <span className="screen-title">{t('homeEdit.title')}</span>
        </div>
      </header>

      <div className="courses-body home-edit-body">
        <section className="home-card">
          <p className="home-card-label">{t('homeEdit.tabs.title')}</p>
          <p className="settings-field-hint">{t('homeEdit.tabs.sub', { count: draft.tabs.length })}</p>
          <div
            className="bottom-tab-bar home-edit-preview"
            role="img"
            aria-label={t('homeEdit.preview', { tabs: draft.tabs.map((v) => t(TAB_LABEL_KEYS[v])).join(', ') })}
          >
            <span className="bottom-tab">
              <IconHome size={21} />
            </span>
            {slot(draft.tabs[0], 's0')}
            <span className="bottom-tab-chat">
              <IconMessageCircle size={20} />
            </span>
            {slot(draft.tabs[1], 's1')}
            {slot(draft.tabs[2], 's2')}
          </div>

          <p className="home-edit-group-label">{t('homeEdit.tabs.selected')}</p>
          <ul className="home-edit-list">
            {draft.tabs.map((view, i) => {
              const Icon = TAB_ICONS[view];
              const name = t(TAB_LABEL_KEYS[view]);
              return (
                <li key={view} className="home-edit-row">
                  <span className="home-edit-row-name">
                    <Icon size={17} />
                    {name}
                  </span>
                  <span className="home-edit-row-actions">
                    <button type="button" onClick={() => setTabs(move(draft.tabs, i, -1))} disabled={i === 0} aria-label={t('homeEdit.moveUp', { name })}>
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => setTabs(move(draft.tabs, i, 1))}
                      disabled={i === draft.tabs.length - 1}
                      aria-label={t('homeEdit.moveDown', { name })}
                    >
                      ↓
                    </button>
                    <button type="button" onClick={() => setTabs(draft.tabs.filter((v) => v !== view))} aria-label={t('homeEdit.remove', { name })}>
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>

          {available.length > 0 && (
            <>
              <p className="home-edit-group-label">{t('homeEdit.tabs.available')}</p>
              <ul className="home-edit-list">
                {available.map((view) => {
                  const Icon = TAB_ICONS[view];
                  const name = t(TAB_LABEL_KEYS[view]);
                  return (
                    <li key={view} className="home-edit-row">
                      <span className="home-edit-row-name">
                        <Icon size={17} />
                        {name}
                      </span>
                      <button
                        type="button"
                        className="settings-theme-btn"
                        onClick={() => setTabs([...draft.tabs, view])}
                        disabled={tabsFull}
                        aria-label={t('homeEdit.add', { name })}
                      >
                        {t('homeEdit.addShort')}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {tabsFull && <p className="settings-field-hint">{t('homeEdit.tabs.full')}</p>}
            </>
          )}
        </section>

        <section className="home-card">
          <p className="home-card-label">{t('homeEdit.cards.title')}</p>
          <p className="settings-field-hint">{t('homeEdit.cards.sub')}</p>
          <ul className="home-edit-list">
            {draft.cards.order.map((id, i) => {
              const name = t(CARD_LABEL_KEYS[id]);
              const locked = LOCKED_CARDS.includes(id);
              return (
                <li key={id} className="home-edit-row">
                  {locked ? (
                    <span className="home-edit-row-name">
                      {name}
                      <span className="home-edit-locked">{t('homeEdit.cards.always')}</span>
                    </span>
                  ) : (
                    <label className="home-edit-row-name">
                      <input type="checkbox" checked={!draft.cards.hidden.includes(id)} onChange={() => toggleCard(id)} />
                      {name}
                    </label>
                  )}
                  <span className="home-edit-row-actions">
                    <button
                      type="button"
                      onClick={() => setCards({ order: move(draft.cards.order, i, -1) })}
                      disabled={i === 0}
                      aria-label={t('homeEdit.moveUp', { name })}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => setCards({ order: move(draft.cards.order, i, 1) })}
                      disabled={i === draft.cards.order.length - 1}
                      aria-label={t('homeEdit.moveDown', { name })}
                    >
                      ↓
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {error && <p className="home-error">{t('homeEdit.err')}</p>}

        <button type="button" className="auth-submit-btn" onClick={handleSave} disabled={saving || draft.tabs.length !== TAB_SLOTS}>
          {saving ? t('homeEdit.saving') : t('homeEdit.save')}
        </button>
        <button type="button" className="onb-skip-link" onClick={() => setDraft(resolveLayout(null))} disabled={saving}>
          {t('homeEdit.reset')}
        </button>
      </div>
    </div>
  );
}

export default HomeEdit;
