import React, { useState } from 'react';
import { updateProfile } from '../api/chatApi.js';
import { TAB_ICONS } from '../components/BottomTabBar.jsx';
import { IconChevronLeft, IconMessageCircle } from '../components/icons.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import { resolveLayout, isDefaultLayout, TAB_OPTIONS, TAB_SLOTS, TAB_LABEL_KEYS } from '../utils/homeLayout.js';

/**
 * HomeEdit Page
 * 홈 화면 편집 — 하단 바를 켜고 끄고, 켰을 때 가운데 챗봇 버튼을 뺀 4칸(홈 포함)을 고른다. 홈 헤더의 편집 버튼으로 들어온다.
 * 하단 바를 끄면 챗봇 버튼까지 모든 화면에서 사라진다(챗봇을 쓰지 않는 사용자를 위한 선택 — 다시 켜면 돌아온다).
 * 저장하면 계정(students.home_layout)에 남아 기기가 바뀌어도 같다. 기본 배치와 같으면 null로 보내 "편집한 적 없음"과 같게 둔다.
 * 홈 카드(진행률·부족 요건·메뉴)는 고정이라 여기서 다루지 않는다.
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
  // 하단 바를 켰으면 4칸이 다 차야 저장한다. 끈 상태에서는 칸 편집이 보이지 않으니, 덜 찬 칸은 저장할 때 기본 칸으로 채운다.
  const canSave = !draft.showTabBar || draft.tabs.length === TAB_SLOTS;

  const move = (index, dir) => {
    const next = [...draft.tabs];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft((d) => ({ ...d, tabs: next }));
  };
  const setTabs = (tabs) => setDraft((d) => ({ ...d, tabs }));

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(false);
    try {
      const layout = draft.tabs.length === TAB_SLOTS ? draft : { ...draft, tabs: resolveLayout(null).tabs };
      onSaved(await updateProfile({ homeLayout: isDefaultLayout(layout) ? null : layout }));
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
  const tabNames = draft.tabs.map((v) => t(TAB_LABEL_KEYS[v]));

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
            <p className="settings-field-hint">{t('homeEdit.tabs.sub', { count: draft.tabs.length })}</p>
            <div
              className="bottom-tab-bar home-edit-preview"
              role="img"
              aria-label={t('homeEdit.preview', { left: tabNames.slice(0, 2).join(', '), right: tabNames.slice(2).join(', ') })}
            >
              {slot(draft.tabs[0], 's0')}
              {slot(draft.tabs[1], 's1')}
              <span className="bottom-tab-chat">
                <IconMessageCircle size={20} />
              </span>
              {slot(draft.tabs[2], 's2')}
              {slot(draft.tabs[3], 's3')}
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
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('homeEdit.moveUp', { name })}>
                        ↑
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === draft.tabs.length - 1} aria-label={t('homeEdit.moveDown', { name })}>
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
        )}

        {error && <p className="home-error">{t('homeEdit.err')}</p>}

        <button type="button" className="auth-submit-btn" onClick={handleSave} disabled={saving || !canSave}>
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
