import React, { useEffect, useState } from 'react';
import { getAdminReviews } from '../../api/chatApi.js';

/**
 * AdminReviews
 * 관리자 후기 목록 — 앱 안 후기 창(ReviewPrompt)으로 받은 별점과 한 줄 후기. 익명이라 학과와 날짜만 있고, 답장하지 않는다.
 * 소개 자료에는 "○○학과 익명: …"으로 옮겨 쓴다. 처리할 일이 아니라 읽기만 하는 화면이다.
 */
function AdminReviews() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getAdminReviews()
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError('후기를 불러오지 못했어요. 새로고침 후 다시 시도해주세요.'));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="home-error admin-pad">{error}</p>;
  if (!data) return <p className="courses-manual-hint admin-pad">불러오는 중...</p>;
  if (data.count === 0) return <p className="courses-manual-hint admin-pad">아직 받은 후기가 없어요.</p>;

  return (
    <>
      <p className="courses-manual-hint admin-pad">
        후기 {data.count}개 · 평균 {data.average}점
      </p>
      <div className="admin-rows">
        {data.reviews.map((r) => (
          <div className="post-row post-row--static admin-row" key={r.id}>
            <span className="admin-row-top">
              <span className="admin-review-stars" aria-label={`별점 ${r.rating}점`}>
                {'★'.repeat(r.rating)}
                <span className="admin-review-stars-off">{'★'.repeat(5 - r.rating)}</span>
              </span>
              <span className="post-meta">{r.date}</span>
            </span>
            {r.content ? <span className="admin-review-text">{r.content}</span> : <span className="post-meta">별점만 남겼어요</span>}
            <span className="post-meta">{r.department ? `${r.department} 익명` : '학과 없음 · 익명'}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export default AdminReviews;
