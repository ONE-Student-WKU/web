import React, { useEffect, useState } from 'react';
import { getReportedStudentSummary, sanctionStudent } from '../api/chatApi.js';
import { IconAlertTriangle } from './icons.jsx';

/**
 * StudentSanctionDialog
 * 커뮤니티 글에서 작성자를 눌렀을 때 열리는 관리자 전용 팝업 — 작성자 요약을 보고 바로 제재한다(신고 없이).
 * 신고함의 제재와 달리 글/신청을 지우거나 신고를 처리완료로 바꾸는 부수 효과는 없다(글은 승인·삭제 흐름으로 따로 다룬다).
 *
 * 관리자 전용 도구라 Admin.jsx와 같이 한국어 문구를 그대로 쓴다(번역 사전 대상 아님).
 *
 * Props:
 * 문의 상세(AdminInquiries.jsx)에서도 문의한 학생을 바로 제재할 때 같은 팝업을 쓴다(#457 — 문의하기 욕설은 커뮤니티 밖 위반).
 *
 * Props:
 * - studentId: number — 제재 대상 계정 id (서버가 관리자 요청에만 내려주는 글의 authorId·문의의 studentId)
 * - nickname: string — 화면 표시용
 * - title: string (선택) — 팝업 제목(기본 "작성자 제재")
 * - onClose: function
 * - onDone: function — 제재가 적용된 뒤 호출(팝업은 호출부가 닫는다)
 */

// 제재 사유 기본값 — 사유는 제재받는 사용자에게 그대로 보이므로 중립 고정 문구로 두고 필요하면 관리자가 고쳐 쓴다(Admin.jsx와 같은 기준).
const DEFAULT_REASON = '커뮤니티 운영 정책 위반';
const DURATIONS = [
  { value: '1d', label: '1일' },
  { value: '3d', label: '3일' },
  { value: '7d', label: '7일' },
  { value: '30d', label: '30일' },
  { value: 'permanent', label: '영구정지' },
];
const SCOPES = [
  { value: 'post_apply', label: '경고성 (글쓰기·신청 금지)' },
  { value: 'full', label: '전면 정지 (커뮤니티 진입 차단)' },
  { value: 'account', label: '계정 정지 (서비스 전체 이용 차단)' },
];
const SCOPE_LABEL = { post_apply: '경고성', full: '전면 정지', account: '계정 정지' };
const STATE_LABEL = { active: '적용 중', lifted: '해제됨', expired: '기간 종료' };
const ERROR_TEXT = {
  CANNOT_SANCTION_ADMIN: '관리자 계정은 제재할 수 없어요.',
  STUDENT_NOT_FOUND: '대상 계정을 찾지 못했어요.',
};

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function StudentSanctionDialog({ studentId, nickname, title = '작성자 제재', onClose, onDone }) {
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [scope, setScope] = useState('post_apply');
  const [duration, setDuration] = useState('7d');
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getReportedStudentSummary(studentId)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setSummaryError('작성자 정보를 불러오지 못했어요. 제재는 그대로 할 수 있어요.');
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await sanctionStudent(studentId, { scope, duration, reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(ERROR_TEXT[err.code] || '제재를 적용하지 못했어요. 잠시 후 다시 시도해주세요.');
      setSubmitting(false);
    }
  }

  const activeSanctions = summary ? summary.sanctions.filter((s) => s.state === 'active') : [];

  return (
    <div className="career-confirm-overlay" onClick={onClose}>
      <form className="career-confirm-modal student-sanction-dialog" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <p className="admin-post-title">{title}</p>
        <p className="community-detail-meta">
          대상 · <b>{nickname}</b>
        </p>

        {summaryError && <p className="home-error">{summaryError}</p>}
        {summary && (
          <>
            <p className="community-detail-meta">
              {summary.department || '학과 미등록'}
              {summary.admissionYear ? ` · ${summary.admissionYear}학년도 입학` : ''} · 가입 {formatDate(summary.joinedAt)}
            </p>
            <p className="community-detail-meta">
              작성한 글 {summary.postCount}개 · 낸 신청 {summary.applicationCount}건 · 받은 신고 {summary.reportsReceived.total}건 (대기{' '}
              {summary.reportsReceived.pending}건) · 제재 이력 {summary.sanctions.length}건
            </p>
            {activeSanctions.length > 0 && (
              <div className="admin-reject-reason" style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <IconAlertTriangle size={16} />
                <span>
                  이미 적용 중인 제재가 있어요 —{' '}
                  {activeSanctions.map((s) => `${SCOPE_LABEL[s.scope] || s.scope}(${STATE_LABEL[s.state]}, ~${s.endsAt ? formatDate(s.endsAt) : '영구'})`).join(', ')}
                </span>
              </div>
            )}
          </>
        )}

        <p className="community-section-label">범위</p>
        <div className="admin-sub-tabs" style={{ flexWrap: 'wrap' }}>
          {SCOPES.map((s) => (
            <button key={s.value} type="button" className={`admin-sub-tab ${scope === s.value ? 'active' : ''}`} onClick={() => setScope(s.value)}>
              {s.label}
            </button>
          ))}
        </div>

        <p className="community-section-label">기간</p>
        <div className="admin-sub-tabs" style={{ flexWrap: 'wrap' }}>
          {DURATIONS.map((d) => (
            <button key={d.value} type="button" className={`admin-sub-tab ${duration === d.value ? 'active' : ''}`} onClick={() => setDuration(d.value)}>
              {d.label}
            </button>
          ))}
        </div>

        <div className="auth-field">
          <label htmlFor="direct-sanction-reason">제재 사유 (사용자에게 보여요)</label>
          <textarea id="direct-sanction-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </div>
        <p className="courses-manual-hint">
          {scope === 'account'
            ? '로그아웃·계정 삭제 말고는 모든 기능이 막혀요. 이 학생의 모집 글은 정지 동안 목록에서 숨겨져요.'
            : '글은 지워지지 않아요. 글 처리는 커뮤니티 관리(승인·삭제)에서 따로 해주세요.'}
        </p>

        {error && <p className="home-error">{error}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button type="submit" className="community-close-btn" disabled={submitting || !reason.trim()}>
            {submitting ? '적용하는 중...' : '제재 확정'}
          </button>
          <button type="button" className="community-outline-btn" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </div>
  );
}

export default StudentSanctionDialog;
