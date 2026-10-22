import React, { useEffect, useMemo, useState } from 'react';
import { getAdminReports, resolveAdminReport, sanctionReport, getReportedStudentSummary } from '../../api/chatApi.js';
import { refreshAdminPending } from '../../utils/adminPending.js';
import AdminSheet from './AdminSheet.jsx';
import AdminTabs from './AdminTabs.jsx';
import { formatDate, SANCTION_SCOPE_LABEL, SANCTION_STATE_LABEL, sanctionState } from './adminFormat.js';
import { IconChevronRight } from '../icons.jsx';

// 제재 사유 입력란의 기본값. 신고자가 쓴 신고 사유를 그대로 채우면 그 말이 제재받는 사용자에게 "제재 사유"로 전달된다
// (사용자 화면의 제재 안내가 이 사유를 보여줌) — 신고자의 주장·비난·개인정보가 섞일 수 있고, 관리자가 확인한 사실도 아니다.
// 그래서 중립 고정 문구를 기본으로 두고 관리자가 필요하면 구체적으로 고쳐 쓴다. 신고 사유는 이 화면에서 참고용으로만 보인다.
export const DEFAULT_SANCTION_REASON = '커뮤니티 운영 정책 위반';
// 신고자에게 보이는 처리 안내의 기본 문구 — 신고자의 "내 신고 내역"이 안내가 없을 때 보여주는 문구와 같다.
export const DEFAULT_RESOLUTION_NOTE = '신고를 검토했고 커뮤니티 운영 정책에 따라 처리했어요. 신고해 주셔서 고마워요.';
const RESOLUTION_NOTE_MAX_LENGTH = 500;
// 제재 기간은 프리셋으로만 고른다(#201) — 관리자가 매번 자유롭게 날짜를 정하면 기준이 들쭉날쭉해질 수 있다. permanent는 영구정지.
const SANCTION_DURATIONS = [
  { value: '1d', label: '1일' },
  { value: '3d', label: '3일' },
  { value: '7d', label: '7일' },
  { value: '30d', label: '30일' },
  { value: 'permanent', label: '영구' },
];
const SANCTION_SCOPES = [
  { value: 'post_apply', hint: '커뮤니티는 볼 수 있어요' },
  { value: 'full', hint: '커뮤니티에 들어올 수 없어요' },
];
const STATUS_TABS = [
  { key: 'pending', label: '처리 대기' },
  { key: 'resolved', label: '처리완료' },
];

// 같은 글·신청에 들어온 신고를 한 묶음으로 — 먼저 들어온 신고가 앞. 서버가 targetId를 안 주는 예전 응답이면 신고마다 따로 둔다.
// eslint-disable-next-line react-refresh/only-export-components -- 테스트가 묶는 규칙을 직접 확인한다.
export function groupReports(reports) {
  const groups = new Map();
  for (const r of reports) {
    const key = r.targetId != null ? `${r.targetType}:${r.targetId}` : `report:${r.id}`;
    if (!groups.has(key)) groups.set(key, { key, reports: [] });
    groups.get(key).reports.push(r);
  }
  return [...groups.values()].map((g) => ({ ...g, first: g.reports[0], latest: g.reports[g.reports.length - 1] }));
}

/**
 * AdminReports
 * 관리자 신고함 — 목록은 신고 대상(글·신청)별로 묶은 줄, 줄을 누르면 상세(신고 당시 내용·사유 전체·대상자 정보)에서 처리한다.
 * "조치 없이 처리"와 "제재하기"는 아래에서 올라오는 시트로 확인한다. 하나를 처리하면 같은 대상의 다른 신고도 서버가 함께 처리한다.
 *
 * Props:
 * - detailKey: 상세로 연 묶음의 key(없으면 목록)
 * - onOpenDetail(key) / onCloseDetail()
 * - onOpenPost(postId): 신고된 글을 커뮤니티에서 연다
 * - showToast(message)
 */
