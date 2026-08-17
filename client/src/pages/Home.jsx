import React, { useEffect, useState } from 'react';
import { getMe, getGraduationStatus } from '../api/chatApi.js';
import { IconMenu, IconBook, IconChecklist, IconAlertTriangle, IconArrowUp, IconCompass, IconUsers } from '../components/icons.jsx';
import AccountMenu from '../components/AccountMenu.jsx';
import NavDrawer from '../components/NavDrawer.jsx';
import { summarizeShortfalls, formatShortfallSentence, mergeMajorCategories, getProgressColor } from '../utils/graduation.js';
import { getGradeLevel } from '../utils/academic.js';

// 페이지를 새로고침하지 않는 한(모듈이 다시 로드되지 않는 한) 유지되는 메모리 캐시.
// 홈 화면을 나갔다가 돌아올 때마다 서버 응답을 기다리며 빈 화면을 보여주는 대신,
// 직전에 불러온 값을 바로 보여줄 수 있게 컴포넌트 바깥(마운트/언마운트와 무관)에 둔다.
const homeDataCache = { profile: null, status: null, shortfalls: null };

// 로그아웃/계정 삭제 후 새 계정으로 들어오면, SPA라 페이지가 새로고침되지 않아 이 모듈
// 스코프 캐시가 그대로 남아있어서 잠깐 이전 계정 데이터가 보이는 문제가 있었다(실사용
// 확인). App.jsx가 로그아웃/계정 삭제 시점에 호출해 캐시를 비운다.
export function resetHomeCache() {
  homeDataCache.profile = null;
  homeDataCache.status = null;
  homeDataCache.shortfalls = null;
}

/**
 * Home Page Component
 * 대시보드 우선 홈 화면 — 이수학점 요약을 먼저 보여주고, 챗봇은 하단 상시 진입바로 배치.
 *
 * Props:
 * - user: object
 * - onOpenChat: function
 * - onOpenCourses: function
 * - onOpenGraduation: function
 * - onOpenSettings: function
 * - onOpenOnboarding: function
 * - onOpenLeaveSettings: function
 * - onOpenProfile: function
 * - onLogout: function
 */
