import React, { useEffect, useMemo, useState } from 'react';
import { getGraduationStatus } from '../api/chatApi.js';
import { IconBook, IconChecklist, IconAlertTriangle, IconCheck, IconCompass, IconUsers } from '../components/icons.jsx';
import AccountMenu from '../components/AccountMenu.jsx';
import { summarizeShortfalls, formatShortfallSentence, mergeMajorCategories, getProgressColor, getPercent } from '../utils/graduation.js';
import { getGradeLevel } from '../utils/academic.js';
import { readCache, writeCache, clearCache } from '../utils/sessionCache.js';
import { useI18n } from '../i18n/I18nContext.jsx';

// 모듈이 살아있는 동안(SPA 내 화면 전환) 유지되는 메모리 캐시 — sessionStorage에서 초기값을
// 복원해서, 탭이 살아있는 채로 페이지가 다시 로드되는 경우(모바일 백그라운드 재로드, PC
// 새로고침 등)에도 직전에 불러온 값을 바로 보여줄 수 있다(utils/sessionCache.js 참고).
const homeDataCache = {
  status: readCache('home_status'),
};

function setHomeCache(key, value) {
  homeDataCache[key] = value;
  writeCache(`home_${key}`, value);
}

// 로그아웃/계정 삭제 후 새 계정으로 들어오면, SPA라 페이지가 새로고침되지 않아 이 모듈
// 스코프 캐시가 그대로 남아있어서 잠깐 이전 계정 데이터가 보이는 문제가 있었다(실사용
// 확인). App.jsx가 로그아웃/계정 삭제 시점에 호출해 캐시를 비운다.
// eslint-disable-next-line react-refresh/only-export-components -- App.jsx가 재사용하는 캐시 리셋 함수라 의도적으로 컴포넌트와 같이 export함.
export function resetHomeCache() {
  homeDataCache.status = null;
  clearCache('home_status');
  clearCache('home_shortfalls');
}

/**
 * Home Page Component
 * 대시보드 우선 홈 화면 — 이수학점 요약을 먼저 보여준다. App.jsx가 렌더링하는 공용
 * BottomTabBar는 아이콘 전용이라 텍스트 라벨이 없어서, 각 기능이 뭘 하는 화면인지는
 * 여기 메뉴 카드(텍스트 라벨 포함)를 통해 처음 알게 된다 — 탭바와 기능이 겹치더라도
 * 없애지 않는다.
 *
 * Props:
 * - user: object
 * - onOpenCourses: function
 * - onOpenGraduation: function
 * - onOpenCareer: function
 * - onOpenSettings: function
 * - onOpenOnboarding: function
 * - onOpenLeaveSettings: function
 * - onOpenProfile: function
 * - onLogout: function
 */
