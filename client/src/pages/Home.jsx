import React, { useEffect, useState } from 'react';
import { getMe, getCourseSummary } from '../api/chatApi.js';
import { IconMenu, IconUser, IconBook, IconChecklist, IconAlertTriangle, IconArrowUp } from '../components/icons.jsx';

// 2026학번부터 공학3계열 개편으로 졸업학점 체계가 136→130으로 바뀜 (db/regulations/졸업/이수학점_총괄표.md 근거)
const RESTRUCTURE_ADMISSION_YEAR = 2026;
function getRequiredTotalCredits(admissionYear) {
  if (!admissionYear) return null;
  return admissionYear >= RESTRUCTURE_ADMISSION_YEAR ? 130 : 136;
}

function getGradeLevel(admissionYear) {
  if (!admissionYear) return null;
  const currentYear = new Date().getFullYear();
  return Math.min(4, Math.max(1, currentYear - admissionYear + 1));
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
function formatToday() {
  const now = new Date();
  return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${WEEKDAYS[now.getDay()]}요일`;
}

/**
 * Home Page Component
 * 대시보드 우선 홈 화면 — 이수학점 요약을 먼저 보여주고, 챗봇은 하단 상시 진입바로 배치.
 *
 * Props:
 * - user: object
 * - onOpenChat: function
 * - onOpenCourses: function
 * - onLogout: function
 */
function Home({ user, onOpenChat, onOpenCourses, onLogout }) {
  const [profile, setProfile] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([getMe(), getCourseSummary()])
      .then(([profileData, summaryData]) => {
        setProfile(profileData);
        setSummary(summaryData);
      })
      .catch(() => setError('정보를 불러오지 못했어요.'));
  }, []);

  const requiredTotal = getRequiredTotalCredits(profile?.admissionYear);
  const gradeLevel = getGradeLevel(profile?.admissionYear);
  const earnedCredits = summary?.total?.earnedCredits ?? 0;
  const progressPercent = requiredTotal ? Math.min(100, Math.round((earnedCredits / requiredTotal) * 100)) : 0;

  return (
    <div className="home-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <IconMenu />
          <span className="screen-title">ONE Student</span>
        </div>
        <button className="avatar-btn" onClick={onLogout} title="로그아웃">
          <IconUser />
        </button>
      </header>

      <div className="home-body">
        {error && <p className="home-error">{error}</p>}

        <div className="home-greeting-block">
          <p className="home-date">{formatToday()}</p>
          <p className="home-greeting">{user?.name || '사용자'}님, 반갑습니다</p>
          <p className="home-subgreeting">
            {profile?.department || '학과 정보 없음'}
            {gradeLevel ? ` ${gradeLevel}학년` : ''}
          </p>
        </div>

        <section className="home-card">
          <p className="home-card-label">이수학점 진행률</p>
          <div className="home-credit-value">
            <span className="home-credit-number">{earnedCredits}</span>
            <span className="home-credit-total">{requiredTotal ? ` / ${requiredTotal}학점` : '학점'}</span>
          </div>
          <div className="home-progress-track">
            <div className="home-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        </section>

        <section className="home-card">
          <p className="home-card-label">부족 요건</p>
          <div className="home-card-row">
            <IconAlertTriangle />
            <span>졸업요건 진단 기능은 아직 준비 중이에요. 곧 만나보실 수 있어요.</span>
          </div>
        </section>

        <p className="home-quick-label">빠른 실행</p>
        <div className="home-quick-actions">
          <button className="home-quick-btn" onClick={onOpenCourses}>
            <IconBook />
            <span>과목 관리</span>
          </button>
          <button className="home-quick-btn" disabled title="준비 중인 기능이에요">
            <IconChecklist />
            <span>졸업요건 진단</span>
          </button>
        </div>
      </div>

      <div className="prompt-bar">
        <button type="button" className="prompt-bar-pill" onClick={() => onOpenChat()}>
          <span className="prompt-bar-placeholder">무엇이든 물어보세요</span>
        </button>
        <button type="button" className="prompt-send-btn" onClick={() => onOpenChat()} aria-label="채팅 열기">
          <IconArrowUp />
        </button>
      </div>
    </div>
  );
}

export default Home;
