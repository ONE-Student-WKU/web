import React, { useEffect, useMemo, useState } from 'react';
import { getGraduationStatus } from '../api/chatApi.js';
import { IconAlertTriangle, IconCheck, IconEdit } from '../components/icons.jsx';
import { TAB_ICONS } from '../components/BottomTabBar.jsx';
import { resolveLayout, TAB_LABEL_KEYS, isLockedView } from '../utils/homeLayout.js';
import AccountMenu from '../components/AccountMenu.jsx';
import { summarizeShortfalls, formatShortfallSentence, mergeMajorCategories, getProgressColor, getPercent, describeRequirementTrust } from '../utils/graduation.js';
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

// 편집 버튼 첫 안내를 이미 봤는지(브라우저마다 한 번). 저장소가 막혀 있어도 화면은 그대로 동작한다.
const EDIT_HINT_KEY = 'homeEditHintSeen';
function readHintSeen() {
  try {
    return localStorage.getItem(EDIT_HINT_KEY) === '1';
  } catch {
    return true;
  }
}
function markHintSeen() {
  try {
    localStorage.setItem(EDIT_HINT_KEY, '1');
  } catch {
    /* 저장소를 못 쓰면 다음에 다시 보일 뿐이다 */
  }
}

/**
 * Home Page Component
 * 대시보드 우선 홈 화면 — 이수학점 요약을 먼저 보여준다. App.jsx가 렌더링하는 공용
 * BottomTabBar는 아이콘 전용이라 텍스트 라벨이 없어서, 각 기능이 뭘 하는 화면인지는
 * 여기 메뉴 카드(텍스트 라벨 포함)를 통해 처음 알게 된다 — 탭바와 기능이 겹치더라도
 * 없애지 않는다. 카드(진행률·부족 요건·메뉴)는 고정이고, 헤더의 편집 버튼으로 하단 바만 편집한다(HomeEdit.jsx).
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
 * - onOpenInquiry: function
 * - onOpenHomeEdit: function — 헤더의 편집 버튼(홈 화면 편집)
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
  onOpenHomeEdit,
  onLogout,
}) {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState(homeDataCache.status);
  // 진단 결과를 못 받았는지(실패) / 그 이유가 학과·학번 미입력인지 — 못 받았으면 로딩 스켈레톤을 끝내야 한다.
  const [statusFailed, setStatusFailed] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [showEditHint, setShowEditHint] = useState(() => !readHintSeen());
  const openView = {
    courses: onOpenCourses,
    graduation: onOpenGraduation,
    career: onOpenCareer,
    community: onOpenCommunity,
    inquiry: onOpenInquiry,
  };
  const dismissEditHint = () => {
    markHintSeen();
    setShowEditHint(false);
  };

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
      .catch((err) => {
        // 예전엔 실패를 조용히 삼켜 status가 계속 비어 있었고, 그게 "첫 로딩"으로 판정돼 스켈레톤이 끝나지 않았다(학과를 나중에
        // 선택한 계정은 서버가 ONBOARDING_REQUIRED로 거절). 캐시에 남은 값(다른 계정 등)도 그대로 보이지 않게 비운다.
        resetHomeCache();
        setStatus(null);
        setNeedsOnboarding(err.code === 'ONBOARDING_REQUIRED');
        setStatusFailed(true);
      });
  }, []);

  // 부족 요건 문구는 화면 언어에 따라 달라져서 완성된 문장이 아니라 서버 응답(status)만 캐시하고
  // 매 렌더에서 조립한다 — 언어를 바꿨을 때 이전 언어로 만든 문구가 캐시에 남지 않게.
  // status가 아직 없으면(첫 로딩/실패) null — 카드에 기존 안내 문구를 그대로 둔다.
  const shortfalls = useMemo(
    () => (status ? summarizeShortfalls(mergeMajorCategories(status.categories), status.certifications, t, status.majorAreaCredits) : null),
    [status, t]
  );

  // 뒤로가기 등으로 홈에 재진입할 때마다 서버 응답을 기다리는 동안 "0학점" 같은 빈 기본값이
  // 잠깐 보이는 문제(배포 환경처럼 왕복 지연이 있으면 눈에 띔) 방지 — 첫 진입이라 캐시가
  // 없을 때만 로딩 스켈레톤을 보여주고, 두 번째 방문부터는 직전에 불러온 데이터를 즉시
  // 보여준 뒤 뒤에서 조용히 최신 데이터로 갱신한다. user는 App.jsx가 이미 로딩을 마친
  // 뒤에만 이 화면을 렌더링하므로(authChecked 게이팅) 항상 준비돼 있어 이 판단에서 제외.
  const isFirstLoad = status === null && !statusFailed;

  // 지금 학년·학기는 서버가 계산해 내려준다(studentService.serializeStudent의 academicStanding, 이슈 #318) — 화면에서 따로 계산하지 않는다.
  const standing = user?.academicStanding || null;
  const gradeLabel = !standing
    ? null
    // 입학하자마자 휴학해 아직 다닌 학기가 없으면 서버가 학년 없이(grade: null) 휴학만 알려 준다(#378).
    : standing.grade == null
      ? t('home.gradeOnLeave')
    : standing.extended
      // 초과 학기에 휴학한 학생도 "휴학 중"을 보여 준다(예전에는 초과 학기면 휴학 여부를 보지 않았다, #378).
      ? t(standing.onLeave ? 'home.gradeExtendedOnLeave' : 'home.gradeExtended', { n: standing.extraTerms })
      : t(standing.onLeave ? 'home.gradeTermOnLeave' : 'home.gradeTerm', { grade: standing.grade, semester: standing.gradeSemester });
  // 홈 화면 편집에서 고른 메뉴 카드와 순서(utils/homeLayout.js). 모두 뺐으면 메뉴 영역을 그리지 않는다.
  const menuViews = resolveLayout(user?.homeLayout).menu;
  const earnedCredits = status?.totalEarnedCredits ?? 0;
  // 졸업요건 자료가 없거나 엔진이 진단하지 않는 학과·학번(자율전공학부 등)이면 요건 목록이 비어 있다. 예전에는 이걸 "부족한 게 없음"으로
  // 읽어 0%와 "모든 요건을 충족했어요!"가 같이 나왔다(2026-10-15 운영 점검, #378) — 졸업요건 진단 화면과 같은 판정을 쓴다.
  const noData = Boolean(status) && describeRequirementTrust(status, lang).noData;
  const requiredTotal = noData ? null : (status?.totalRequiredCredits ?? null);
  const progressPercent = getPercent(earnedCredits, requiredTotal);

  return (
    <div className="home-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <span className="screen-title">ONE Student</span>
        </div>
        <div className="home-header-actions">
          <button
            type="button"
            className={showEditHint ? 'home-edit-btn hinted' : 'home-edit-btn'}
            onClick={() => {
              dismissEditHint();
              onOpenHomeEdit();
            }}
            aria-label={t('homeEdit.open')}
          >
            <IconEdit size={17} />
          </button>
          {showEditHint && (
            <div className="home-edit-hint" role="status">
              <span>{t('homeEdit.hint')}</span>
              <button type="button" className="home-edit-hint-close" onClick={dismissEditHint} aria-label={t('homeEdit.hintClose')}>
                ×
              </button>
            </div>
          )}
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
                {/* 학년은 한 덩어리로 — 좁은 화면에서 "4 / 학년"처럼 학년 중간에서 줄이 끊기지 않게 한다. */}
                {gradeLabel ? ' ' : ''}
                {gradeLabel ? <span className="nowrap-unit">{gradeLabel}</span> : null}
              </p>
              {gradeLabel && (
                <button className="home-grade-fix-link" onClick={onOpenLeaveSettings}>
                  {t('home.gradeFix')}
                </button>
              )}
            </div>

            {needsOnboarding ? (
              <section className="home-card">
                <p className="home-card-label">{t('home.creditProgress')}</p>
                <p className="home-card-row">{t('home.needOnboarding')}</p>
                {/* 학과를 고르지 않은 계정의 주된 다음 행동이라 작은 글자 링크가 아니라 주 버튼으로 둔다 */}
                <button className="auth-submit-btn" onClick={onOpenOnboarding}>
                  {t('home.chooseDepartment')}
                </button>
              </section>
            ) : (
              <>
              <section className="home-card">
                <p className="home-card-label">{t('home.creditProgress')}</p>
                <div className="home-credit-value">
                  <span className="home-credit-number">{earnedCredits}</span>
                  <span className="home-credit-total">{requiredTotal ? t('home.creditsWithTotal', { total: requiredTotal }) : t('home.creditsUnit')}</span>
                </div>
                {/* 요구 학점을 모르면 진행률(%)도 없다 — 0%로 보이지 않게 막대를 그리지 않는다 */}
                {!noData && (
                  <>
                    <div className="home-progress-track">
                      <div
                        className="home-progress-fill"
                        style={{ width: `${progressPercent}%`, backgroundColor: getProgressColor(progressPercent) }}
                      />
                    </div>
                    <p className="grad-remaining-text">{progressPercent}%</p>
                  </>
                )}
              </section>

              <section className="home-card">
                <p className="home-card-label">{t('home.shortfall')}</p>
                <div
                  className={
                    shortfalls === null || noData
                      ? 'home-card-row'
                      : shortfalls.length > 0
                        ? 'home-card-row shortfall-danger'
                        : 'home-card-row shortfall-ok'
                  }
                >
                  {/* 초록색으로 칠해도 모양 자체가 경고 삼각형이면 "충족했다는데 왜 주의
                      아이콘이지" 하고 헷갈리게 된다(실사용 확인) — 다 충족했을 때는 체크
                      아이콘으로 바꿔서 모양 자체가 상태와 맞게 한다. */}
                  {!noData && shortfalls !== null && shortfalls.length === 0 ? <IconCheck size={15} /> : <IconAlertTriangle />}
                  <span>
                    {noData
                      ? t('home.noData')
                      : shortfalls === null
                      ? t('home.shortfallCheck')
                      : formatShortfallSentence(shortfalls, lang) || t('home.allMet')}
                  </span>
                </div>
              </section>
              </>
            )}
          </>
        )}

        {menuViews.length > 0 && (
          <>
            <p className="home-quick-label">{t('home.menu')}</p>
            <div className="home-quick-actions">
              {menuViews.map((view) => {
                const Icon = TAB_ICONS[view];
                return (
                  <button
                    key={view}
                    className={isLockedView(view, user) ? 'home-quick-btn locked' : 'home-quick-btn'}
                    onClick={openView[view]}
                    aria-label={isLockedView(view, user) ? t('nav.locked', { name: t(TAB_LABEL_KEYS[view]) }) : undefined}
                  >
                    <Icon />
                    <span>{t(TAB_LABEL_KEYS[view])}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Home;
