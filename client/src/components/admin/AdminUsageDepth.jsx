import React, { useEffect, useState } from 'react';
import { getAdminUsageDepth } from '../../api/chatApi.js';

const SCOPES = [
  { key: 'all', tab: '전체' },
  { key: 'recent30d', tab: '최근 30일 가입자' },
];

const FEATURE_ROWS = [
  { label: '온보딩 완료', pick: (d) => d.onboarded },
  { label: '과목 1개 이상 넣음', pick: (d) => d.features.courses },
  { label: '챗봇에 질문', pick: (d) => d.features.chat },
  { label: '진로 탐색 시작', pick: (d) => d.features.career },
];

const CAREER_ROWS = [
  { key: 'started', label: '상담 시작' },
  { key: 'answered', label: '고정 질문 답함' },
  { key: 'talked', label: '자유 대화 1번 이상' },
  { key: 'recommended', label: '진로 추천 받음' },
  { key: 'confirmed', label: '진로 확정' },
];

const rateText = (rate) => (rate == null ? '—' : `${rate}%`);

function StepRow({ label, step }) {
  return (
    <li className="admin-feature-row">
      <span className="admin-feature-name">{label}</span>
      <span className="admin-feature-bar" aria-hidden="true">
        <i style={{ width: `${step.rate ?? 0}%` }} />
      </span>
      <span className="admin-feature-n">
        <b>{step.count.toLocaleString()}명</b>
        <small>{rateText(step.rate)}</small>
      </span>
    </li>
  );
}

/**
 * AdminUsageDepth
 * 관리자 통계의 "사용 깊이" 탭(GET /api/admin/stats/usage) — 가입자 중 각 기능을 실제로 써 본 학생 수와 비율. 화면·버튼 기록이 아니라
 * 기능이 남기는 데이터(과목·챗봇 질문·진로 상담·성적표 가져오기)로 센다. 비율은 모두 가입자 기준이고, 기능끼리는 순서가 없다
 * (과목을 안 넣고 챗봇만 쓰는 학생도 있다). 진로 탐색만 단계가 있어 따로 보여준다.
 */
function AdminUsageDepth() {
  const [scope, setScope] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    getAdminUsageDepth(scope)
      .then((fresh) => !cancelled && setData(fresh))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [scope]);

  return (
    <>
      <div className="seg admin-filter" role="tablist" aria-label="기간 선택">
        {SCOPES.map((s) => (
          <button key={s.key} type="button" role="tab" aria-selected={s.key === scope} className={s.key === scope ? 'active' : ''} onClick={() => setScope(s.key)}>
            {s.tab}
          </button>
        ))}
      </div>

      {!data ? (
        error ? (
          <p className="home-error">사용 깊이를 불러오지 못했어요. 새로고침 후 다시 시도해주세요.</p>
        ) : (
          <div className="skeleton skeleton-card" style={{ height: 300 }} aria-busy="true" aria-label="불러오는 중" />
        )
      ) : data.signups === 0 ? (
        <p className="courses-manual-hint">아직 셀 사람이 없어요.</p>
      ) : (
        <>
          <div className="admin-mini admin-usage-summary">
            <div>
              <span>가입자</span>
              <b>{data.signups.toLocaleString()}</b>
              <small>{scope === 'all' ? '관리자 제외' : '최근 30일 가입'}</small>
            </div>
            <div>
              <span>과목 수 중앙값</span>
              <b>{data.depth.courseMedian == null ? '—' : `${data.depth.courseMedian.toLocaleString()}개`}</b>
              <small>과목 넣은 학생 기준</small>
            </div>
            <div>
              <span>성적표 가져오기</span>
              <b>{data.depth.pdfImport.count.toLocaleString()}명</b>
              <small>가입자의 {rateText(data.depth.pdfImport.rate)}</small>
            </div>
          </div>

          <div className="admin-card">
            <p className="admin-stat-label">한 번이라도 써 본 기능</p>
            <ul className="admin-depth-list">
              {FEATURE_ROWS.map((row) => (
                <StepRow key={row.label} label={row.label} step={row.pick(data)} />
              ))}
            </ul>
            <p className="admin-card-note">비율은 가입자 {data.signups.toLocaleString()}명 기준이에요. 기능끼리는 순서가 없어요.</p>
          </div>

          <div className="admin-card">
            <p className="admin-stat-label">진로 탐색은 어디까지 가나</p>
            <ul className="admin-depth-list">
              {CAREER_ROWS.map((row) => (
                <StepRow key={row.key} label={row.label} step={data.career[row.key]} />
              ))}
            </ul>
            <p className="admin-card-note">상담을 여러 번 했으면 가장 멀리 간 상담으로 세요.</p>
          </div>

          <p className="courses-manual-hint">
            학생 목록 없이 숫자만 세요. 탈퇴한 계정은 빠지고, 옛 테스트 계정이 섞여 있을 수 있어요.
            {scope === 'recent30d' && ' 최근 가입자는 써 볼 시간이 짧아 비율이 낮게 나와요.'}
          </p>
        </>
      )}
    </>
  );
}

export default AdminUsageDepth;
