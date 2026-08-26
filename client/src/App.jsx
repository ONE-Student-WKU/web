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
import BottomTabBar from './components/BottomTabBar.jsx';
import { resetChatCache } from './hooks/useChat.js';
import { getMe, logout } from './api/chatApi.js';

// 탭바가 보이는 화면과, view 값 → 활성 탭 매핑. 과목 관리(courses)는 탭이 없어서
// null — 탭바는 보이되 아무 탭도 강조되지 않는다.
const TAB_BAR_VIEWS = new Set(['home', 'chat', 'courses', 'graduation', 'career']);
const VIEW_TO_TAB = { home: 'home', chat: 'chat', graduation: 'graduation', career: 'career' };

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
  const [view, setView] = useState('home'); // 'home' | 'chat' | 'courses' | 'graduation' | 'career' | 'settings' | 'onboarding' | 'profile'

  // 새로고침/재방문 시 세션 쿠키가 유효하면 로그인 화면을 건너뛰고 복원.
  // 이 조회가 끝나기 전까진(authChecked === false) 로그인 화면을 잠깐이라도
  // 보여주지 않기 위해 렌더링을 보류한다.
  useEffect(() => {
    getMe()
      .then((data) => {
        setUser(data);
        setView(data.onboardingCompleted ? 'home' : 'onboarding');
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  const [theme, setTheme] = useState(
    () => localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  );
  // 홈의 "학년이 다르신가요?" 링크로 설정에 왔을 때만 휴학 학기 수 입력란을 강조 — 계정
  // 메뉴로 평범하게 들어온 경우엔 안 켜지게 별도 플래그로 관리.
  const [highlightLeaveSemesters, setHighlightLeaveSemesters] = useState(false);
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('fontSize') || 'medium');

  // 모바일에서 뒤로가기(제스처/버튼)를 누르면 앱을 벗어나 이전 브라우저 페이지로
  // 나가버리는 문제 방지: 화면 전환마다 히스토리 항목을 쌓아서, 뒤로가기를
  // 누르면 브라우저를 떠나기 전에 앱 내부 화면을 먼저 오가도록 함.
  // 로그인 성공 시점의 화면이 "루트"가 되도록 replaceState로 시작하고,
  // 이후 화면 전환은 pushState로 쌓는다. popstate(뒤로/앞으로가기)로 들어온
  // 변경은 다시 push하지 않도록 skipHistoryPush로 구분한다.
  const skipHistoryPush = useRef(true);

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
    if (skipHistoryPush.current) {
      window.history.replaceState({ view }, '');
      skipHistoryPush.current = false;
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
        {!authChecked ? null : !user ? (
          <Login
            onLoginSuccess={(userData) => {
              setUser(userData);
              setView(userData.onboardingCompleted ? 'home' : 'onboarding');
            }}
          />
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
          />
        ) : view === 'settings' ? (
          <Settings theme={theme} onSetTheme={setTheme} fontSize={fontSize} onSetFontSize={setFontSize} onGoHome={() => setView('home')} />
        ) : view === 'onboarding' ? (
          <Onboarding
            user={user}
            onDone={() => {
              setUser((u) => ({ ...u, onboardingCompleted: true }));
              setView('home');
            }}
            onSkip={() => setView('home')}
          />
        ) : view === 'profile' ? (
          <Profile
            user={user}
            onGoHome={() => {
              setHighlightLeaveSemesters(false);
              setView('home');
            }}
            onNameChanged={(name) => setUser((u) => ({ ...u, name }))}
            onAccountDeleted={handleAccountDeleted}
            highlightLeaveSemesters={highlightLeaveSemesters}
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
              setView('profile');
            }}
          />
        )}
        {authChecked && user && TAB_BAR_VIEWS.has(view) && (
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