function Home({
  user,
  onOpenChat,
  onOpenCourses,
  onOpenGraduation,
  onOpenCareer,
  onOpenSettings,
  onOpenOnboarding,
  onOpenLeaveSettings,
  onOpenProfile,
  onLogout,
}) {
  const [profile, setProfile] = useState(homeDataCache.profile);
  const [status, setStatus] = useState(homeDataCache.status);
  const [error, setError] = useState(null);
  const [shortfalls, setShortfalls] = useState(homeDataCache.shortfalls);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    getMe()
      .then((data) => {
        setProfile(data);
        homeDataCache.profile = data;
      })
      .catch(() => setError('정보를 불러오지 못했어요.'));

    // 이수학점 진행률/부족 요건 모두 같은 소스(getGraduationStatus)를 써야 두 카드 숫자가
    // 항상 맞는다 — 예전엔 진행률 카드가 courseService.getSummary()의 카테고리 상한 없는
    // 단순 합계를 썼는데, 부족 요건 쪽은 상한이 적용된 총계를 써서 같은 화면에서 "15학점
    // 남음"과 "전공 20학점 부족"처럼 서로 안 맞는 숫자가 나오는 문제가 있었다(실사용 확인).
    // 졸업요건 진단은 온보딩 전이면 실패할 수 있는 정보라, 홈 화면 전체를 깨뜨리지 않도록
    // 별도로 조용히 처리(실패 시 카드에 기존 안내 문구를 그대로 둠).
    getGraduationStatus()
      .then((data) => {
        setStatus(data);
        homeDataCache.status = data;
        const nextShortfalls = summarizeShortfalls(mergeMajorCategories(data.categories), data.certifications);
        setShortfalls(nextShortfalls);
        homeDataCache.shortfalls = nextShortfalls;
      })
      .catch(() => setShortfalls(null));
  }, []);

  // 뒤로가기 등으로 홈에 재진입할 때마다 서버 응답을 기다리는 동안 "학과 정보 없음"/"0학점"
  // 같은 빈 기본값이 잠깐 보이는 문제(배포 환경처럼 왕복 지연이 있으면 눈에 띔) 방지 —
  // 첫 진입이라 캐시가 없을 때만 로딩 스켈레톤을 보여주고, 두 번째 방문부터는 직전에 불러온
  // 데이터를 즉시 보여준 뒤 뒤에서 조용히 최신 데이터로 갱신한다.
  const isFirstLoad = profile === null && status === null;

  const gradeLevel = getGradeLevel(profile?.admissionYear, profile?.leaveSemesters);
  const earnedCredits = status?.totalEarnedCredits ?? 0;
  const requiredTotal = status?.totalRequiredCredits ?? null;
  const progressPercent = requiredTotal ? Math.min(100, Math.round((earnedCredits / requiredTotal) * 100)) : 0;

  return (
    <div className="home-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="메뉴 열기">
            <IconMenu />
          </button>
          <span className="screen-title">ONE Student</span>
        </div>
        <AccountMenu
          user={user}
          onLogout={onLogout}
          onOpenSettings={onOpenSettings}
          onOpenOnboarding={onOpenOnboarding}
          onOpenProfile={onOpenProfile}
        />
      </header>

      <NavDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenCourses={onOpenCourses}
        onOpenGraduation={onOpenGraduation}
        onOpenCareer={onOpenCareer}
        onOpenChat={onOpenChat}
      />

      <div className="home-body">
        {error && <p className="home-error">{error}</p>}

        {isFirstLoad ? (
          <>
            <div className="skeleton skeleton-text skeleton-greeting" />
            <div className="skeleton skeleton-text skeleton-subgreeting" />
            <div className="home-card skeleton-card">
              <div className="skeleton skeleton-text skeleton-label" />
              <div className="skeleton skeleton-text skeleton-credit" />
              <div className="skeleton skeleton-bar" />
            </div>
            <div className="home-card skeleton-card">
              <div className="skeleton skeleton-text skeleton-label" />
              <div className="skeleton skeleton-text skeleton-row" />
            </div>
          </>
        ) : (
          <>
            <p className="home-greeting">{user?.name || '사용자'}님, 반갑습니다</p>
            <div className="home-subgreeting-row">
              <p className="home-subgreeting">
                {profile?.department || '학과 정보 없음'}
                {gradeLevel ? ` ${gradeLevel}학년` : ''}
              </p>
              {gradeLevel && (
                <button className="home-grade-fix-link" onClick={onOpenLeaveSettings}>
                  학년이 다르신가요?
                </button>
              )}
            </div>

            <section className="home-card">
              <p className="home-card-label">이수학점 진행률</p>
              <div className="home-credit-value">
                <span className="home-credit-number">{earnedCredits}</span>
                <span className="home-credit-total">{requiredTotal ? ` / ${requiredTotal}학점` : '학점'}</span>
              </div>
              <div className="home-progress-track">
                <div
                  className="home-progress-fill"
                  style={{ width: `${progressPercent}%`, backgroundColor: getProgressColor(progressPercent) }}
                />
              </div>
              <p className="grad-remaining-text">{progressPercent}%</p>
            </section>

            <section className="home-card">
              <p className="home-card-label">부족 요건</p>
              <div
                className={
                  shortfalls === null
                    ? 'home-card-row'
                    : shortfalls.length > 0
                      ? 'home-card-row shortfall-danger'
                      : 'home-card-row shortfall-ok'
                }
              >
                <IconAlertTriangle />
                <span>
                  {shortfalls === null
                    ? '졸업요건 진단에서 확인해보세요.'
                    : formatShortfallSentence(shortfalls) || '모든 요건을 충족했어요!'}
                </span>
              </div>
            </section>
          </>
        )}

        <p className="home-quick-label">메뉴</p>
        <div className="home-quick-actions">
          <button className="home-quick-btn" onClick={onOpenCourses}>
            <IconBook />
            <span>과목 관리</span>
          </button>
          <button className="home-quick-btn" onClick={onOpenGraduation}>
            <IconChecklist />
            <span>졸업요건 진단</span>
          </button>
          <button className="home-quick-btn" onClick={onOpenCareer}>
            <IconCompass />
            <span>진로 탐색</span>
          </button>
          <button className="home-quick-btn" disabled>
            <IconUsers />
            <span>커뮤니티</span>
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
