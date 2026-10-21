import React, { useEffect, useRef, useState } from 'react';
import Login from './pages/Login.jsx';
import Home, { resetHomeCache } from './pages/Home.jsx';
import Chat from './pages/Chat.jsx';
import CourseManagement, { resetCourseMgmtCache } from './pages/CourseManagement.jsx';
import GraduationStatus, { resetGraduationCache } from './pages/GraduationStatus.jsx';
import CareerExploration from './pages/CareerExploration.jsx';
import Settings from './pages/Settings.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Profile, { resetProfileCache } from './pages/Profile.jsx';
import Community, { resetCommunityCache } from './pages/Community.jsx';
import Admin from './pages/Admin.jsx';
import { resetAdminTrendCache } from './components/AdminTrendView.jsx';
import Inquiry from './pages/Inquiry.jsx';
import ConsentGate from './pages/ConsentGate.jsx';
import LeaveGate from './pages/LeaveGate.jsx';
import TrackTypeGate from './pages/TrackTypeGate.jsx';
import PrivacyPolicy from './pages/PrivacyPolicy.jsx';
import TermsOfService from './pages/TermsOfService.jsx';
import BottomTabBar from './components/BottomTabBar.jsx';
import HomeEdit from './pages/HomeEdit.jsx';
import { resolveLayout, isLockedView } from './utils/homeLayout.js';
import { resetChatCache } from './hooks/useChat.js';
import useTextInputFocused from './hooks/useTextInputFocused.js';
import useClearStaleSelection from './hooks/useClearStaleSelection.js';
import { getMe, logout, getUnseenReportCount, updateProfile } from './api/chatApi.js';
import { readCache, writeCache, clearCache } from './utils/sessionCache.js';
import { consumeLanguageChosenBeforeLogin, useI18n } from './i18n/I18nContext.jsx';

// 탭바가 보이는 화면. 하단 바 4칸은 사용자가 홈 화면 편집에서 고르므로(utils/homeLayout.js) 고른 화면(예: 문의하기)도 더한다.
// 탭에 없는 화면(기본 배치의 과목 관리)은 탭바는 보이되 아무 탭도 강조되지 않는다. 하단 바를 끈 사용자(showTabBar=false)에게는 어디서도 보이지 않는다.
const BASE_TAB_BAR_VIEWS = ['home', 'chat', 'courses', 'graduation', 'career', 'community'];
// 화면 아래에 입력창(prompt-bar)이 있는 화면 — 챗봇 버튼만 띄우는 하단 바를 여기서는 그리지 않는다.
const INPUT_BAR_VIEWS = ['chat', 'career'];

// 하단 탭바가 가리키는 화면들(서로 형제 관계) = 홈·챗봇 + 사용자가 고른 4칸 — 이 화면들끼리 오갈 때는 히스토리를
// 쌓지 않고 한 자리를 계속 갱신해서, 여러 탭을 거쳐도 뒤로가기 한 번이면 항상 홈으로 간다.
function tabPeerViews(user) {
  return new Set(['home', 'chat', ...resolveLayout(user?.homeLayout).tabs.filter(Boolean)]);
}

// 로그아웃/계정 삭제 시 화면별 모듈 스코프 캐시(재진입 깜빡임 방지용)를 전부 비운다 —
// SPA라 페이지가 새로고침되지 않아서, 이걸 안 하면 새 계정으로 들어왔을 때 잠깐 이전
// 계정의 데이터(이수학점, 수강 목록 등)가 그대로 보이는 문제가 있었다(실사용 확인).
function resetAllUserCaches() {
  resetHomeCache();
  resetCourseMgmtCache();
  resetGraduationCache();
  resetProfileCache();
  resetChatCache();
  resetCommunityCache();
  resetAdminTrendCache();
}

/**
 * Main App Component
 * Handles simple routing state (Login/Home/Chat/CourseManagement/GraduationStatus/Settings/Onboarding/Profile pages)
 */
