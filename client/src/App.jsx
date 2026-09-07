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
import PrivacyPolicy from './pages/PrivacyPolicy.jsx';
import TermsOfService from './pages/TermsOfService.jsx';
import BottomTabBar from './components/BottomTabBar.jsx';
import { resetChatCache } from './hooks/useChat.js';
import { getMe, logout } from './api/chatApi.js';

// 탭바가 보이는 화면과, view 값 → 활성 탭 매핑. 과목 관리(courses)는 탭이 없어서
// null — 탭바는 보이되 아무 탭도 강조되지 않는다.
const TAB_BAR_VIEWS = new Set(['home', 'chat', 'courses', 'graduation', 'career']);
const VIEW_TO_TAB = { home: 'home', chat: 'chat', graduation: 'graduation', career: 'career' };

// 하단 탭바가 가리키는 화면들(서로 형제 관계) — 이 화면들끼리 오갈 때는 히스토리를
// 쌓지 않고 한 자리를 계속 갱신해서, 여러 탭을 거쳐도 뒤로가기 한 번이면 항상 홈으로 간다.
const TAB_PEER_VIEWS = new Set(Object.keys(VIEW_TO_TAB));

// ChatInput을 쓰는 화면(채팅/진로 탐색) — 입력창 포커스 시 하단 탭바를 잠깐 숨기는 대상.
const PROMPT_INPUT_VIEWS = new Set(['chat', 'career']);

// 로그아웃/계정 삭제 시 화면별 모듈 스코프 캐시(재진입 깜빡임 방지용)를 전부 비운다 —
// SPA라 페이지가 새로고침되지 않아서, 이걸 안 하면 새 계정으로 들어왔을 때 잠깐 이전
// 계정의 데이터(이수학점, 수강 목록 등)가 그대로 보이는 문제가 있었다(실사용 확인).
function resetAllUserCaches() {
  resetHomeCache();
  resetCourseMgmtCache();
  resetGraduationCache();
  resetProfileCache();
  resetChatCache();
}

/**
 * Main App Component
 * Handles simple routing state (Login/Home/Chat/CourseManagement/GraduationStatus/Settings/Onboarding/Profile pages)
 */
function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  // 'home' | 'chat' | 'courses' | 'graduation' | 'career' | 'settings' | 'onboarding' | 'profile'
  // | 'privacy' | 'terms'
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
  useEffect(() => {
    getMe()
      .then((data) => {
        setUser(data);
        // /privacy, /terms로 직접 들어온 로그인 상태 사용자, 그리고 재인증(reauth)/에러
        // 쿼리로 Profile로 돌아온 경우는 그대로 그 화면을 보여준다 — 그 외에는 기존과 동일하게
        // 온보딩 완료 여부로 시작 화면을 정한다.
        setView((v) =>
          v === 'privacy' || v === 'terms' || v === 'profile' ? v : data.onboardingCompleted ? 'home' : 'onboarding'
        );
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
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

  const [theme, setTheme] = useState(
    () => localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  );
  // 홈의 "학년이 다르신가요?" 링크로 설정에 왔을 때만 휴학 학기 수 입력란을 강조 — 계정
  // 메뉴로 평범하게 들어온 경우엔 안 켜지게 별도 플래그로 관리.
  const [highlightLeaveSemesters, setHighlightLeaveSemesters] = useState(false);
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('fontSize') || 'medium');
  // 채팅/진로 탐색처럼 ChatInput을 쓰는 화면에서 입력창이 포커스를 받으면(모바일 키보드가
  // 뜨면) 하단 탭바를 잠깐 숨겨 입력 공간을 확보한다 — 다른 화면으로 넘어가면 의미 없는
  // 값이니 view가 바뀔 때마다 초기화.
  const [promptInputFocused, setPromptInputFocused] = useState(false);
  useEffect(() => {
    if (!PROMPT_INPUT_VIEWS.has(view)) setPromptInputFocused(false);
  }, [view]);

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
      skipHistoryPush.current = true;
      setView(event.state?.view || 'home');
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
    if (previous !== 'home' && TAB_PEER_VIEWS.has(previous) && TAB_PEER_VIEWS.has(view)) {
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
      setView('home');
    });
  };

  // 계정 삭제는 서버(DELETE /api/me)에서 이미 세션을 파기하므로 /auth/logout을 다시 부를 필요는 없음.
  const handleAccountDeleted = () => {
    resetAllUserCaches();
    skipHistoryPush.current = true;
    setUser(null);
    setView('home');
  };

  return (
    <div className="app-container">
      <div className="app-frame">
        {view === 'privacy' ? (
          <PrivacyPolicy onGoBack={() => setView(user ? 'profile' : 'home')} />
        ) : view === 'terms' ? (
          <TermsOfService onGoBack={() => setView(user ? 'profile' : 'home')} />
        ) : !authChecked ? null : !user ? (
          <Login error={authError} onOpenPrivacy={() => setView('privacy')} onOpenTerms={() => setView('terms')} />
        ) : view === 'chat' ? (
          <Chat
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
            onInputFocusChange={setPromptInputFocused}
          />
        ) : view === 'courses' ? (
          <CourseManagement
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
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
          />
        ) : view === 'career' ? (
          <CareerExploration
            user={user}
            onLogout={handleLogout}
            onGoHome={() => setView('home')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
            onInputFocusChange={setPromptInputFocused}
          />
        ) : view === 'settings' ? (
          <Settings theme={theme} onSetTheme={setTheme} fontSize={fontSize} onSetFontSize={setFontSize} onGoHome={() => setView('home')} />
        ) : view === 'onboarding' ? (
          <Onboarding
            user={user}
            onDone={() => {
              setHighlightLeaveSemesters(false);
              setUser((u) => ({ ...u, onboardingCompleted: true }));
              setView('home');
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
        ) : (
          <Home
            user={user}
            onLogout={handleLogout}
            onOpenCourses={() => setView('courses')}
            onOpenGraduation={() => setView('graduation')}
            onOpenCareer={() => setView('career')}
            onOpenSettings={() => setView('settings')}
            onOpenOnboarding={() => setView('onboarding')}
            onOpenProfile={() => setView('profile')}
            onOpenLeaveSettings={() => {
              setHighlightLeaveSemesters(true);
              setView('onboarding');
            }}
          />
        )}
        {authChecked && user && TAB_BAR_VIEWS.has(view) && !(PROMPT_INPUT_VIEWS.has(view) && promptInputFocused) && (
          <BottomTabBar
            active={VIEW_TO_TAB[view] || null}
            onOpenHome={() => setView('home')}
            onOpenGraduation={() => setView('graduation')}
            onOpenChat={() => setView('chat')}
            onOpenCareer={() => setView('career')}
          />
        )}
      </div>
    </div>
  );
}

export default App;