function Home({
  user,
  onOpenCourses,
  onOpenGraduation,
  onOpenCareer,
  onOpenCommunity,
  onOpenSettings,
  onOpenOnboarding,
  onOpenLeaveSettings,
  onOpenProfile,
  onOpenAdmin,
  onOpenInquiry,
  onLogout,
}) {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState(homeDataCache.status);

  useEffect(() => {
    // 이수학점 진행률/부족 요건 모두 같은 소스(getGraduationStatus)를 써야 두 카드 숫자가
    // 항상 맞는다 — 예전엔 진행률 카드가 courseService.getSummary()의 카테고리 상한 없는
    // 단순 합계를 썼는데, 부족 요건 쪽은 상한이 적용된 총계를 써서 같은 화면에서 "15학점
    // 남음"과 "전공 20학점 부족"처럼 서로 안 맞는 숫자가 나오는 문제가 있었다(실사용 확인).
    // 졸업요건 진단은 온보딩 전이면 실패할 수 있는 정보라, 홈 화면 전체를 깨뜨리지 않도록
    // 별도로 조용히 처리(실패 시 카드에 기존 안내 문구를 그대로 둠).
    getGraduationStatus()
      .then((data) => {
        setStatus(data);
        setHomeCache('status', data);
      })
      .catch(() => {});
  }, []);

  // 부족 요건 문구는 화면 언어에 따라 달라져서 완성된 문장이 아니라 서버 응답(status)만 캐시하고
  // 매 렌더에서 조립한다 — 언어를 바꿨을 때 이전 언어로 만든 문구가 캐시에 남지 않게.
  // status가 아직 없으면(첫 로딩/실패) null — 카드에 기존 안내 문구를 그대로 둔다.
  const shortfalls = useMemo(
    () => (status ? summarizeShortfalls(mergeMajorCategories(status.categories), status.certifications, t) : null),
    [status, t]
  );

  // 뒤로가기 등으로 홈에 재진입할 때마다 서버 응답을 기다리는 동안 "0학점" 같은 빈 기본값이
  // 잠깐 보이는 문제(배포 환경처럼 왕복 지연이 있으면 눈에 띔) 방지 — 첫 진입이라 캐시가
  // 없을 때만 로딩 스켈레톤을 보여주고, 두 번째 방문부터는 직전에 불러온 데이터를 즉시
  // 보여준 뒤 뒤에서 조용히 최신 데이터로 갱신한다. user는 App.jsx가 이미 로딩을 마친
  // 뒤에만 이 화면을 렌더링하므로(authChecked 게이팅) 항상 준비돼 있어 이 판단에서 제외.
  const isFirstLoad = status === null;

  const gradeLevel = getGradeLevel(user?.admissionYear, user?.leaveSemesters);
  const earnedCredits = status?.totalEarnedCredits ?? 0;
  const requiredTotal = status?.totalRequiredCredits ?? null;
  const progressPercent = getPercent(earnedCredits, requiredTotal);

  return (
    <div className="home-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <span className="screen-title">ONE Student</span>
        </div>
        <AccountMenu
          user={user}
          onLogout={onLogout}
          onOpenSettings={onOpenSettings}
          onOpenOnboarding={onOpenOnboarding}
          onOpenProfile={onOpenProfile}
          onOpenAdmin={onOpenAdmin}
          onOpenInquiry={onOpenInquiry}
        />
      </header>

      <div className="home-body">
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
            <p className="home-greeting">{t('home.greeting', { name: user?.name || t('home.defaultName') })}</p>
            <div className="home-subgreeting-row">
              <p className="home-subgreeting">
                {user?.department || t('home.noDepartment')}
                {gradeLevel ? ` ${t('home.gradeLevel', { grade: gradeLevel })}` : ''}
              </p>
              {gradeLevel && (
                <button className="home-grade-fix-link" onClick={onOpenLeaveSettings}>
                  {t('home.gradeFix')}
                </button>
              )}
            </div>

            <section className="home-card">
              <p className="home-card-label">{t('home.creditProgress')}</p>
              <div className="home-credit-value">
                <span className="home-credit-number">{earnedCredits}</span>
                <span className="home-credit-total">{requiredTotal ? t('home.creditsWithTotal', { total: requiredTotal }) : t('home.creditsUnit')}</span>
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
              <p className="home-card-label">{t('home.shortfall')}</p>
              <div
                className={
                  shortfalls === null
                    ? 'home-card-row'
                    : shortfalls.length > 0
                      ? 'home-card-row shortfall-danger'
                      : 'home-card-row shortfall-ok'
                }
              >
                {/* 초록색으로 칠해도 모양 자체가 경고 삼각형이면 "충족했다는데 왜 주의
                    아이콘이지" 하고 헷갈리게 된다(실사용 확인) — 다 충족했을 때는 체크
                    아이콘으로 바꿔서 모양 자체가 상태와 맞게 한다. */}
                {shortfalls !== null && shortfalls.length === 0 ? <IconCheck size={15} /> : <IconAlertTriangle />}
                <span>
                  {shortfalls === null
                    ? t('home.shortfallCheck')
                    : formatShortfallSentence(shortfalls, lang) || t('home.allMet')}
                </span>
              </div>
            </section>
          </>
        )}

        <p className="home-quick-label">{t('home.menu')}</p>
        <div className="home-quick-actions">
          <button className="home-quick-btn" onClick={onOpenCourses}>
            <IconBook />
            <span>{t('home.courses')}</span>
          </button>
          <button className="home-quick-btn" onClick={onOpenGraduation}>
            <IconChecklist />
            <span>{t('nav.graduation')}</span>
          </button>
          <button className="home-quick-btn" onClick={onOpenCareer}>
            <IconCompass />
            <span>{t('nav.career')}</span>
          </button>
          <button className="home-quick-btn" onClick={onOpenCommunity}>
            <IconUsers />
            <span>{t('nav.community')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default Home;
