import React, { useEffect, useState } from 'react';
import { getAdminInquiries, getReportedStudentSummary, resolveAdminInquiry } from '../../api/chatApi.js';
import { refreshAdminPending } from '../../utils/adminPending.js';
import StudentSanctionDialog from '../StudentSanctionDialog.jsx';
import AdminTabs from './AdminTabs.jsx';
import { formatDate, SANCTION_SCOPE_LABEL } from './adminFormat.js';

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
// 문의 답변으로 보낸 경고는 제재가 아니라 여기 세지 않는다.
function sanctionLine(summary) {
  const active = summary.sanctions.filter((s) => s.state === 'active');
  const now = active.length
    ? `적용 중: ${active.map((s) => `${SANCTION_SCOPE_LABEL[s.scope] || s.scope}(~${s.endsAt ? formatDate(s.endsAt) : '영구'})`).join(', ')}`
    : '지금 적용 중인 제재 없음';
  return `제재 이력 ${summary.sanctions.length}건 · ${now}`;
}

/**
 * AdminInquiries
 * 관리자 문의함 — 목록에서 문의를 누르면 상세에서 학생의 학과·학번을 같이 보고, 답변을 적어 "답변 보내고 처리완료" 한 번으로 끝낸다.
 * 답변은 문의한 학생의 "내 문의"에 보인다. 비워 두면 답변 없이 처리완료만 표시된다.
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

  if (inquiry) {
    const open = inquiry.status === 'open';
    return (
      <>
        <div className="admin-detail">
          <div className="admin-row-top">
            <span className={`post-status ${open ? 'post-status--wait' : 'post-status--ok'}`}>{open ? '답변 대기' : '처리완료'}</span>
            <span className="post-meta">{formatDate(inquiry.createdAt)}</span>
          </div>
          <p className="admin-detail-title">{inquiry.title}</p>
          <p className="post-meta">{askerOf(inquiry)}</p>
          {inquiry.studentId != null && (
            <div className="admin-inquiry-sanction">
              <span className="post-meta">{summary ? sanctionLine(summary) : '제재 이력 불러오는 중...'}</span>
              <button type="button" className="post-btn post-btn--outline" onClick={() => setSanctionOpen(true)}>
                학생 제재
              </button>
            </div>
          )}
          <p className="admin-body admin-body--lead">{inquiry.content}</p>
          {error && <p className="home-error">{error}</p>}
          {open ? (
            <>
              <label className="admin-section" htmlFor="inquiry-note">
                학생에게 보낼 답변 <small>문의한 학생의 "내 문의"에 보여요</small>
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
            onClose={() => setSanctionOpen(false)}
            onDone={() => {
              setSanctionOpen(false);
              setSummaryVersion((v) => v + 1);
              showToast('제재를 적용했어요.');
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
                <span className={`post-status ${status === 'open' ? 'post-status--wait' : 'post-status--ok'}`}>{status === 'open' ? '답변 대기' : '처리완료'}</span>
                <span className="post-meta">{formatDate(i.createdAt)}</span>
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
