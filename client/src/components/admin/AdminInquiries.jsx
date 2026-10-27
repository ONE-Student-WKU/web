import React, { useEffect, useState } from 'react';
import { getAdminInquiries, getReportedStudentSummary, resolveAdminInquiry, withdrawSanction } from '../../api/chatApi.js';
import { refreshAdminPending } from '../../utils/adminPending.js';
import StudentSanctionDialog from '../StudentSanctionDialog.jsx';
import AdminTabs from './AdminTabs.jsx';
import { formatDate, SANCTION_SCOPE_LABEL, parseSuggestedAction } from './adminFormat.js';
import { AiSuggestionBadge, AiSuggestionBox, HighlightedText } from './AiSuggestion.jsx';

const NOTE_MAX_LENGTH = 500;
const STATUS_TABS = [
  { key: 'open', label: '답변 대기' },
  { key: 'resolved', label: '처리완료' },
];

// 문의한 학생 — 닉네임 · 학과 · 학번(졸업요건·과목 문의에 답할 때 필요). 서버가 학과·학번을 안 주는 예전 응답이면 닉네임만.
function askerOf(i) {
  return [i.student, i.department, i.admissionYear ? `${i.admissionYear}학번` : null].filter(Boolean).join(' · ');
}

// 문의한 학생의 제재 이력 한 줄 — 문의하기 욕설은 반복 여부로 조치를 올리므로(docs/moderation-policy.md) 답하기 전에 본다.
// 경고는 [학생 제재]에서 "경고"로 보낸 것만 센다(문의 답변에 쓴 글은 경고로 기록되지 않는다).
function sanctionLine(summary) {
  const active = summary.sanctions.filter((s) => s.state === 'active');
  const now = active.length
    ? `적용 중: ${active.map((s) => `${SANCTION_SCOPE_LABEL[s.scope] || s.scope}(~${s.endsAt ? formatDate(s.endsAt) : '영구'})`).join(', ')}`
    : '지금 적용 중인 제재 없음';
  return `경고 ${summary.warnings?.length ?? 0}회 · 제재 이력 ${summary.sanctions.length}건 · ${now}`;
}

/**
 * AdminInquiries
 * 관리자 문의함 — 목록에서 문의를 누르면 상세에서 학생의 학과·학번을 같이 보고, 답변을 적어 "답변 보내고 처리완료" 한 번으로 끝낸다.
 * 답변은 문의한 학생의 "내 문의"에 보인다. 비워 두면 답변 없이 처리완료만 표시된다.
 * 정지 화면에서 보낸 이의 제기(appealFor)는 어느 정지에 대한 것인지 보여주고, 받아들이면 바로 철회한다. 답변은 학생의 정지 화면에도 보인다.
 *
 * Props:
 * - detailId: 상세로 연 문의 id(없으면 목록)
 * - onOpenDetail(id) / onCloseDetail()
 * - showToast(message)
 */
