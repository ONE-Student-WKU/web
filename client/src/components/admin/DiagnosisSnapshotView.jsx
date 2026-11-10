import React from 'react';
import { formatDate } from './adminFormat.js';

/**
 * 학생이 문의에 같이 보낸 진단 스냅샷(server/services/inquiryDiagnosisSnapshot.js)을 관리자 문의 상세에 보여 준다.
 * 보낸 순간의 모습이라 학생이 그 뒤에 과목을 고쳤어도 그대로다. 성적은 애초에 들어 있지 않다.
 * 관리자 화면은 한국어만 쓴다(adminFormat.js 주석 참고).
 */

const ENROLLMENT_LABEL = { GENERAL: '일반', TRANSFER_ADMISSION: '편입', MAJOR_CHANGE: '전과' };
const SEMESTER_LABEL = { 1: '1학기', 2: '여름', 3: '2학기', 4: '겨울' };
const ORIGIN_LABEL = { CATALOG: '검색', TRANSCRIPT: '성적표', UNKNOWN: '직접입력·확인리스트' };
// 화면·인쇄본과 같은 기준(client/src/utils/graduation.js printTrustLevel) — 직접 바꾼 이수구분이 있으면 미정.
function trustLabel(summary) {
  if (summary.editedCategoryCourses && summary.editedCategoryCourses.length > 0) return '미정';
  if (summary.confidence === 'CONFIRMED') return '높음';
  if (summary.confidence === 'ESTIMATED') return '중간';
  return summary.confidence ? '낮음' : '-';
}

function formatTakenAt(iso) {
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function DiagnosisSnapshotView({ snapshot }) {
  if (!snapshot) return null;
  const { student = {}, summary, courses = [] } = snapshot;
  const who = [
    [student.department, student.track].filter(Boolean).join(' ') || '학과 없음',
    student.admissionYear ? `${student.admissionYear}학번` : null,
    student.enrollmentType ? ENROLLMENT_LABEL[student.enrollmentType] || student.enrollmentType : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="admin-snapshot">
      <p className="admin-section">
        학생이 보낸 진단 결과 <small>{snapshot.takenAt ? `${formatTakenAt(snapshot.takenAt)} 기준 · ` : ''}성적 제외</small>
      </p>
      <p className="admin-body">{who}</p>
      {summary ? (
        <>
          <p className="admin-body">
            총 <b>{summary.totalEarnedCredits} / {summary.totalRequiredCredits}학점</b> · 신뢰도 {trustLabel(summary)}
          </p>
          {summary.reasons.length > 0 && (
            <ul className="admin-snapshot-list">
              {summary.reasons.map((r) => (
                <li key={r.code}>{r.message}</li>
              ))}
            </ul>
          )}
          <table className="admin-snapshot-table">
            <thead>
              <tr>
                <th>영역</th>
                <th>들은 학점 / 기준</th>
              </tr>
            </thead>
            <tbody>
              {summary.categories.map((c) => (
                <tr key={c.category}>
                  <td>{c.category}</td>
                  <td>
                    {c.earnedCredits} / {c.requiredCredits}
                  </td>
                </tr>
              ))}
              {summary.certifications.map((c) => (
                <tr key={`cert-${c.category}`}>
                  <td>{c.category}</td>
                  <td>{c.satisfied ? '충족' : '미충족'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.editedCategoryCourses.length > 0 && (
            <>
              <p className="admin-section">학생이 직접 바꾼 이수구분</p>
              <ul className="admin-snapshot-list">
                {summary.editedCategoryCourses.map((c) => (
                  <li key={c.id}>
                    {c.name}: {c.from} → {c.to} ({c.credits}학점)
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="admin-body">학과를 고르기 전이라 진단 결과가 없어요. 과목 목록만 왔어요.</p>
      )}
      <details className="admin-snapshot-courses">
        <summary>과목 {courses.length}개 보기</summary>
        <table className="admin-snapshot-table">
          <thead>
            <tr>
              <th>학기</th>
              <th>과목</th>
              <th>학점</th>
              <th>이수구분</th>
              <th>넣은 방법</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c, i) => (
              <tr key={`${c.year}-${c.semester}-${c.name}-${i}`} className={c.supersededByRetake ? 'muted' : undefined}>
                <td>
                  {c.year} {SEMESTER_LABEL[c.semester] || c.semester}
                </td>
                <td>
                  {c.name}
                  {c.supersededByRetake && ' (재수강으로 대체)'}
                </td>
                <td>{c.credits}</td>
                <td>
                  {c.category}
                  {c.originalCategory && ` (원래 ${c.originalCategory})`}
                </td>
                <td>{ORIGIN_LABEL[c.origin] || c.origin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export default DiagnosisSnapshotView;
