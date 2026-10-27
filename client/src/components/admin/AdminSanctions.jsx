import React, { useEffect, useState } from 'react';
import { getAdminSanctions, liftSanction } from '../../api/chatApi.js';
import AdminTabs from './AdminTabs.jsx';
import { formatDate, remainingLabel, sanctionState, SANCTION_SCOPE_LABEL, SANCTION_STATE_LABEL } from './adminFormat.js';

const STATUS_TABS = [
  { key: 'active', label: '적용 중' },
  { key: 'past', label: '지난 제재' },
];

/**
 * AdminSanctions
 * 관리자 제재 관리 — 적용 중(남은 기간, 어떤 신고에서 이어졌는지)과 지난 제재(해제·기간 종료). "기간 전에 해제"는 한 번 더 확인한다
 * (예전에는 누르면 바로 해제됐다).
 *
 * Props:
 * - showToast(message)
 */
function AdminSanctions({ showToast }) {
  const [status, setStatus] = useState('active');
  const [sanctions, setSanctions] = useState(null);
  const [error, setError] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [actionId, setActionId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSanctions(null);
    setError(null);
    setConfirmId(null);
    getAdminSanctions(status)
      .then((list) => !cancelled && setSanctions(list))
      .catch(() => !cancelled && setError('제재 목록을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'));
    return () => {
      cancelled = true;
    };
  }, [status]);

  const handleLift = async (id) => {
    setActionId(id);
    setError(null);
    try {
      await liftSanction(id);
      setSanctions((prev) => prev.filter((s) => s.id !== id));
      setConfirmId(null);
      showToast('제재를 해제했어요.');
    } catch {
      setError('해제하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setActionId(null);
    }
  };

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
            const state = sanctionState(s);
            return (
              <div className="post-row post-row--static admin-row" key={s.id}>
                <span className="admin-row-top">
                  <span className={`post-status ${state === 'active' ? 'post-status--no' : 'post-status--mute'}`}>
                    {SANCTION_SCOPE_LABEL[s.scope] || s.scope}
                    {state !== 'active' && ` · ${SANCTION_STATE_LABEL[state]}`}
                  </span>
                  <span className="post-meta">
                    {state === 'active'
                      ? remainingLabel(s.endsAt)
                      : `${formatDate(s.startsAt)} ~ ${s.liftedAt ? `${formatDate(s.liftedAt)} 해제` : s.endsAt ? formatDate(s.endsAt) : '영구'}`}
                  </span>
                </span>
                <span className="post-title">{s.student}</span>
                <span className="post-meta">
                  사유 {s.reason}
                  {s.reportId ? ' · 신고에서 이어짐' : ''}
                </span>
                {state === 'active' &&
                  (confirmId === s.id ? (
                    <span className="admin-confirm">
                      <span>
                        <b>{s.student}</b>의 제재를 지금 해제할까요? 바로 {s.scope === 'account' ? '서비스를 다시 이용할' : s.scope === 'full' ? '커뮤니티에 들어올' : '글쓰기·신청을 할'} 수 있게 돼요.
                      </span>
                      <span className="admin-actions">
                        <button type="button" className="post-btn post-btn--text" onClick={() => setConfirmId(null)}>
                          취소
                        </button>
                        <button type="button" className="post-btn post-btn--ink" onClick={() => handleLift(s.id)} disabled={actionId === s.id}>
                          해제
                        </button>
                      </span>
                    </span>
                  ) : (
                    <span className="admin-actions left">
                      <button type="button" className="post-btn post-btn--outline" onClick={() => setConfirmId(s.id)}>
                        기간 전에 해제
                      </button>
                    </span>
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default AdminSanctions;