function AdminReports({ detailKey, onOpenDetail, onCloseDetail, onOpenPost, showToast }) {
  const [status, setStatus] = useState('pending');
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  const [sheet, setSheet] = useState(null); // 'resolve' | 'sanction' | null
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState(DEFAULT_RESOLUTION_NOTE);
  const [scope, setScope] = useState('post_apply');
  const [duration, setDuration] = useState('7d');
  const [reason, setReason] = useState(DEFAULT_SANCTION_REASON);
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReports(null);
    setError(null);
    getAdminReports(status)
      .then((list) => !cancelled && setReports(list))
      .catch(() => !cancelled && setError('신고 목록을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'));
    return () => {
      cancelled = true;
    };
  }, [status]);

  const groups = useMemo(() => (reports ? groupReports(reports) : []), [reports]);
  const group = detailKey ? groups.find((g) => g.key === detailKey) : null;
  const studentId = group?.first.reportedStudentId;

  useEffect(() => {
    setSummary(null);
    setSummaryError(false);
    if (!studentId) return undefined;
    let cancelled = false;
    getReportedStudentSummary(studentId)
      .then((s) => !cancelled && setSummary(s))
      .catch(() => !cancelled && setSummaryError(true));
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  // 상세로 연 묶음이 목록에 없으면(이미 처리돼 사라졌거나 다른 상태 탭의 묶음) 목록으로 돌아간다.
  const missing = Boolean(detailKey && reports && !group);
  useEffect(() => {
    if (missing) onCloseDetail();
  }, [missing, onCloseDetail]);

  const openSheet = (kind) => {
    setNote(DEFAULT_RESOLUTION_NOTE);
    setScope('post_apply');
    setDuration('7d');
    setReason(DEFAULT_SANCTION_REASON);
    setSheet(kind);
  };

  const finish = (message) => {
    setReports((prev) => prev.filter((r) => !group.reports.some((g) => g.id === r.id)));
    setSheet(null);
    onCloseDetail();
    showToast(message);
    refreshAdminPending();
  };

  const handleResolve = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await resolveAdminReport(group.first.id, note.trim() || null);
      finish('처리완료로 표시했어요.');
    } catch {
      setError('처리하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSanction = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await sanctionReport(group.first.id, { scope, duration, reason: reason.trim(), resolutionNote: note.trim() || null });
      finish('제재를 적용했어요.');
    } catch {
      setError('제재를 적용하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  };


  if (group) {
    const { first } = group;
    const count = group.reports.length;
    const isApplication = first.targetType === 'application';
    const reporters = [...new Set(group.reports.map((r) => r.reporter))].length;
    const durationLabel = SANCTION_DURATIONS.find((d) => d.value === duration).label;
    return (
      <>
        <div className="admin-detail">
          <p className="post-meta">
            {isApplication ? '신청 메시지 신고' : '글 신고'} · {formatDate(first.createdAt)}
          </p>
          <p className="admin-detail-title">{first.targetTitle}</p>
          {first.targetBody && (
            <p className="post-quote">
              <span className="post-quote-label">{isApplication ? '신고된 신청 메시지' : '신고 당시 내용'}</span>
              {first.targetBody}
            </p>
          )}
          {first.targetExists && (
            <button type="button" className="post-btn post-btn--text admin-detail-link" onClick={() => onOpenPost(first.targetPostId)}>
              {isApplication ? '신청이 달린 글 보기' : '커뮤니티에서 글 보기'}
              <IconChevronRight size={16} />
            </button>
          )}
          {error && <p className="home-error">{error}</p>}

          <p className="admin-section">신고 사유 {count}건</p>
          <ul className="admin-reasons">
            {group.reports.map((r) => (
              <li key={r.id}>
                <b>{r.reason}</b>
                <span>
                  {r.reporter} · {formatDate(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>

          {status === 'resolved' && first.resolutionNote && (
            <>
              <p className="admin-section">신고자에게 보낸 안내</p>
              <p className="admin-body">{first.resolutionNote}</p>
            </>
          )}

          <p className="admin-section">신고 대상</p>
          {!first.reportedStudent ? (
            <p className="courses-manual-hint">대상 정보가 없는 예전 신고예요. 조치 없이 처리만 할 수 있어요.</p>
          ) : (
            <div className="admin-person">
              <div className="admin-person-top">
                <b>{first.reportedStudent}</b>
                {summary && (
                  <span>
                    {summary.department || '학과 미등록'}
                    {summary.admissionYear ? ` · ${summary.admissionYear}학번` : ''}
                  </span>
                )}
              </div>
              {summaryError ? (
                <p className="courses-manual-hint">대상자 정보를 불러오지 못했어요. 이미 탈퇴한 계정일 수 있어요.</p>
              ) : summary ? (
                <>
                  <dl className="admin-person-stats">
                    <div>
                      <dt>가입</dt>
                      <dd>{formatDate(summary.joinedAt)}</dd>
                    </div>
                    <div>
                      <dt>쓴 글·신청</dt>
                      <dd>
                        {summary.postCount}개 · {summary.applicationCount}건
                      </dd>
                    </div>
                    <div>
                      <dt>받은 신고</dt>
                      <dd>{summary.reportsReceived.total}건</dd>
                    </div>
                    <div>
                      <dt>제재 이력</dt>
                      <dd>{summary.sanctions.length ? `${summary.sanctions.length}건` : '없음'}</dd>
                    </div>
                  </dl>
                  {summary.sanctions.length > 0 && (
                    <ul className="admin-person-sanctions">
                      {summary.sanctions.map((s) => (
                        <li key={s.id}>
                          <span className={`post-status ${sanctionState(s) === 'active' ? 'post-status--no' : 'post-status--mute'}`}>
                            {SANCTION_SCOPE_LABEL[s.scope] || s.scope} · {SANCTION_STATE_LABEL[sanctionState(s)]}
                          </span>
                          <span className="post-meta">
                            {formatDate(s.startsAt)} ~ {s.endsAt ? formatDate(s.endsAt) : '영구'} · 사유 {s.reason}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="courses-manual-hint">불러오는 중...</p>
              )}
            </div>
          )}
        </div>

        {status === 'pending' && (
          <div className="admin-dock">
            <button type="button" className="post-btn post-btn--outline post-btn--lg" onClick={() => openSheet('resolve')}>
              조치 없이 처리
            </button>
            <button
              type="button"
              className="post-btn post-btn--danger post-btn--lg"
              onClick={() => openSheet('sanction')}
              disabled={!first.reportedStudent}
            >
              제재하기
            </button>
          </div>
        )}

        {sheet === 'resolve' && (
          <AdminSheet title="조치 없이 처리" onClose={() => setSheet(null)} onSubmit={handleResolve} submitLabel="처리완료로 표시" submitting={submitting}>
            {count > 1 && <p className="admin-sheet-note">이 {isApplication ? '신청' : '글'}에 들어온 신고 {count}건이 함께 처리완료돼요.</p>}
            <label className="admin-section first" htmlFor="resolution-note">
              신고자에게 보낼 안내 <small>{reporters > 1 ? `신고한 ${reporters}명에게 보여요` : '신고자에게만 보여요'}</small>
            </label>
            <textarea id="resolution-note" className="post-input admin-textarea" rows={3} maxLength={RESOLUTION_NOTE_MAX_LENGTH} value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="courses-manual-hint">신고 대상자의 이름·학과 같은 개인 정보나 제재 내용은 쓰지 마세요. 비워 두면 기본 안내가 보여요.</p>
          </AdminSheet>
        )}

        {sheet === 'sanction' && (
          <AdminSheet
            title={`${first.reportedStudent} 제재하기`}
            onClose={() => setSheet(null)}
            onSubmit={handleSanction}
            submitLabel={`${durationLabel} ${SANCTION_SCOPE_LABEL[scope]}`}
            submitting={submitting}
            submitDisabled={!reason.trim()}
          >
            <p className="admin-section first">범위</p>
            <div className="admin-choice" role="radiogroup" aria-label="범위">
              {SANCTION_SCOPES.map((s) => (
                <button key={s.value} type="button" role="radio" aria-checked={scope === s.value} className={scope === s.value ? 'on' : ''} onClick={() => setScope(s.value)}>
                  <b>{SANCTION_SCOPE_LABEL[s.value]}</b>
                  <span>{s.hint}</span>
                </button>
              ))}
            </div>
            <p className="admin-section">기간</p>
            <div className="seg admin-seg-full" role="radiogroup" aria-label="기간">
              {SANCTION_DURATIONS.map((d) => (
                <button key={d.value} type="button" role="radio" aria-checked={duration === d.value} className={duration === d.value ? 'active' : ''} onClick={() => setDuration(d.value)}>
                  {d.label}
                </button>
              ))}
            </div>
            <label className="admin-section" htmlFor="sanction-reason">
              제재 사유 <small>{first.reportedStudent}에게 보여요</small>
            </label>
            <textarea id="sanction-reason" className="post-input admin-textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required />
            <p className="courses-manual-hint">신고 사유는 제재받는 사용자에게 전달되지 않아요. 이 "제재 사유"만 보여요.</p>
            <label className="admin-section" htmlFor="resolution-note">
              신고자에게 보낼 안내 <small>{reporters > 1 ? `신고한 ${reporters}명에게 보여요` : '신고자에게만 보여요'}</small>
            </label>
            <textarea id="resolution-note" className="post-input admin-textarea" rows={3} maxLength={RESOLUTION_NOTE_MAX_LENGTH} value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="admin-sheet-warn">제재하면 신고된 {isApplication ? '신청' : '글'}이 함께 지워지고 되돌릴 수 없어요.</p>
          </AdminSheet>
        )}
      </>
    );
  }

  const pendingGroups = status === 'pending' ? groups.length : null;
  return (
    <>
      <AdminTabs
        tabs={STATUS_TABS.map((t) => ({ ...t, count: t.key === 'pending' ? pendingGroups : null }))}
        active={status}
        onChange={setStatus}
        label="신고 상태"
      />
      {error && <p className="home-error admin-pad">{error}</p>}
      {!reports ? (
        <p className="courses-manual-hint admin-pad">불러오는 중...</p>
      ) : groups.length === 0 ? (
        <p className="courses-manual-hint admin-pad">{status === 'pending' ? '처리할 신고가 없어요.' : '처리완료된 신고가 없어요.'}</p>
      ) : (
        <div className="admin-rows">
          {groups.map((g) => (
            <button type="button" className="post-row admin-row" key={g.key} onClick={() => onOpenDetail(g.key)}>
              <span className="admin-row-top">
                <span className={`post-status ${status === 'pending' ? 'post-status--no' : 'post-status--ok'}`}>
                  {status === 'pending' ? `신고 ${g.reports.length}건` : '처리완료'}
                </span>
                <span className="post-meta">
                  {g.first.targetType === 'application' ? '신청 메시지' : '글'} · {formatDate(g.latest.createdAt)}
                </span>
              </span>
              <span className="post-title">{g.first.targetTitle}</span>
              {g.first.targetBody && <span className="post-excerpt">{g.first.targetBody}</span>}
              <span className="post-meta">
                대상 {g.first.reportedStudent || '정보 없음'} · 사유 "{g.first.reason}"{g.reports.length > 1 ? ` 외 ${g.reports.length - 1}건` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default AdminReports;