function App() {
  const { lang, languageChosen, setLang } = useI18n();
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  // 'home' | 'chat' | 'courses' | 'graduation' | 'career' | 'settings' | 'onboarding' | 'profile'
  // | 'admin' | 'inquiry' | 'privacy' | 'terms'
  // privacy/terms는 Google OAuth 동의 화면 검증용으로 로그인 여부와 무관하게 접근 가능해야
  // 하고, Google이 URL을 직접 방문해서 확인하므로 최초 로드 시 실제 pathname(/privacy,
  // /terms)을 봐서 시작 화면을 정한다 — 이 SPA는 다른 화면 전환에는 URL을 안 쓰지만
  // (history.pushState는 state 객체만 씀, pathname은 항상 '/'), 이 두 화면만 예외.
  //
  // reauth(계정 삭제 재인증)/authError 쿼리로 돌아온 경우도 마찬가지 이유로 초기값에서 처리
  // 한다 — Google 재인증은 풀 페이지 리다이렉트라 브라우저가 완전히 새로 로드되면서 이전에
  // Profile 화면에 있었다는 사실 자체가 사라지는데(모든 React 상태가 초기화됨), 기본값인
  // 'home'으로 떨어지면 재인증 후 계정 삭제 버튼이 뜨는 Profile로 못 돌아간다(실제로 겪은
  // 버그) — 그래서 이 두 쿼리가 있으면 시작 화면을 'profile'로 잡는다.
  const [view, setView] = useState(() => {
    const path = window.location.pathname.replace(/\/+$/, '');
    if (path === '/privacy') return 'privacy';
    if (path === '/terms') return 'terms';
    const params = new URLSearchParams(window.location.search);
    if (params.get('reauth') || params.get('authError')) return 'profile';
    // 새로고침하면 React 상태(view)가 사라져 항상 홈으로 돌아가는데, 새 문의·신고를 확인하려고 새로고침하는
    // 관리자가 많다 — 관리자 화면에 있었다면 sessionStorage에 남겨둔 표시로 그 화면에서 시작한다. 이 값은
    // "관리자였다"는 힌트일 뿐이라 로그인 확인 후 role을 다시 검사한다(loadUser, 아래 렌더 가드).
    if (readCache('app_view') === 'admin') return 'admin';
    return 'home';
  });

  // Google OAuth 콜백(로그인/재인증 공통, server/routes/auth.js 참고)은 풀 페이지 리다이렉트로
  // 끝나서 결과를 동기 응답으로 못 받는다 — 대신 리다이렉트 URL의 쿼리 파라미터(authError/
  // reauth)로 결과를 실어 보내고, 여기서 한 번만 읽어 상태로 남긴 뒤 새로고침 시 재노출되지
  // 않도록 URL에서 제거한다(기존 popstate 히스토리 관리와 같은 결).
  const [authError, setAuthError] = useState(null);
  const [justReauthenticated, setJustReauthenticated] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('authError');
    const reauth = params.get('reauth');
    if (err) setAuthError(err);
    if (reauth) setJustReauthenticated(true);
    if (err || reauth) {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, []);

  // 새로고침/재방문 시 세션 쿠키가 유효하면 로그인 화면을 건너뛰고 복원.
  // 이 조회가 끝나기 전까진(authChecked === false) 로그인 화면을 잠깐이라도
  // 보여주지 않기 위해 렌더링을 보류한다.
  // 구글 로그인(풀 페이지 리다이렉트)과 이메일 인증코드 로그인(fetch 응답으로 즉시 종료) 둘 다
  // 로그인 성공 후 이 함수로 사용자 상태를 채운다 — 구글은 마운트 시 세션 쿠키 복원으로,
  // 이메일 로그인은 Login.jsx가 성공 직후 직접 호출해서 같은 경로를 탄다.
  const loadUser = () => {
    return getMe()
      .then((data) => {
        setUser(data);
        // /privacy, /terms로 직접 들어온 로그인 상태 사용자, 그리고 재인증(reauth)/에러
        // 쿼리로 Profile로 돌아온 경우는 그대로 그 화면을 보여준다 — 그 외에는 기존과 동일하게
        // 온보딩 완료 여부로 시작 화면을 정한다.
        // 'admin'은 서버가 알려준 role이 admin일 때만 유지한다(sessionStorage 값만 믿지 않음) — 관리자가 아니면 홈으로.
        setView((v) =>
          v === 'privacy' || v === 'terms' || v === 'profile' || (v === 'admin' && data.role === 'admin')
            ? v
            : data.onboardingCompleted
              ? 'home'
              : 'onboarding'
        );
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadUser().finally(() => setAuthChecked(true));
  }, []);

  // 모바일 키보드가 뜨면 .app-frame의 높이를 실제 보이는 영역(visualViewport)에 맞춰
  // 갱신한다 — CSS의 100dvh만으로는 브라우저에 따라 키보드가 떠도 줄어들지 않는 경우가
  // 있어(특히 iOS Safari 구버전), 레이아웃 뷰포트가 키보드에 가려진 만큼 문서가 화면보다
  // 커진 것으로 처리돼 브라우저가 포커스된 입력창을 보이게 하려고 페이지 전체를 스크롤해
  // 버린다. 그 결과 상단 헤더까지 화면 밖으로 밀려났다(실사용 피드백). visualViewport
  // 높이를 CSS 변수로 직접 반영하면 .app-frame이 실제 보이는 만큼만 차지해 그런 스크롤이
  // 애초에 필요 없어진다.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const syncViewportHeight = () => {
      document.documentElement.style.setProperty('--app-vh', `${vv.height}px`);
      window.scrollTo(0, 0);
    };
    syncViewportHeight();
    vv.addEventListener('resize', syncViewportHeight);
    vv.addEventListener('scroll', syncViewportHeight);
    return () => {
      vv.removeEventListener('resize', syncViewportHeight);
      vv.removeEventListener('scroll', syncViewportHeight);
    };
  }, []);

  // 관리자 화면에 있는 동안만 표시를 남기고, 다른 화면으로 가면(로그아웃 포함 — handleLogout이 view를 home으로 돌림) 지운다.
  // 로그인 확인이 끝난 뒤에만 쓴다 — 확인 전에 지우면 새로고침 직후 초기값 'admin'이 사라진다.
  useEffect(() => {
    if (!authChecked) return;
    if (view === 'admin') writeCache('app_view', 'admin');
    else clearCache('app_view');
  }, [view, authChecked]);

  // 화면 언어를 계정에 저장한다 — 기기·브라우저를 바꿔도 같은 언어로 시작하게 하려는 것(students.language).
  // 저장에 실패해도 화면은 이미 바뀌었고 브라우저에도 저장돼 있어서 조용히 넘어간다(다음에 바꿀 때 다시 저장됨).
  const saveAccountLanguage = (code) => {
    updateProfile({ language: code })
      .then(() => setUser((u) => (u ? { ...u, language: code } : u)))
      .catch(() => {});
  };

  // 로그인(또는 새로고침으로 세션이 복원)된 직후 한 번, 어느 쪽 언어를 따를지 정한다. 우선순위:
  //  1) 로그인 화면에서 방금 고른 언어 — 그 선택을 계정에 저장한다(Google 로그인은 페이지가 새로 로드되므로 sessionStorage 표시를 쓴다).
  //  2) 계정에 저장된 언어 — 다른 기기에서 정한 것이라도 따른다.
  //  3) 계정에 없고 이 브라우저에서 직접 고른 적이 있으면 그 언어를 계정에 저장한다(기존 계정의 첫 로그인).
  //  4) 둘 다 없으면 기본값(한국어)을 그대로 두고 아무것도 저장하지 않는다.
  // user.id가 바뀔 때만 실행한다 — 이후 user 객체가 갱신될 때마다 다시 돌면 방금 바꾼 언어를 계정 값으로 되돌려 버린다.
  useEffect(() => {
    if (!user) return;
    const chosenBeforeLogin = consumeLanguageChosenBeforeLogin();
    if (chosenBeforeLogin) {
      if (chosenBeforeLogin !== user.language) saveAccountLanguage(chosenBeforeLogin);
    } else if (user.language) {
      if (user.language !== lang) setLang(user.language);
    } else if (languageChosen) {
      saveAccountLanguage(lang);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 로그인 직후 한 번만 판단한다(위 주석).
  }, [user?.id]);

  // 처음 방문(저장된 선택 없음)은 OS 설정과 무관하게 라이트 — 전체 학과 기준으로 라이트가 더 범용적이라서.
  // 설정에서 한 번 고르면 그 값이 저장돼 이후엔 그대로 따른다.
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  // 홈의 "학년이 다르신가요?" 링크로 설정에 왔을 때만 휴학 학기 수 입력란을 강조 — 계정
  // 메뉴로 평범하게 들어온 경우엔 안 켜지게 별도 플래그로 관리.
  const [highlightLeaveSemesters, setHighlightLeaveSemesters] = useState(false);
  // 관리자 신고함에서 "그 글로 이동"을 누르면 커뮤니티 화면을 그 글이 열린 상태로 띄운다 —
  // Community.jsx가 마운트 시 한 번 소비하고 onInitialPostConsumed로 다시 null로 돌려놔야,
  // 나중에 하단 탭바로 평범하게 커뮤니티에 들어갔을 때 같은 글이 또 열리지 않는다.
  const [communityInitialPostId, setCommunityInitialPostId] = useState(null);
  // 신고자가 아직 확인하지 않은 신고 처리 결과 수 — 하단 탭바 커뮤니티 아이콘의 점과 커뮤니티 "내 신고" 탭 점에 쓴다.
  // 화면을 옮길 때마다 가볍게 다시 확인한다(커뮤니티를 보고 있을 땐 그 화면이 직접 0으로 맞춘다). 실패는 조용히 무시.
  const [unseenReportCount, setUnseenReportCount] = useState(0);
  useEffect(() => {
    if (!user || view === 'community') return;
    let cancelled = false;
    getUnseenReportCount()
      .then((count) => {
        if (!cancelled) setUnseenReportCount(count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, view]);
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('fontSize') || 'medium');
  // 어느 화면이든 글자를 입력하는 칸이 포커스를 받으면(모바일 키보드가 뜨면) 하단 탭바를 숨겨
  // 입력 공간을 확보한다 — 채팅·진로 탐색뿐 아니라 커뮤니티 글쓰기/검색, 과목 검색·직접 입력 등
  // 탭바가 보이는 모든 화면이 같은 기준을 쓴다(화면마다 콜백을 내려주지 않아도 된다).
  const textInputFocused = useTextInputFocused(view);
  // 홈 등에서 글자를 클릭해 둔 채 다른 화면으로 가면 그 자리의 커서가 허공에 남는 문제 방지.
  useClearStaleSelection(view);

  // 모바일에서 뒤로가기(제스처/버튼)를 누르면 앱을 벗어나 이전 브라우저 페이지로
  // 나가버리는 문제 방지: 화면 전환마다 히스토리 항목을 쌓아서, 뒤로가기를
  // 누르면 브라우저를 떠나기 전에 앱 내부 화면을 먼저 오가도록 함.
  // 로그인 성공 시점의 화면이 "루트"가 되도록 replaceState로 시작하고,
  // 이후 화면 전환은 pushState로 쌓는다. popstate(뒤로/앞으로가기)로 들어온
  // 변경은 다시 push하지 않도록 skipHistoryPush로 구분한다.
  const skipHistoryPush = useRef(true);
  const previousView = useRef(view);

  useEffect(() => {
    function handlePopState(event) {
      const nextView = event.state?.view || 'home';
      // 화면이 실제로 바뀔 때만 다음 이펙트의 히스토리 쌓기를 건너뛴다 — 같은 화면 안의 하위 화면(검색 화면, 커뮤니티 상세 등)을
      // 닫는 뒤로가기에서도 켜 두면, 이펙트가 돌지 않아 표시가 남았다가 다음 화면 이동이 히스토리를 쌓지 않게 된다.
      if (nextView !== previousView.current) skipHistoryPush.current = true;
      setView(nextView);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!user) return;
    const previous = previousView.current;
    previousView.current = view;

    if (skipHistoryPush.current) {
      window.history.replaceState({ view }, '');
      skipHistoryPush.current = false;
      return;
    }
    // 홈이 아닌 탭에서 다른 탭으로 이동하는 경우(형제 탭끼리 이동)에는 새로 쌓지 않고
    // 같은 자리를 갱신한다. 홈 → 탭(첫 진입)만 예외적으로 쌓아서, 뒤로가기를 누르면
    // 몇 번을 오갔든 항상 홈으로 한 번에 돌아가게 한다.
    const peers = tabPeerViews(user);
    if (previous !== 'home' && peers.has(previous) && peers.has(view)) {
      window.history.replaceState({ view }, '');
      return;
    }
    window.history.pushState({ view }, '');
  }, [view, user]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.fontSize = fontSize;
    localStorage.setItem('fontSize', fontSize);
  }, [fontSize]);

  const handleLogout = () => {
    logout().finally(() => {
      resetAllUserCaches();
      skipHistoryPush.current = true;
      setUser(null);
      setJustReauthenticated(false);
      setView('home');
    });
  };

  // 계정 삭제는 서버(DELETE /api/me)에서 이미 세션을 파기하므로 /auth/logout을 다시 부를 필요는 없음.
  // justReauthenticated(구글 재인증 성공 플래그)를 여기서 반드시 초기화해야 한다 — 안 그러면
  // 같은 탭에서 새로고침 없이 다른 계정으로 다시 로그인했을 때, 그 계정 재인증 없이 Profile의
  // 삭제 버튼이 곧바로 활성화되는 문제가 생긴다(실사용 중 발견 — 구글 계정 삭제 후 이메일
  // 계정으로 로그인하니 재인증 없이 삭제 버튼이 뜸).
  const handleAccountDeleted = () => {
    resetAllUserCaches();
    skipHistoryPush.current = true;
    setUser(null);
    setJustReauthenticated(false);
    setView('home');
  };

  // 하단 바 4칸·켜기/끄기(홈 화면 편집 설정)와 그에 따른 탭바 표시 화면·형제 탭.
  const homeLayout = resolveLayout(user?.homeLayout);
  const layoutTabs = homeLayout.tabs;
  const tabPeers = tabPeerViews(user);
  // 4자리를 모두 비우면 챗봇 버튼만 내용 위에 띄운다(바가 자리를 차지하지 않는다). 아래에 입력창이 있는 화면(채팅·진로 탐색)에서는
  // 떠 있는 버튼이 입력창을 가리므로 그리지 않는다(진로 탐색은 2026-10-22 피드백).
  const chatOnly = layoutTabs.every((v) => !v);
  const tabBarVisible =
    homeLayout.showTabBar && (BASE_TAB_BAR_VIEWS.includes(view) || layoutTabs.includes(view)) && !(chatOnly && INPUT_BAR_VIEWS.includes(view));

  // 홈 메뉴·하단 바에서 화면을 연다. 학과를 고르지 않은 계정이 학과가 필요한 기능(과목 관리·졸업요건 진단·진로 탐색)을 누르면 학과 선택으로 보낸다.
  const openView = (next) => setView(isLockedView(next, user) ? 'onboarding' : next);

  return (
    <div className="app-container">
      <div className={tabBarVisible && chatOnly ? 'app-frame floating-chat' : 'app-frame'}>
        {view === 'privacy' ? (
          <PrivacyPolicy onGoBack={() => setView(user ? 'profile' : 'home')} />
        ) : view === 'terms' ? (
          <TermsOfService onGoBack={() => setView(user ? 'profile' : 'home')} />
        ) : !authChecked ? null : !user ? (
          <Login
            error={authError}
            onOpenPrivacy={() => setView('privacy')}
            onOpenTerms={() => setView('terms')}
            onLoginSuccess={loadUser}
          />
        ) : user.consentRequired ? (
          // 이용약관·개인정보 수집·이용 동의 기록이 없거나 옛 버전이면 동의할 때까지 다른 화면에 들어가지 못한다.
          <ConsentGate
            onAccepted={() => setUser((u) => ({ ...u, consentRequired: false }))}
            onDecline={handleLogout}
            onOpenPrivacy={() => setView('privacy')}
            onOpenTerms={() => setView('terms')}
          />
        ) : user.leaveAnswerRequired && view !== 'onboarding' ? (
          // 휴학 기간을 받기 전에 온보딩을 마친 계정은 한 번 휴학 질문에 답해야 다른 화면으로 간다(온보딩 수정 화면에서도 답할 수 있다).
          <LeaveGate user={user} onSaved={(updated) => setUser(updated)} />
        ) : user.trackTypeAnswerRequired && view !== 'onboarding' ? (
          // 이수유형을 받기 전에 온보딩을 마친 광역 계열전공 계정은 한 번 이수유형을 골라야 다른 화면으로 간다(#378 결정 3-4 A).
          <TrackTypeGate onSaved={(updated) => setUser(updated)} />
        ) : view === 'chat' ? (
          <Chat
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
          />
        ) : view === 'courses' ? (
          <CourseManagement
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
            onOpenAdmin={() => setView('admin')}
            onOpenInquiry={() => setView('inquiry')}
          />
        ) : view === 'graduation' ? (
          <GraduationStatus
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenCourses={() => setView('courses')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
            onOpenAdmin={() => setView('admin')}
            onOpenInquiry={() => setView('inquiry')}
          />
        ) : view === 'career' ? (
          <CareerExploration
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
            onOpenAdmin={() => setView('admin')}
            onOpenInquiry={() => setView('inquiry')}
          />
        ) : view === 'community' ? (
          <Community
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
            onOpenAdmin={() => setView('admin')}
            onOpenInquiry={() => setView('inquiry')}
            initialPostId={communityInitialPostId}
            onInitialPostConsumed={() => setCommunityInitialPostId(null)}
            unseenReportCount={unseenReportCount}
            onUnseenReportsChange={setUnseenReportCount}
          />
        ) : view === 'settings' ? (
          <Settings
            theme={theme}
            onSetTheme={setTheme}
            fontSize={fontSize}
            onSetFontSize={setFontSize}
            onGoHome={() => setView('home')}
            onLanguageChange={saveAccountLanguage}
          />
        ) : view === 'onboarding' ? (
          <Onboarding
            user={user}
            onDone={() => {
              setHighlightLeaveSemesters(false);
              // onboardingCompleted만 patch하면 방금 입력한 학과/학번/트랙 등은 user에 반영이
              // 안 돼(Home/CourseManagement가 그 값들을 user prop에서 직접 읽으므로) — 서버에서
              // 다시 fetch해서 완전히 최신 상태로 맞춘다.
              loadUser().finally(() => setView('home'));
            }}
            onSkip={() => {
              setHighlightLeaveSemesters(false);
              setView('home');
            }}
            highlightLeaveSemesters={highlightLeaveSemesters}
          />
        ) : view === 'profile' ? (
          <Profile
            user={user}
            onGoHome={() => setView('home')}
            onNameChanged={(name) => setUser((u) => ({ ...u, name }))}
            onAccountDeleted={handleAccountDeleted}
            justReauthenticated={justReauthenticated}
          />
        ) : view === 'admin' && user.role === 'admin' ? (
          <Admin
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
            onOpenInquiry={() => setView('inquiry')}
            onOpenPost={(postId) => {
              setCommunityInitialPostId(postId);
              setView('community');
            }}
          />
        ) : view === 'inquiry' ? (
          <Inquiry onGoHome={() => setView('home')} />
        ) : view === 'homeEdit' ? (
          <HomeEdit
            user={user}
            onCancel={() => setView('home')}
            onSaved={(updated) => {
              setUser(updated);
              setView('home');
            }}
          />
        ) : (
          <Home
            user={user}
            onLogout={handleLogout}
            onOpenCourses={() => openView('courses')}
            onOpenGraduation={() => openView('graduation')}
            onOpenCareer={() => openView('career')}
            onOpenCommunity={() => setView('community')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
            onOpenAdmin={() => setView('admin')}
            onOpenInquiry={() => setView('inquiry')}
            onOpenHomeEdit={() => setView('homeEdit')}
            onOpenLeaveSettings={() => {
              setHighlightLeaveSemesters(true);
              setView('onboarding');
            }}
          />
        )}
        {authChecked && user && !user.consentRequired && !user.leaveAnswerRequired && !user.trackTypeAnswerRequired && tabBarVisible && !textInputFocused && (
          <BottomTabBar
            tabs={layoutTabs}
            active={tabPeers.has(view) ? view : null}
            onOpen={openView}
            isLocked={(v) => isLockedView(v, user)}
            communityBadge={unseenReportCount > 0}
          />
        )}
      </div>
    </div>
  );
}

export default App;
