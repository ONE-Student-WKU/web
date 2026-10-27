import React, { useEffect, useState } from 'react';
import { getAdminSanctions, liftSanction, withdrawSanction, deleteWarning } from '../../api/chatApi.js';
import AdminTabs from './AdminTabs.jsx';
import { formatDate, remainingLabel, sanctionState, SANCTION_SCOPE_LABEL, SANCTION_STATE_LABEL, warningSeenLabel } from './adminFormat.js';

const STATUS_TABS = [
  { key: 'active', label: '적용 중' },
  { key: 'past', label: '지난 제재' },
];

// 지난 제재 목록에는 경고(kind: 'warning')가 섞여 와서 id가 겹칠 수 있다 — 행마다 종류를 붙인 키를 쓴다.
const rowKey = (s) => `${s.kind === 'warning' ? 'w' : 's'}-${s.id}`;

// 해제 확인 문구의 "바로 ~할 수 있게 돼요".
function liftEffect(scope) {
  if (scope === 'account') return '서비스를 다시 이용할';
  if (scope === 'full') return '커뮤니티에 들어올';
  return '글쓰기·신청을 할';
}

/**
 * AdminSanctions
 * 관리자 제재 관리 — 적용 중(남은 기간, 어떤 신고에서 이어졌는지)과 지난 제재(해제·기간 종료·경고). 처리는 모두 한 번 더 확인한다.
 * - 기간 전에 해제: 위반은 맞지만 일찍 풀어 준다 — 기록은 "해제됨"으로 남는다.
 * - 잘못된 조치로 철회 / 경고 취소: 이의를 받아들이는 등 조치가 잘못됐을 때 — 기록을 지워 제재 이력·반복 판단에서 빠진다.
 *
 * Props:
 * - showToast(message)
 */
function AdminSanctions({ showToast }) {
  const [status, setStatus] = useState('active');
  const [sanctions, setSanctions] = useState(null);
  const [error, setError] = useState(null);
  // { key, action: 'lift' | 'withdraw' | 'cancelWarning' } — 확인을 띄운 행과 동작
  const [confirm, setConfirm] = useState(null);
  const [actionKey, setActionKey] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSanctions(null);
    setError(null);
    setConfirm(null);
    getAdminSanctions(status)
      .then((list) => !cancelled && setSanctions(list))
      .catch(() => !cancelled && setError('제재 목록을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'));
    return () => {
      cancelled = true;
    };
  }, [status]);

  const runAction = async (s, action) => {
    const key = rowKey(s);
    setActionKey(key);
    setError(null);
    try {
      if (action === 'lift') await liftSanction(s.id);
      else if (action === 'withdraw') await withdrawSanction(s.id);
      else await deleteWarning(s.id);
      // 해제한 제재는 "지난 제재"로 옮겨 가고, 철회·취소한 기록은 지워진다 — 어느 쪽이든 지금 목록에서는 빠진다.
      setSanctions((prev) => prev.filter((row) => rowKey(row) !== key));
      setConfirm(null);
      showToast(action === 'lift' ? '제재를 해제했어요.' : action === 'withdraw' ? '제재를 철회했어요.' : '경고를 취소했어요.');
    } catch {
      setError('처리하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setActionKey(null);
    }
  };

  function confirmText(s, action) {
    if (action === 'lift') {
      return (
        <>
          <b>{s.student}</b>의 제재를 지금 해제할까요? 바로 {liftEffect(s.scope)} 수 있게 돼요.
        </>
      );
    }
    if (action === 'withdraw') {
      return (
        <>
          <b>{s.student}</b>의 제재를 철회할까요? 잘못된 조치로 보고 기록을 지워요 — 제재 이력에서도 빠지고 되돌릴 수 없어요.
          {s.reportId ? ' 신고로 지워진 글은 돌아오지 않아요.' : ''}
        </>
      );
    }
    return (
      <>
        <b>{s.student}</b>의 경고를 취소할까요? 기록을 지워 경고 횟수에서 빠지고 되돌릴 수 없어요.
      </>
    );
  }

  const confirmLabel = { lift: '해제', withdraw: '철회', cancelWarning: '경고 취소' };

  return (
    <>
      <AdminTabs
        tabs={STATUS_TABS.map((t) => ({ ...t, count: t.key === 'active' && status === 'active' ? sanctions?.length : null }))}
        active={status}
        onChange={setStatus}
        label="제재 상태"
      />
      {error && <p className="home-error admin-pad">{error}</p>}
      {!sanctions ? (
        <p className="courses-manual-hint admin-pad">불러오는 중...</p>
      ) : sanctions.length === 0 ? (
        <p className="courses-manual-hint admin-pad">{status === 'active' ? '지금 제재 중인 계정이 없어요.' : '지난 제재가 없어요.'}</p>
      ) : (
        <div className="admin-rows">
          {sanctions.map((s) => {
            const key = rowKey(s);
            const isWarning = s.kind === 'warning';
            const state = isWarning ? null : sanctionState(s);
            const pending = confirm && confirm.key === key ? confirm.action : null;
            return (
              <div className="post-row post-row--static admin-row" key={key}>
                <span className="admin-row-top">
                  <span className={`post-status ${state === 'active' ? 'post-status--no' : 'post-status--mute'}`}>
                    {isWarning ? `경고 · ${warningSeenLabel(s)}` : SANCTION_SCOPE_LABEL[s.scope] || s.scope}
                    {!isWarning && state !== 'active' && ` · ${SANCTION_STATE_LABEL[state]}`}
                  </span>
                  <span className="post-meta">
                    {isWarning
                      ? formatDate(s.createdAt)
                      : state === 'active'
                        ? remainingLabel(s.endsAt)
                        : `${formatDate(s.startsAt)} ~ ${s.liftedAt ? `${formatDate(s.liftedAt)} 해제` : s.endsAt ? formatDate(s.endsAt) : '영구'}`}
                  </span>
                </span>
                <span className="post-title">{s.student}</span>
                <span className="post-meta">
                  사유 {s.reason}
                  {s.reportId ? ' · 신고에서 이어짐' : ''}
                </span>
                {pending ? (
                  <span className="admin-confirm">
                    <span>{confirmText(s, pending)}</span>
                    <span className="admin-actions">
                      <button type="button" className="post-btn post-btn--text" onClick={() => setConfirm(null)}>
                        취소
                      </button>
                      <button
                        type="button"
                        className={`post-btn ${pending === 'lift' ? 'post-btn--ink' : 'post-btn--danger'}`}
                        onClick={() => runAction(s, pending)}
                        disabled={actionKey === key}
                      >
                        {confirmLabel[pending]}
                      </button>
                    </span>
                  </span>
                ) : (
                  <span className="admin-actions left">
                    {state === 'active' && (
                      <button type="button" className="post-btn post-btn--outline" onClick={() => setConfirm({ key, action: 'lift' })}>
                        기간 전에 해제
                      </button>
                    )}
                    <button
                      type="button"
                      className="post-btn post-btn--text"
                      onClick={() => setConfirm({ key, action: isWarning ? 'cancelWarning' : 'withdraw' })}
                    >
                      {isWarning ? '경고 취소' : '잘못된 조치로 철회'}
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default AdminSanctions;