function AdminInquiries({ detailId, onOpenDetail, onCloseDetail, showToast }) {
  const [status, setStatus] = useState('open');
  const [inquiries, setInquiries] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setInquiries(null);
    setError(null);
    getAdminInquiries(status)
      .then((list) => !cancelled && setInquiries(list))
      .catch(() => !cancelled && setError('문의 목록을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'));
    return () => {
      cancelled = true;
    };
  }, [status]);

  const inquiry = detailId != null && inquiries ? inquiries.find((i) => i.id === detailId) : null;
  const missing = Boolean(detailId != null && inquiries && !inquiry);
  useEffect(() => {
    if (missing) onCloseDetail();
  }, [missing, onCloseDetail]);
  useEffect(() => setNote(''), [detailId]);

  // 상세로 연 문의의 학생 제재 이력(#457). 제재를 걸면 summaryVersion을 올려 다시 불러온다.
  const studentId = inquiry?.studentId ?? null;
  const [summary, setSummary] = useState(null);
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [sanctionOpen, setSanctionOpen] = useState(false);
  // 정지 이의 제기를 받아들일 때의 철회 확인
  const [withdrawConfirm, setWithdrawConfirm] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  useEffect(() => setWithdrawConfirm(false), [detailId]);
  useEffect(() => {
    if (studentId == null) return undefined;
    let cancelled = false;
    setSummary(null);
    getReportedStudentSummary(studentId)
      .then((data) => !cancelled && setSummary(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [studentId, summaryVersion]);

  const handleResolve = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await resolveAdminInquiry(inquiry.id, note.trim() || null);
      setInquiries((prev) => prev.filter((i) => i.id !== inquiry.id));
      onCloseDetail();
      showToast('처리완료로 표시했어요.');
      refreshAdminPending();
    } catch {
      setError('처리하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    setWithdrawing(true);
    setError(null);
    try {
      await withdrawSanction(inquiry.appealFor.id);
      // 철회하면 서버에서 문의와 정지의 연결이 끊긴다 — 화면도 같이 지운다.
      setInquiries((prev) => prev.map((i) => (i.id === inquiry.id ? { ...i, appealFor: null } : i)));
      setWithdrawConfirm(false);
      setSummaryVersion((v) => v + 1);
      showToast('정지를 철회했어요. 답변을 남기고 처리완료해 주세요.');
    } catch {
      setError('철회하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setWithdrawing(false);
    }
  };

  if (inquiry) {
    const open = inquiry.status === 'open';
    const appeal = inquiry.appealFor;
    const suggestedAction = inquiry.aiSuggestion?.action;
    const suggested = parseSuggestedAction(suggestedAction);
    const suggestedScope = suggested ? suggested.scope : 'warning';
    const suggestedDuration = suggested ? suggested.duration : undefined;
    return (
      <>
        <div className="admin-detail">
          <div className="admin-row-top">
            <span className={`post-status ${open ? 'post-status--wait' : 'post-status--ok'}`}>
              {open ? '답변 대기' : '처리완료'}
              {appeal ? ' · 정지 이의' : ''}
            </span>
            <span className="post-meta">{formatDate(inquiry.createdAt)}</span>
            {open && <AiSuggestionBadge suggestion={inquiry.aiSuggestion} />}
          </div>
          <p className="admin-detail-title">{inquiry.title}</p>
          <p className="post-meta">{askerOf(inquiry)}</p>
          {appeal && (
            // 정지 화면에서 보낸 이의 제기 — 받아들이면 여기서 바로 철회한다(기록이 지워져 반복 판단에서 빠진다).
            <div className="admin-reject-reason admin-appeal">
              <span>
                <b>이의 대상</b> · {SANCTION_SCOPE_LABEL[appeal.scope] || appeal.scope}(~{appeal.endsAt ? formatDate(appeal.endsAt) : '영구'})
                {appeal.liftedAt ? ' · 해제됨' : ''}
              </span>
              <span className="post-meta">사유 {appeal.reason}</span>
              {withdrawConfirm ? (
                <span className="admin-confirm">
                  <span>정지를 철회할까요? 잘못된 조치로 보고 기록을 지워요. 학생은 바로 서비스를 다시 이용할 수 있고, 되돌릴 수 없어요.</span>
                  <span className="admin-actions">
                    <button type="button" className="post-btn post-btn--text" onClick={() => setWithdrawConfirm(false)}>
                      취소
                    </button>
                    <button type="button" className="post-btn post-btn--danger" onClick={handleWithdraw} disabled={withdrawing}>
                      철회
                    </button>
                  </span>
                </span>
              ) : (
                <span className="admin-actions left">
                  <button type="button" className="post-btn post-btn--outline" onClick={() => setWithdrawConfirm(true)}>
                    이의 받아들이고 정지 철회
                  </button>
                </span>
              )}
            </div>
          )}
          {inquiry.studentId != null && (
            <div className="admin-inquiry-sanction">
              <span className="post-meta">{summary ? sanctionLine(summary) : '제재 이력 불러오는 중...'}</span>
              <button type="button" className="post-btn post-btn--outline" onClick={() => setSanctionOpen(true)}>
                학생 제재
              </button>
            </div>
          )}
          <p className="admin-body admin-body--lead">
            <HighlightedText text={inquiry.content} highlights={open ? inquiry.aiSuggestion?.highlights : []} />
          </p>
          {open && <AiSuggestionBox suggestion={inquiry.aiSuggestion} openLabel="학생 제재" />}
          {error && <p className="home-error">{error}</p>}
          {open ? (
            <>
              <label className="admin-section" htmlFor="inquiry-note">
                학생에게 보낼 답변 <small>{appeal ? '정지 화면과 "내 문의"에 보여요' : '문의한 학생의 "내 문의"에 보여요'}</small>
              </label>
              <textarea id="inquiry-note" className="post-input admin-textarea" rows={4} maxLength={NOTE_MAX_LENGTH} value={note} onChange={(e) => setNote(e.target.value)} />
              <p className="courses-manual-hint">어떻게 처리했는지 알려주세요. 비워 두면 답변 없이 처리완료로만 표시돼요.</p>
            </>
          ) : (
            <>
              <p className="admin-section">보낸 답변</p>
              <p className="admin-body">{inquiry.resolutionNote || '(답변 없이 처리완료)'}</p>
            </>
          )}
        </div>
        {sanctionOpen && (
          <StudentSanctionDialog
            studentId={inquiry.studentId}
            nickname={inquiry.student}
            title="학생 제재"
            // AI 제안(#458)이 있으면 그 범위·기간을 미리 골라 두고, 없으면 문의의 첫 조치인 경고(docs/moderation-policy.md).
            defaultScope={suggestedScope}
            defaultDuration={suggestedDuration}
            onClose={() => setSanctionOpen(false)}
            onDone={(scope) => {
              setSanctionOpen(false);
              setSummaryVersion((v) => v + 1);
              showToast(scope === 'warning' ? '경고를 보냈어요.' : '제재를 적용했어요.');
            }}
          />
        )}
        {open && (
          <div className="admin-dock">
            <button type="button" className="post-btn post-btn--ink post-btn--lg post-btn--block" onClick={handleResolve} disabled={submitting}>
              {submitting ? '처리하는 중...' : note.trim() ? '답변 보내고 처리완료' : '답변 없이 처리완료'}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <AdminTabs
        tabs={STATUS_TABS.map((t) => ({ ...t, count: t.key === 'open' && status === 'open' ? inquiries?.length : null }))}
        active={status}
        onChange={setStatus}
        label="문의 상태"
      />
      {error && <p className="home-error admin-pad">{error}</p>}
      {!inquiries ? (
        <p className="courses-manual-hint admin-pad">불러오는 중...</p>
      ) : inquiries.length === 0 ? (
        <p className="courses-manual-hint admin-pad">{status === 'open' ? '답변을 기다리는 문의가 없어요.' : '처리완료된 문의가 없어요.'}</p>
      ) : (
        <div className="admin-rows">
          {inquiries.map((i) => (
            <button type="button" className="post-row admin-row" key={i.id} onClick={() => onOpenDetail(i.id)}>
              <span className="admin-row-top">
                <span className={`post-status ${status === 'open' ? 'post-status--wait' : 'post-status--ok'}`}>
                  {status === 'open' ? '답변 대기' : '처리완료'}
                  {i.appealFor ? ' · 정지 이의' : ''}
                </span>
                <span className="post-meta">{formatDate(i.createdAt)}</span>
                {status === 'open' && <AiSuggestionBadge suggestion={i.aiSuggestion} />}
              </span>
              <span className="post-title">{i.title}</span>
              <span className="post-excerpt">{i.content}</span>
              <span className="post-meta">{status === 'resolved' ? `보낸 답변 · ${i.resolutionNote || '(답변 없이 처리완료)'}` : askerOf(i)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default AdminInquiries;
