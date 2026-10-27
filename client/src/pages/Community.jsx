import React, { useEffect, useRef, useState } from 'react';
import {
  getCommunityPosts,
  getMyCommunityPosts,
  getCommunityPost,
  createCommunityPost,
  editCommunityPost,
  deleteCommunityPost,
  deleteAdminPost,
  closeCommunityPost,
  applyToCommunityPost,
  getMyCommunityApplications,
  getCommunityApplicants,
  acceptCommunityApplication,
  rejectCommunityApplication,
  reportCommunityPost,
  reportCommunityApplication,
  getMySanction,
  getMyReports,
  markMyReportsSeen,
  getNotices,
  markNoticeRead,
  markAllNoticesRead,
  blockCommunityContact,
} from '../api/chatApi.js';
import AccountMenu from '../components/AccountMenu.jsx';
import SearchScreen from '../components/SearchScreen.jsx';
import StudentSanctionDialog from '../components/StudentSanctionDialog.jsx';
import CommunityNotices, { NoticePin } from '../components/CommunityNotices.jsx';
import { ContactBox, ContactBlockedNote, BlockContactDialog } from '../components/ContactRelay.jsx';
import TargetDepartmentsField from '../components/TargetDepartmentsField.jsx';
import MoreMenu from '../components/MoreMenu.jsx';
import useSearchInput from '../hooks/useSearchInput.js';
import { IconChevronLeft, IconCheck, IconPlus, IconX, IconBan, IconAlertTriangle, IconSearch } from '../components/icons.jsx';
import LoadError from '../components/LoadError.jsx';
import { readCache, writeCache, clearCache } from '../utils/sessionCache.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import { track } from '../utils/track.js';

// Home.jsx와 동일한 이유(재진입 시 빈 화면 깜빡임 방지)로 모듈 스코프에 캐시해둔다.
// sessionStorage에서 초기값을 복원해서, 탭이 살아있는 채로 페이지가 다시 로드되는 경우
// (utils/sessionCache.js 참고)에도 즉시 보여줄 수 있다.
const communityCache = {
  posts: readCache('community_posts'),
  myPosts: readCache('community_myPosts'),
  myApplications: readCache('community_myApplications'),
  notices: readCache('community_notices'),
};

function setCommunityCache(key, value) {
  communityCache[key] = value;
  writeCache(`community_${key}`, value);
}

// App.jsx의 resetAllUserCaches가 로그아웃/계정 삭제 시 호출.
// eslint-disable-next-line react-refresh/only-export-components -- App.jsx가 재사용하는 캐시 리셋 함수라 의도적으로 컴포넌트와 같이 export함.
export function resetCommunityCache() {
  communityCache.posts = null;
  communityCache.myPosts = null;
  communityCache.myApplications = null;
  communityCache.notices = null;
  clearCache('community_posts');
  clearCache('community_myPosts');
  clearCache('community_myApplications');
  clearCache('community_notices');
}

// 상태·구분 라벨과 기본 처리 안내 문구는 i18n 사전(community.postStatus.* / appStatus.* / reportStatus.* / category.* / defaultResolution)에 있다.
// 관리자가 처리 안내를 비워 두고 처리했을 때 신고자에게 보여주는 기본 문구는 Admin.jsx의 기본 입력값(한국어)과 같은 뜻이다.
const MAX_RECRUIT_DAYS = 365;

// 이펙트나 openPost처럼 번역 함수에 의존시키고 싶지 않은 곳의 오류는 문구 대신 사전 키를 담고, 렌더에서 번역한다(errorText).
const ERR = {
  loadPosts: { key: 'community.err.loadPosts' },
  loadMine: { key: 'community.err.loadMine' },
  loadReports: { key: 'community.err.loadReports' },
  loadApps: { key: 'community.err.loadApps' },
  loadApplicants: { key: 'community.err.loadApplicants' },
  loadPost: { key: 'community.err.loadPost' },
};
const LOAD_ERR_BY_TAB = { list: ERR.loadPosts, mine: ERR.loadMine, reports: ERR.loadReports, applications: ERR.loadApps };

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

// 'YYYY-MM-DD'(모집 마감일) → 'M.DD'. 시간대 변환 없이 문자열만 나눈다(날짜만 있는 값이라 Date로 바꾸면 하루가 밀릴 수 있다).
function formatDeadline(dateStr) {
  const [, m, d] = String(dateStr).split('-');
  return `${Number(m)}.${d}`;
}

// 마감일 입력칸의 범위(오늘 ~ 1년 뒤). 서버가 최종 검증하고 이건 입력 편의용이다.
function toDateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// 직접 마감했거나 마감일이 지난 글 — 목록·상세에서 제목 앞 "마감" 표시와 흐리게 보이기, 신청 막기에 같은 기준을 쓴다.
// 서버가 recruitState를 아직 안 내려주는 배포 순서(프론트 먼저)에서는 undefined라 closedAt만 본다.
function isRecruitClosed(closedAt, recruitState) {
  return Boolean(closedAt) || recruitState === 'ended';
}

// 새 글의 빈 입력값. 모집 학과는 보통 같은 학과 학생을 찾으므로 글쓴이 학과를 미리 골라 둔다(학과가 없으면 학과 상관없음).
function emptyWriteFields(user) {
  const own = user?.departmentId ? [{ id: user.departmentId, name: user.department }] : [];
  return { title: '', body: '', category: 'study', capacity: '', recruitEndDate: '', deptMode: own.length ? 'specific' : 'any', departments: own };
}

// 목록의 모집 학과 줄 — 2개까지는 이름을 다 쓰고, 3개면 "A, B 외 1개"(전체는 상세에서). 학과 상관없는 글(이 기능 전에 올린 글 포함)은 "모든 학과".
const LIST_DEPARTMENT_NAMES = 2;
function departmentLine(targetDepartments, t) {
  const names = (targetDepartments || []).map((d) => d.name);
  if (names.length === 0) return t('community.dept.all');
  if (names.length <= LIST_DEPARTMENT_NAMES) return names.join(', ');
  return t('community.dept.more', { names: names.slice(0, LIST_DEPARTMENT_NAMES).join(', '), n: names.length - LIST_DEPARTMENT_NAMES });
}

// "내 학과 글만 보기"는 이 브라우저에만 기억한다(저장이 막힌 환경에서는 매번 꺼진 채로 시작).
const MY_DEPT_ONLY_KEY = 'community_myDeptOnly';
function readMyDeptOnly() {
  try {
    return localStorage.getItem(MY_DEPT_ONLY_KEY) === '1';
  } catch {
    return false;
  }
}
function writeMyDeptOnly(on) {
  try {
    localStorage.setItem(MY_DEPT_ONLY_KEY, on ? '1' : '0');
  } catch {
    // 저장하지 못해도 이번 화면에서는 그대로 동작한다
  }
}

// 글 작성·수정·신청이 막히는 경고성 제재(post_apply) 안내 배너 — 목록 상단, 글 상세, 글쓰기/수정 폼에서
// 같은 문구를 쓰도록 한 곳에 둔다(수정만 안내가 없던 문제, 서버는 PATCH /:id에도 같은 제재를 건다).
function SanctionBanner({ sanction }) {
  const { t, tRich } = useI18n();
  const when = sanction.endsAt ? t('community.sanction.untilDate', { date: formatDate(sanction.endsAt) }) : t('community.sanction.permanent');
  return (
    <div className="community-sanction-banner">
      <IconAlertTriangle size={16} />
      <p>{tRich('community.sanction.banner', { when, reason: sanction.reason })}</p>
    </div>
  );
}

// 글쓰기 입력 한도 — 서버(routes/community.js)의 TITLE_MAX_LENGTH, normalizeCapacity와 같다.
const TITLE_MAX = 20;
const MAX_CAPACITY = 999;

// 'YYYY-MM-DD' 두 날짜 사이 날 수 — 시간대 영향 없이 날짜만 비교한다.
function daysBetween(from, to) {
  const toUtc = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86400000);
}

// 마감까지 3일 안이면 빨강으로 재촉하고, 그 전에는 파랑으로 남은 날만 알린다.
const SOON_DAYS = 3;

/**
 * 모집 상태 한 낱말 — 끝났으면 "마감", 마감일이 있으면 "D-n"(당일은 "오늘 마감"), 없으면 "모집 중".
 * 색은 상태에만 쓴다(구분·학과는 조용히): soon=빨강, open=파랑, off=회색.
 */
function RecruitState({ closedAt, recruitState, recruitEndDate }) {
  const { t } = useI18n();
  let label;
  let tone = 'open';
  if (isRecruitClosed(closedAt, recruitState)) {
    label = t('community.state.closed');
    tone = 'off';
  } else if (!recruitEndDate) {
    label = t('community.state.open');
  } else {
    const left = daysBetween(toDateInputValue(new Date()), recruitEndDate);
    label = left <= 0 ? t('community.state.today') : t('community.state.dday', { n: left });
    if (left <= SOON_DAYS) tone = 'soon';
  }
  return <span className={`post-state post-state--${tone}`}>{label}</span>;
}

// 구분(스터디·팀 활동)은 작은 색 점 + 글자로 조용히 표시한다.
function CategoryLabel({ category }) {
  const { t } = useI18n();
  return <span className={`post-cat post-cat--${category}`}>{t(`community.category.${category}`)}</span>;
}

// 승인·수락·반려 같은 상태 — 색 배지 대신 점 + 글자. end면 줄 오른쪽 끝으로 민다.
const POST_STATUS_TONE = { pending: 'wait', approved: 'ok', rejected: 'no' };
const APP_STATUS_TONE = { pending: 'wait', accepted: 'ok', rejected: 'no' };
function StatusText({ tone, end = false, children }) {
  return <span className={`post-status post-status--${tone || 'mute'}${end ? ' post-status--end' : ''}`}>{children}</span>;
}

// 닉네임 첫 글자 동그라미 — 글쓴이·신청자를 한눈에 구분하는 자리표시(사진은 받지 않는다).
function Avatar({ name }) {
  return (
    <span className="post-avatar" aria-hidden="true">
      {String(name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

function MetaSep() {
  return <span className="post-meta-sep" aria-hidden="true" />;
}

// 목록에서 제목 아래 한 줄로 보여줄 본문 — 첫 번째 빈 줄이 아닌 줄(CSS가 한 줄로 자른다).
function excerptOf(body) {
  return (
    String(body || '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || ''
  );
}

// 글 날짜 — 일주일 안은 "오늘·어제·n일 전", 그 뒤는 "10월 3일", 해가 다르면 "2025.12.30".
function formatWhen(dateStr, t) {
  const d = new Date(dateStr);
  const now = new Date();
  const ago = daysBetween(toDateInputValue(d), toDateInputValue(now));
  if (ago <= 0) return t('community.when.today');
  if (ago === 1) return t('community.when.yesterday');
  if (ago < 7) return t('community.when.daysAgo', { n: ago });
  if (d.getFullYear() !== now.getFullYear()) return formatDate(dateStr);
  return t('community.when.date', { m: d.getMonth() + 1, d: d.getDate() });
}

// 'YYYY-MM-DD'(마감일) → "10월 31일". 시간대 변환 없이 문자열만 나눈다.
function formatDay(dateStr, t) {
  const [, m, d] = String(dateStr).split('-').map(Number);
  return t('community.when.date', { m, d });
}

/**
 * Community Page
 * 커뮤니티(스터디/프로젝트 모집) 게시판 — 2단계(글쓰기+목록/상세) + 3단계(신청+수락/반려+
 * 모집마감+수정/삭제). 관리자 승인 화면은 아직 없음(4단계) — 승인/반려는 서버 API를
 * 직접 호출해서 처리한다.
 *
 * Props:
 * - user: object
 * - onGoHome: function
 * - onLogout: function
 * - onOpenSettings: function
 * - onOpenOnboarding: function
 * - onOpenProfile: function
 * - initialPostId: number (선택) — 관리자 신고함의 "그 글로 이동"에서 넘어온 글 id.
 *   마운트 시 1회 해당 글을 열고 onInitialPostConsumed로 소비했음을 알린다.
 * - onInitialPostConsumed: function (선택)
 * - onUnseenNoticesChange: function (선택) — 공지를 읽을 때마다 남은 안 읽은 공지 수를 알린다(App의 커뮤니티 점).
 * - onFocusModeChange: function (선택) — 글 상세·글쓰기를 열고 닫을 때 true/false. 화면 아래에 붙는 신청·등록 버튼을
 *   떠 있는 채팅 버튼이 가리지 않게 App이 아래 탭바를 숨긴다.
 */
function Community({
  user,
  onGoHome,
  onLogout,
  onOpenSettings,
  onOpenOnboarding,
  onOpenProfile,
  onOpenAdmin,
  onOpenInquiry,
  initialPostId,
  onInitialPostConsumed,
  unseenReportCount = 0,
  onUnseenReportsChange,
  onUnseenNoticesChange,
  onFocusModeChange,
}) {
  const { t, tRich } = useI18n();
  const [tab, setTab] = useState('list'); // 'list' | 'mine' | 'applications' | 'reports'
  // null이면 "아직 안 불러옴"(첫 진입) — 빈 배열([])과는 구분해야 실제로 글이 0개인 것과
  // 로딩 중인 것을 헷갈리지 않는다(Home.jsx의 profile/status와 동일한 패턴).
  const [posts, setPosts] = useState(communityCache.posts);
  const [myPosts, setMyPosts] = useState(communityCache.myPosts);
  const [myApplications, setMyApplications] = useState(communityCache.myApplications);
  // 내 신고 내역(처리 상태 + 관리자 처리 안내). 열 때마다 새로 불러오고 캐시하지 않는다 — 처리 결과는 그때그때 최신이어야 한다.
  const [myReports, setMyReports] = useState(null);
  const [error, setError] = useState(null);
  // 지금 탭의 목록을 못 불러왔는지(그 탭 이름) — 다시 시도는 reloadKey를 올려 같은 탭을 다시 받는다.
  const [loadFailedTab, setLoadFailedTab] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const errorText = error && (typeof error === 'object' ? t(error.key) : error);
  const currentTabData = { list: posts, mine: myPosts, reports: myReports, applications: myApplications }[tab];
  // 목록이 아직 없을 때 그 자리 — 받는 중이면 "불러오는 중...", 못 받았으면 다시 시도만 보여 준다.
  const listPlaceholder = () =>
    loadFailedTab === tab ? (
      <LoadError message={t(LOAD_ERR_BY_TAB[tab].key)} onRetry={() => setReloadKey((k) => k + 1)} />
    ) : (
      <p className="post-empty">{t('community.loading')}</p>
    );

  // 사용자 제재(#201) — null이면 정지 아님. scope==='full'이면 이 화면 진입 자체가 서버에서
  // 이미 막혀 있어서(전체 탭 fetch의 catch에서 SANCTIONED로 채워짐) 커뮤니티 전체를 안내
  // 화면으로 대체하고, scope==='post_apply'면 목록은 그대로 두고 글쓰기/신청만 막는다.
  const [sanction, setSanction] = useState(null);

  useEffect(() => {
    getMySanction()
      .then(setSanction)
      .catch(() => {}); // 조회 실패는 조용히 무시 — 배너 하나 못 보여줄 뿐 화면 전체를 막을 정도는 아님
  }, []);

  const [selectedPost, setSelectedPost] = useState(null); // 상세 뷰(목록 클릭 시)
  const [detailLoading, setDetailLoading] = useState(false);
  // 내 글 상세에서만 쓰는 신청자 목록 — selectedPost.isMine일 때만 채워짐.
  const [applicants, setApplicants] = useState([]);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  const [applicantActionId, setApplicantActionId] = useState(null); // 수락/반려 처리 중인 신청 id
  // 거부 메시지(선택) 입력값 — 신청 id별로 따로 들고 있어야 다른 신청자 카드와 안 섞인다.
  const [rejectMessages, setRejectMessages] = useState({});
  // 거절 메시지 칸을 연 신청 id — 거절을 한 번 누르면 메시지(선택)를 적고 확정한다.
  const [rejectOpenId, setRejectOpenId] = useState(null);

  // 공지(운영팀 글, 읽기 전용). notices는 전체 글 탭 맨 위 고정 줄과 공지 목록에 같이 쓴다. noticeView가 있으면 공지 화면을 보는 중이다
  // ({ mode: 'list' | 'detail' | 'write', notice }).
  // 공지도 글 목록처럼 기억해 둔다 — 예전에는 매번 null에서 시작해, 글 목록이 먼저 뜬 뒤 공지 줄이 늦게 끼어들며 목록이 한 줄
  // 밀렸다(누르려던 글 대신 다른 글을 누르게 됨, 2026-10-27 화면 점검). 처음 한 번은 글 목록과 함께 공지까지 받은 뒤 보여 준다.
  const [notices, setNoticesRaw] = useState(communityCache.notices);
  const setNotices = (list) => {
    setNoticesRaw(list);
    setCommunityCache('notices', list);
  };
  const [noticeView, setNoticeView] = useState(null);
  const loadNotices = () =>
    getNotices()
      .then(setNotices)
      .catch(() => setNoticesRaw((prev) => prev ?? [])); // 공지를 못 불러와도 커뮤니티는 그대로 쓸 수 있어야 해서 조용히 넘어간다(빈 목록은 기억하지 않는다)
  useEffect(() => {
    loadNotices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 공지는 상세를 열어야 읽은 것이 된다(목록을 여는 것만으로는 아니다 — 2026-10-23). 화면은 바로 고치고 기록은 뒤에서 보낸다
  // (기록이 실패해도 다음에 목록을 다시 받으면 서버 값으로 맞춰진다). 남은 안 읽은 공지 수로 App의 커뮤니티 점을 고친다.
  const markNoticesLocally = (isRead) => {
    const next = (notices || []).map((n) => (isRead(n) ? { ...n, isNew: false } : n));
    setNotices(next);
    onUnseenNoticesChange?.(next.filter((n) => n.isNew).length);
  };
  const openNotice = (notice) => {
    setNoticeView({ mode: 'detail', notice });
    if (!notice.isNew) return;
    markNoticesLocally((n) => n.id === notice.id);
    markNoticeRead(notice.id).catch(() => {});
  };
  const handleMarkAllNoticesRead = () => {
    markNoticesLocally(() => true);
    markAllNoticesRead().catch(() => {});
  };
  const noticeWhen = (dateStr) => formatWhen(dateStr, t);

  const [showWriteForm, setShowWriteForm] = useState(false);
  const [writeFields, setWriteFields] = useState(() => emptyWriteFields(user));
  const [writeSubmitting, setWriteSubmitting] = useState(false);
  // null이면 새 글 작성, 값이 있으면 그 id의 글을 수정 중(같은 폼을 재사용).
  const [editingPostId, setEditingPostId] = useState(null);

  const [applyMessage, setApplyMessage] = useState('');
  const [applySubmitting, setApplySubmitting] = useState(false);
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  // 관리자가 글 상세에서 작성자를 눌러 연 제재 팝업의 대상 글 — null이면 닫힘.
  const [sanctionPost, setSanctionPost] = useState(null);

  // 글 신고 — 상세 화면 하나에 글이 하나뿐이라 단일 상태로 충분.
  const [reportFormOpen, setReportFormOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  // 신청 메시지 신고 — 신청자 목록엔 여러 카드가 있어서 id별로 따로 들고 있어야 한다
  // (rejectMessages와 동일한 이유).
  const [applicantReportOpenId, setApplicantReportOpenId] = useState(null);
  const [applicantReportReasons, setApplicantReportReasons] = useState({});
  const [applicantReportSubmittingId, setApplicantReportSubmittingId] = useState(null);
  // 연락 차단 확인 팝업 — { applicationId, name }이면 열림, null이면 닫힘.
  const [blockTarget, setBlockTarget] = useState(null);
  const [blockSubmitting, setBlockSubmitting] = useState(false);

  // 목록 → 상세/글쓰기 이동도 모바일 뒤로가기 스택에 반영해야, 뒤로가기를 눌렀을 때 곧장
  // 홈으로 나가지 않고 먼저 목록으로 돌아온다(App.jsx의 view 히스토리 관리, Admin.jsx의
  // adminView 히스토리 관리와 같은 방식 — 실사용 확인된 문제: 상세 보다가 뒤로가기를 누르면
  // 목록을 건너뛰고 곧장 홈으로 나가버림). 상세/글쓰기는 글 id 등 실제 데이터가 있어야
  // 복원 가능해서, 뒤로가기로는 항상 목록으로만 돌아가게 하고 그 안의 세부 화면(상세 vs
  // 글쓰기)까지 구분해서 복원하지는 않는다 — 목록 밖으로 새지만 않으면 되는 문제라 이 정도로 충분.
  const inSubView = showWriteForm || !!selectedPost || !!noticeView;
  const skipHistoryPush = useRef(true);
  const inSubViewRef = useRef(inSubView);
  inSubViewRef.current = inSubView;

  useEffect(() => {
    function handlePopState(event) {
      // 뒤로가기로 inSubView가 실제로 바뀔 때만 다음 이펙트의 히스토리 쌓기를 건너뛴다 — 바뀌지 않는 popstate(검색 화면을
      // 닫는 경우 등)에서도 켜 두면, 이펙트가 돌지 않아 표시가 남았다가 다음 글 열기가 히스토리를 쌓지 않게 된다.
      if (!!event.state?.communityInSubView !== inSubViewRef.current) skipHistoryPush.current = true;
      if (!event.state?.communityInSubView) {
        setSelectedPost(null);
        setShowWriteForm(false);
        setNoticeView(null);
      }
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    onFocusModeChange?.(inSubView);
  }, [inSubView, onFocusModeChange]);
  useEffect(() => () => onFocusModeChange?.(false), [onFocusModeChange]);

  useEffect(() => {
    if (skipHistoryPush.current) {
      window.history.replaceState({ ...window.history.state, communityInSubView: inSubView }, '');
      skipHistoryPush.current = false;
      return;
    }
    if (inSubView) {
      window.history.pushState({ ...window.history.state, communityInSubView: inSubView }, '');
    } else {
      window.history.replaceState({ ...window.history.state, communityInSubView: inSubView }, '');
    }
  }, [inSubView]);

  // 글 검색(MVP) — 제목·본문에 검색어가 들어간 글. 검색 전용 화면(SearchScreen)에서 서버에 `?q=`로 묻는다.
  // searchedQuery: 마지막으로 요청한 검색어(공백 제거), searchResults: null이면 아직 검색 전.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchError, setSearchError] = useState(false);
  const searchRequestIdRef = useRef(0);

  // 응답이 늦게 도착해 그사이 검색어가 더 바뀌었으면(requestId 불일치) 버린다 — 오래된 검색어 결과가 최신 결과를 덮어쓰는 걸 막음.
  const runPostSearch = (value) => {
    const query = value.trim();
    const requestId = ++searchRequestIdRef.current;
    setSearchedQuery(query);
    setSearchError(false);
    if (!query) {
      setSearchResults(null);
      return;
    }
    getCommunityPosts(query)
      .then((list) => {
        if (requestId === searchRequestIdRef.current) setSearchResults(list);
      })
      .catch((err) => {
        if (requestId !== searchRequestIdRef.current) return;
        if (err.code === 'SANCTIONED') {
          setSanction(err.data);
          dismissSearch();
        } else {
          setSearchError(true);
        }
      });
  };
  const postSearch = useSearchInput(runPostSearch);

  // 검색 화면을 끝낸다(뒤로가기로 닫힌 경우, 검색 결과에서 글을 지우거나 고치러 가는 경우 공통).
  function dismissSearch() {
    searchRequestIdRef.current += 1;
    setSearchOpen(false);
    setSearchedQuery('');
    setSearchResults(null);
    setSearchError(false);
    postSearch.reset();
  }

  // 내 학과 글만 보기 — 내 학과(개편 전후 포함, 서버의 isMyDepartment)를 모집하거나 학과 상관없는 글만 남긴다. 학과가 없는 계정은 끈 채로.
  const [myDeptOnly, setMyDeptOnly] = useState(readMyDeptOnly);
  const visiblePosts = myDeptOnly && user?.departmentId && posts ? posts.filter((p) => p.isMyDepartment || !p.targetDepartments?.length) : posts;

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  // 지금 보고 있는 탭 데이터만 그때그때 불러온다(Admin.jsx가 adminView별로 지연 로딩하는
  // 것과 같은 방식) — 예전엔 진입할 때마다 탭 3개(전체 글/내 글/내 신청) 데이터를 한꺼번에
  // 다 가져와서, 화면에 보이지도 않는 탭까지 매번 새로 왕복했다. 배포 환경에서 실측해보니
  // 요청 1번당 데이터 유무와 무관하게 ~300ms 고정 비용이 붙어서(네트워크 왕복 자체가
  // 병목), 안 보이는 요청을 없애는 게 응답을 가볍게 만드는 것보다 훨씬 효과적이었다.
  // 캐시가 있으면 Home.jsx와 동일하게 그 값을 먼저 보여주고 뒤에서 조용히 새로고침한다.
  useEffect(() => {
    // 전면 정지(scope='full')는 서버가 이 라우터 전체를 403 SANCTIONED로 막으므로, 셋 중
    // 어느 탭을 불러오든 이 catch로 잡힌다 — 그 경우 일반 에러 대신 sanction 상태를 채워서
    // 화면 전체를 안내 화면으로 대체한다(아래 return의 sanction?.scope === 'full' 분기).
    // 목록을 못 받은 것은 위쪽 오류 문구(error) 대신 그 탭의 목록 자리에 다시 시도로 보여 준다 — 예전에는 오류와
    // "불러오는 중..."이 같이 계속 떠 있었고, 다른 탭으로 옮겨 잘 불러와도 오류가 남았다(2026-10-27 화면 점검).
    function handleFetchError(err) {
      if (err.code === 'SANCTIONED') setSanction(err.data);
      else setLoadFailedTab(tab);
    }
    setLoadFailedTab(null);

    if (tab === 'list') {
      getCommunityPosts()
        .then((list) => {
          setPosts(list);
          setCommunityCache('posts', list);
        })
        .catch((err) => handleFetchError(err));
    } else if (tab === 'mine') {
      getMyCommunityPosts()
        .then((mine) => {
          setMyPosts(mine);
          setCommunityCache('myPosts', mine);
        })
        .catch((err) => handleFetchError(err));
    } else if (tab === 'reports') {
      getMyReports()
        .then((reports) => {
          // 화면에는 "새 결과" 표시(isUnseen)를 그대로 보여주고, 서버에는 확인했다고 알려 탭의 점을 지운다.
          setMyReports(reports);
          if (reports.some((r) => r.isUnseen)) {
            markMyReportsSeen()
              .then(() => onUnseenReportsChange?.(0))
              .catch(() => {}); // 확인 표시 실패는 조용히 무시 — 다음에 열 때 다시 시도된다
          }
        })
        .catch((err) => handleFetchError(err));
    } else {
      getMyCommunityApplications()
        .then((myApps) => {
          setMyApplications(myApps);
          setCommunityCache('myApplications', myApps);
        })
        .catch((err) => handleFetchError(err));
    }
  }, [tab, reloadKey]);

  const openPost = (id) => {
    setDetailLoading(true);
    setError(null);
    setApplyMessage('');
    setApplicants([]);
    setReportFormOpen(false);
    setReportReason('');
    setApplicantReportOpenId(null);
    getCommunityPost(id)
      .then((post) => {
        setSelectedPost(post);
        if (post.isMine) {
          setApplicantsLoading(true);
          getCommunityApplicants(id)
            .then(setApplicants)
            .catch(() => setError(ERR.loadApplicants))
            .finally(() => setApplicantsLoading(false));
        }
      })
      .catch(() => setError(ERR.loadPost))
      .finally(() => setDetailLoading(false));
  };

  // 관리자 신고함의 "그 글로 이동"에서 넘어온 경우 — 마운트 시 한 번만 그 글을 열고,
  // App.jsx의 상태를 바로 비워달라고 알려서 다음에 커뮤니티에 평범하게 들어왔을 때
  // 같은 글이 다시 열리지 않게 한다.
  useEffect(() => {
    if (!initialPostId) return;
    openPost(initialPostId);
    onInitialPostConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 1회만 소비하면 됨
  }, []);

  // 목록 3개(전체 글/내가 쓴 글/내 신청)를 전부 다시 불러온다 — 글/신청 상태가 바뀌는
  // 액션(작성/수정/삭제/신청/수락/반려/마감) 뒤에는 여러 목록에 동시에 영향을 주므로
  // 하나씩 골라 갱신하기보다 한 번에 새로고침하는 편이 안전하다.
  const refreshLists = async () => {
    const [list, mine, myApps] = await Promise.all([getCommunityPosts(), getMyCommunityPosts(), getMyCommunityApplications()]);
    setPosts(list);
    setMyPosts(mine);
    setMyApplications(myApps);
    setCommunityCache('posts', list);
    setCommunityCache('myPosts', mine);
    setCommunityCache('myApplications', myApps);
  };

  const resetAfterWrite = () => {
    setWriteFields(emptyWriteFields(user));
    setEditingPostId(null);
    setShowWriteForm(false);
  };

  // 헤더 좌측 화살표 — 목록/상세/글쓰기 중 어디에 있는지에 따라 한 단계만 뒤로 간다.
  // 글쓰기·상세 화면에서도 그냥 onGoHome을 쓰면 커뮤니티 목록을 건너뛰고 바로 홈으로
  // 나가버려서(글 쓰던 중이면 작성 중이던 내용까지 예고 없이 날아감), 서브뷰가 열려있을
  // 땐 그 서브뷰만 닫고 목록으로 돌아가게 한다.
  const handleHeaderBack = () => {
    // 공지: 상세·글쓰기 → 공지 목록 → 전체 글
    if (noticeView) {
      setNoticeView(noticeView.mode === 'list' ? null : { mode: 'list' });
    } else if (showWriteForm) {
      resetAfterWrite();
    } else if (selectedPost) {
      setSelectedPost(null);
    } else {
      onGoHome();
    }
  };

  const handleWriteSubmit = async (e) => {
    e.preventDefault();
    if (!writeFields.title.trim() || !writeFields.body.trim()) return;
    if (writeFields.deptMode === 'specific' && writeFields.departments.length === 0) {
      setError(t('community.err.deptRequired'));
      return;
    }
    setWriteSubmitting(true);
    setError(null);
    try {
      const payload = {
        title: writeFields.title.trim(),
        body: writeFields.body.trim(),
        category: writeFields.category,
        capacity: writeFields.capacity === '' ? null : Number(writeFields.capacity),
        recruitEndDate: writeFields.recruitEndDate || null,
        departmentIds: writeFields.deptMode === 'specific' ? writeFields.departments.map((d) => d.id) : [],
      };
      if (editingPostId) {
        await editCommunityPost(editingPostId, payload);
        showToast(t('community.toast.edited'));
      } else {
        await createCommunityPost(payload);
        track('community.write.posted');
        showToast(t('community.toast.posted'));
      }
      resetAfterWrite();
      setSelectedPost(null);
      dismissSearch();
      setTab('mine');
      await refreshLists();
    } catch (err) {
      // 제재가 걸린 뒤 이 화면을 열어둔 경우(또는 getMySanction이 실패했던 경우)에도 안내가 나오게 서버 응답으로 채운다.
      if (err.code === 'SANCTIONED') {
        setSanction(err.data);
        setError(editingPostId ? t('community.err.editSanctioned') : t('community.err.writeSanctioned'));
      } else if (err.code === 'INVALID_RECRUIT_END') {
        setError(t('community.err.recruitEnd'));
      } else if (err.code === 'INVALID_DEPARTMENTS') {
        setError(t('community.err.departments'));
      } else {
        setError(editingPostId ? t('community.err.editFailed') : t('community.err.postFailed'));
      }
    } finally {
      setWriteSubmitting(false);
    }
  };

  const startEdit = (post) => {
    setWriteFields({
      title: post.title,
      body: post.body,
      category: post.category,
      capacity: post.capacity === null || post.capacity === undefined ? '' : String(post.capacity),
      recruitEndDate: post.recruitEndDate || '',
      deptMode: post.targetDepartments?.length ? 'specific' : 'any',
      departments: post.targetDepartments || [],
    });
    setEditingPostId(post.id);
    setSelectedPost(null);
    dismissSearch();
    setShowWriteForm(true);
  };

  const handleDelete = async (post) => {
    if (!window.confirm(t('community.confirm.delete'))) return;
    setDeleteSubmitting(true);
    setError(null);
    try {
      await deleteCommunityPost(post.id);
      showToast(t('community.toast.deleted'));
      setSelectedPost(null);
      dismissSearch();
      setTab('mine');
      await refreshLists();
    } catch {
      setError(t('community.err.deleteFailed'));
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // 관리자가 남의 글(승인된 글만 여기서 조회 가능)을 커뮤니티 화면에서 바로 삭제 —
  // 관리자 페이지까지 가서 찾을 필요 없이 즉각 조치할 수 있게 한다. deleteCommunityPost(작성자
  // 전용)가 아니라 admin.js의 deleteAdminPost를 쓴다 — 서버도 requireAdmin으로 다시 확인한다.
  const handleAdminDelete = async (post) => {
    if (!window.confirm(t('community.confirm.adminDelete'))) return;
    setDeleteSubmitting(true);
    setError(null);
    try {
      await deleteAdminPost(post.id);
      showToast(t('community.toast.deleted'));
      setSelectedPost(null);
      dismissSearch();
      setTab('list');
      await refreshLists();
    } catch {
      setError(t('community.err.deleteFailed'));
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const handleClose = async (post) => {
    setCloseSubmitting(true);
    setError(null);
    try {
      await closeCommunityPost(post.id);
      showToast(t('community.toast.closed'));
      openPost(post.id);
      await refreshLists();
    } catch {
      setError(t('community.err.closeFailed'));
    } finally {
      setCloseSubmitting(false);
    }
  };

  const handleApply = async (e) => {
    e.preventDefault();
    if (!applyMessage.trim() || !selectedPost) return;
    setApplySubmitting(true);
    setError(null);
    try {
      await applyToCommunityPost(selectedPost.id, applyMessage.trim());
      track('community.post.applied');
      showToast(t('community.toast.applied'));
      setApplyMessage('');
      openPost(selectedPost.id);
      const myApps = await getMyCommunityApplications();
      setMyApplications(myApps);
      setCommunityCache('myApplications', myApps);
    } catch (err) {
      if (err.code === 'DUPLICATE_APPLICATION') setError(t('community.err.duplicateApplication'));
      else if (err.code === 'APPLICATION_LIMIT_REACHED') setError(t('community.err.applicationLimit'));
      else if (err.code === 'RECRUIT_ENDED') {
        // 상세를 다시 불러와 마감 표시로 바꾸되, openPost가 error를 비우므로 안내는 그 뒤에 채운다.
        openPost(selectedPost.id);
        setError(t('community.err.recruitEnded'));
      } else if (err.code === 'POST_UNAVAILABLE') {
        // 글을 연 뒤에 글쓴이가 계정 정지됐다(#457) — 상세를 다시 불러오면 신청 칸 대신 안내가 뜬다.
        openPost(selectedPost.id);
      } else setError(t('community.err.applyFailed'));
    } finally {
      setApplySubmitting(false);
    }
  };

  const handleDecideApplication = async (applicationId, decision) => {
    setApplicantActionId(applicationId);
    setError(null);
    try {
      if (decision === 'accepted') await acceptCommunityApplication(applicationId);
      else await rejectCommunityApplication(applicationId, rejectMessages[applicationId]);
      showToast(decision === 'accepted' ? t('community.toast.accepted') : t('community.toast.declined'));
      setRejectOpenId(null);
      setRejectMessages((prev) => {
        const next = { ...prev };
        delete next[applicationId];
        return next;
      });
      if (selectedPost) {
        const updated = await getCommunityApplicants(selectedPost.id);
        setApplicants(updated);
      }
    } catch {
      setError(t('community.err.decideFailed'));
    } finally {
      setApplicantActionId(null);
    }
  };

  // 매칭 연락 차단 — 차단하면 그 매칭의 중계 메일이 양쪽 모두 전달되지 않는다. 서버에서 다시 불러오지 않고 화면의 해당 신청만
  // 차단 상태로 바꾼다(글 상세의 내 신청, 글쓴이의 신청자 목록, 내 신청 탭).
  const handleBlockContact = async () => {
    if (!blockTarget) return;
    const { applicationId } = blockTarget;
    setBlockSubmitting(true);
    setError(null);
    try {
      await blockCommunityContact(applicationId);
      const blockedAt = new Date().toISOString();
      const mark = (a) => (a.id === applicationId ? { ...a, contactBlockedAt: blockedAt, contactEmail: null } : a);
      setApplicants((prev) => prev.map(mark));
      setMyApplications((prev) => (prev ? prev.map(mark) : prev));
      setSelectedPost((p) => (p && p.myApplication && p.myApplication.id === applicationId ? { ...p, myApplication: mark(p.myApplication) } : p));
      setBlockTarget(null);
      showToast(t('community.contact.toast'));
    } catch {
      setError(t('community.contact.err'));
      setBlockTarget(null);
    } finally {
      setBlockSubmitting(false);
    }
  };

  const handleReportPost = async (e) => {
    e.preventDefault();
    if (!reportReason.trim() || !selectedPost) return;
    setReportSubmitting(true);
    setError(null);
    try {
      await reportCommunityPost(selectedPost.id, reportReason.trim());
      showToast(t('community.toast.reported'));
      setReportReason('');
      setReportFormOpen(false);
    } catch (err) {
      if (err.code === 'DUPLICATE_REPORT') setError(t('community.err.duplicateReportPost'));
      else if (err.code === 'CANNOT_REPORT_OWN') setError(t('community.err.cannotReportOwnPost'));
      else setError(t('community.err.reportFailed'));
    } finally {
      setReportSubmitting(false);
    }
  };

  const handleReportApplication = async (applicationId) => {
    const reason = (applicantReportReasons[applicationId] || '').trim();
    if (!reason) return;
    setApplicantReportSubmittingId(applicationId);
    setError(null);
    try {
      await reportCommunityApplication(applicationId, reason);
      showToast(t('community.toast.reported'));
      setApplicantReportReasons((prev) => {
        const next = { ...prev };
        delete next[applicationId];
        return next;
      });
      setApplicantReportOpenId(null);
    } catch (err) {
      if (err.code === 'DUPLICATE_REPORT') setError(t('community.err.duplicateReportApp'));
      else if (err.code === 'CANNOT_REPORT_OWN') setError(t('community.err.cannotReportOwnApp'));
      else setError(t('community.err.reportFailed'));
    } finally {
      setApplicantReportSubmittingId(null);
    }
  };

  const renderDetail = () => {
    const post = selectedPost;
    const closed = isRecruitClosed(post.closedAt, post.recruitState);
    const isAdmin = user?.role === 'admin';
    const writeLimited = sanction?.scope === 'post_apply';
    const applicantPeople = applicants.filter((a) => !a.hasAppliedBefore).length;
    const uncheckedCount = applicants.filter((a) => a.status === 'pending').length;
    // authorUnavailable: 글쓴이가 계정 정지 중(#457) — 이유·기간 없이 "지금은 신청할 수 없어요"만 보여준다.
    const canApply = !post.isMine && post.myApplication === null && !closed && !writeLimited && !post.contentHidden && !post.authorUnavailable;

    // 자주 쓰지 않는 동작(신고·수정·마감·삭제)은 글쓴이 옆 "⋯" 메뉴에 모은다.
    const menuItems = post.isMine
      ? [
          { label: writeLimited ? t('community.editLimited') : t('community.menu.edit'), onClick: () => startEdit(post), disabled: writeLimited },
          ...(post.status === 'approved' && !post.closedAt
            ? [
                {
                  label: closeSubmitting ? t('community.processing') : t('community.closeBtn'),
                  onClick: () => handleClose(post),
                  disabled: closeSubmitting || applicantsLoading || applicants.length === 0,
                  hint: !applicantsLoading && applicants.length === 0 ? t('community.closeNeedApplicant') : null,
                },
              ]
            : []),
          { label: deleteSubmitting ? t('community.deleting') : t('community.menu.delete'), onClick: () => handleDelete(post), disabled: deleteSubmitting, danger: true },
        ]
      : [
          { label: t('community.reportAria'), onClick: () => setReportFormOpen(true) },
          ...(isAdmin ? [{ label: t('community.adminDeleteShort'), onClick: () => handleAdminDelete(post), disabled: deleteSubmitting, danger: true }] : []),
        ];

    const ownerSummary =
      post.status === 'pending'
        ? t('community.owner.waiting')
        : post.status === 'rejected'
          ? t('community.owner.rejected')
          : [t('community.owner.apps', { n: applicantPeople }), uncheckedCount > 0 && t('community.owner.unchecked', { n: uncheckedCount })].filter(Boolean).join(' · ');

    return (
      <>
        <div className="post-detail">
          {errorText && <p className="home-error">{errorText}</p>}
          {post.isMine && (
            <div className="post-owner-bar">
              <StatusText tone={POST_STATUS_TONE[post.status]}>{t(`community.postStatus.${post.status}`)}</StatusText>
              <span>{ownerSummary}</span>
            </div>
          )}
          {post.isMine && post.status === 'approved' && !post.closedAt && post.recruitState === 'ended' && (
            <p className="post-note">{t('community.endedHint', { date: formatDeadline(post.recruitEndDate) })}</p>
          )}
          {post.isMine && writeLimited && <SanctionBanner sanction={sanction} />}

          {!post.contentHidden && (
            <div className="post-over">
              <CategoryLabel category={post.category} />
              {post.isMyDepartment && <span className="post-mydept">{t('community.badge.myDept')}</span>}
              <RecruitState closedAt={post.closedAt} recruitState={post.recruitState} recruitEndDate={post.recruitEndDate} />
            </div>
          )}
          <h2 className="post-detail-title">{post.contentHidden ? t('community.hiddenTitle') : post.title}</h2>

          <div className="post-author">
            <Avatar name={post.author} />
            <div className="post-author-text">
              {isAdmin && !post.isMine && post.authorId ? (
                <button type="button" className="post-author-name community-author-link" onClick={() => setSanctionPost(post)} aria-label={t('community.sanctionAuthorAria', { author: post.author })}>
                  {post.author}
                </button>
              ) : (
                <span className="post-author-name">{post.isMine ? t('community.authorMe', { name: post.author }) : post.author}</span>
              )}
              <span className="post-author-sub">{formatDate(post.createdAt)}</span>
            </div>
            <MoreMenu items={menuItems} />
          </div>

          {post.contentHidden ? (
            <p className="post-note">{t('community.hiddenBody')}</p>
          ) : (
            <>
              <dl className="post-facts">
                {post.targetDepartments && (
                  <div className="post-fact post-fact--wide">
                    <dt>{t('community.dept.label')}</dt>
                    <dd>
                      {post.targetDepartments.length ? post.targetDepartments.map((d) => d.name).join(', ') : t('community.dept.all')}
                      {post.isMyDepartment && <span className="post-mydept">{t('community.badge.myDept')}</span>}
                    </dd>
                  </div>
                )}
                <div className="post-fact">
                  <dt>{t('community.fact.capacity')}</dt>
                  <dd>{post.capacity ? t('community.fact.capacityValue', { n: post.capacity }) : t('community.fact.capacityNone')}</dd>
                </div>
                <div className="post-fact">
                  <dt>{t('community.fact.deadline')}</dt>
                  <dd>{post.closedAt ? t('community.fact.closedByAuthor') : post.recruitEndDate ? formatDay(post.recruitEndDate, t) : t('community.fact.deadlineNone')}</dd>
                </div>
              </dl>
              <p className="post-body">{post.body}</p>
            </>
          )}

          {post.status === 'rejected' && post.rejectReason && (
            <p className="admin-reject-reason">
              <b>{t('community.label.rejectReason')}</b> · {post.rejectReason}
            </p>
          )}

          {post.isMine ? (
            <>
              <div className="post-section-head">
                <h3>
                  {t('community.received')}
                  <em>{applicantPeople}</em>
                </h3>
                {/* 신청자는 사람 수로 센다 — 반려 후 재신청한 건(hasAppliedBefore)은 같은 사람이라 빼고, 건수가 다를 때만 함께 보여준다. */}
                {applicantPeople !== applicants.length && <span className="post-section-sub">{t('community.applicationsCount', { n: applicants.length })}</span>}
              </div>
              {applicantsLoading ? (
                <p className="post-empty">{t('community.loading')}</p>
              ) : applicants.length === 0 ? (
                <p className="post-empty">{t('community.noApplicants')}</p>
              ) : (
                <div className="applicant-list">
                  {applicants.map((a) => (
                    <div className="applicant-row" key={a.id}>
                      <Avatar name={a.applicant} />
                      <div className="applicant-main">
                        <div className="applicant-top">
                          <span className="applicant-name">{a.applicant}</span>
                          {a.hasAppliedBefore && <span className="post-tag">{t('community.reapplied')}</span>}
                          {a.contactBlockedAt && <span className="post-tag">{t('community.contact.blockedBadge')}</span>}
                          <StatusText tone={APP_STATUS_TONE[a.status]}>{t(`community.appStatus.${a.status}`)}</StatusText>
                        </div>
                        <p className="applicant-msg">{a.message}</p>
                        <span className="applicant-date">{formatDate(a.createdAt)}</span>
                        {a.status === 'pending' &&
                          (rejectOpenId === a.id ? (
                            <>
                              <textarea
                                className="post-input"
                                rows={2}
                                aria-label={t('community.rejectPlaceholder')}
                                placeholder={t('community.rejectPlaceholder')}
                                value={rejectMessages[a.id] || ''}
                                onChange={(e) => setRejectMessages((prev) => ({ ...prev, [a.id]: e.target.value }))}
                              />
                              <div className="applicant-actions">
                                <button type="button" className="post-btn post-btn--outline" onClick={() => handleDecideApplication(a.id, 'rejected')} disabled={applicantActionId === a.id}>
                                  {t('community.declineConfirm')}
                                </button>
                                <button type="button" className="post-btn post-btn--text" onClick={() => setRejectOpenId(null)}>
                                  {t('onb.cancel')}
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="applicant-actions">
                              <button type="button" className="post-btn post-btn--ink" onClick={() => handleDecideApplication(a.id, 'accepted')} disabled={applicantActionId === a.id}>
                                {t('community.accept')}
                              </button>
                              <button type="button" className="post-btn post-btn--outline" onClick={() => setRejectOpenId(a.id)} disabled={applicantActionId === a.id}>
                                {t('community.decline')}
                              </button>
                            </div>
                          ))}
                        {a.status === 'accepted' &&
                          (a.contactBlockedAt ? (
                            <ContactBlockedNote blockedAt={a.contactBlockedAt} formatDate={formatDate} />
                          ) : (
                            a.contactEmail && <ContactBox email={a.contactEmail} onBlock={() => setBlockTarget({ applicationId: a.id, name: a.applicant })} />
                          ))}
                        {a.status === 'rejected' && a.rejectReason && (
                          <p className="post-quote">
                            <b>{t('community.label.declineReason')}</b> · {a.rejectReason}
                          </p>
                        )}
                        {applicantReportOpenId === a.id ? (
                          <>
                            <textarea
                              className="post-input"
                              rows={2}
                              aria-label={t('community.reportReasonPlaceholder')}
                              placeholder={t('community.reportReasonPlaceholder')}
                              value={applicantReportReasons[a.id] || ''}
                              onChange={(e) => setApplicantReportReasons((prev) => ({ ...prev, [a.id]: e.target.value }))}
                            />
                            <div className="applicant-actions">
                              <button type="button" className="post-btn post-btn--danger" onClick={() => handleReportApplication(a.id)} disabled={applicantReportSubmittingId === a.id}>
                                {applicantReportSubmittingId === a.id ? t('community.reporting') : t('community.submitReport')}
                              </button>
                              <button type="button" className="post-btn post-btn--text" onClick={() => setApplicantReportOpenId(null)}>
                                {t('onb.cancel')}
                              </button>
                            </div>
                          </>
                        ) : (
                          <button type="button" className="applicant-report" onClick={() => setApplicantReportOpenId(a.id)} aria-label={t('community.reportApplicantAria', { name: a.applicant })}>
                            {t('community.reportShort')}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : post.myApplication ? (
            <>
              <div className="post-section-head">
                <h3>{t('community.myApplication')}</h3>
                <StatusText tone={APP_STATUS_TONE[post.myApplication.status]}>{t(`community.appStatus.${post.myApplication.status}`)}</StatusText>
              </div>
              {post.myApplication.status === 'pending' &&
                (post.authorUnavailable ? (
                  <p className="post-note">{t('community.authorUnavailable')}</p>
                ) : (
                  <p className="post-section-desc">{t('community.pendingDesc')}</p>
                ))}
              {post.myApplication.status === 'accepted' &&
                (post.myApplication.contactBlockedAt ? (
                  <ContactBlockedNote blockedAt={post.myApplication.contactBlockedAt} formatDate={formatDate} />
                ) : (
                  <>
                    <p className="post-section-desc">{t('community.acceptedDesc')}</p>
                    {post.myApplication.contactEmail && (
                      <ContactBox email={post.myApplication.contactEmail} onBlock={() => setBlockTarget({ applicationId: post.myApplication.id, name: post.author })} />
                    )}
                  </>
                ))}
              {post.myApplication.status === 'rejected' && post.myApplication.rejectReason && (
                <p className="post-quote">
                  <b>{t('community.label.declineReason')}</b> · {post.myApplication.rejectReason}
                </p>
              )}
              {post.myApplication.status === 'rejected' && !closed && (
                <>
                  <p className="post-section-desc">{t('community.notSelectedDesc')}</p>
                  {writeLimited ? (
                    <p className="post-note">{t('community.reapplyRestricted', { reason: sanction.reason })}</p>
                  ) : post.authorUnavailable ? (
                    <p className="post-note">{t('community.applyUnavailable')}</p>
                  ) : (
                    <form className="post-reapply" onSubmit={handleApply}>
                      <textarea
                        className="post-input"
                        rows={4}
                        aria-label={t('community.reapplyLabel')}
                        value={applyMessage}
                        onChange={(e) => setApplyMessage(e.target.value)}
                        placeholder={t('community.reapplyPlaceholder')}
                        required
                      />
                      <button type="submit" className="post-btn post-btn--ink post-btn--block" disabled={applySubmitting}>
                        {applySubmitting ? t('community.applying') : t('community.reapplyBtn')}
                      </button>
                    </form>
                  )}
                </>
              )}
            </>
          ) : post.contentHidden ? null : post.closedAt ? (
            <p className="post-note">{t('community.recruitClosed')}</p>
          ) : post.recruitState === 'ended' ? (
            <p className="post-note">{t('community.recruitEndedLine', { date: formatDeadline(post.recruitEndDate) })}</p>
          ) : writeLimited ? (
            <p className="post-note">{t('community.applyRestricted', { reason: sanction.reason })}</p>
          ) : post.authorUnavailable ? (
            <p className="post-note">{t('community.applyUnavailable')}</p>
          ) : null}
        </div>

        {/* 신청 칸은 화면 아래에 붙여 긴 글을 읽다가도 바로 신청할 수 있게 한다. */}
        {canApply && (
          <form className="post-dock" onSubmit={handleApply}>
            <textarea
              className="post-input"
              rows={2}
              aria-label={t('community.applyMessage')}
              value={applyMessage}
              onChange={(e) => setApplyMessage(e.target.value)}
              placeholder={t('community.applyPlaceholder')}
              required
            />
            <button type="submit" className="post-btn post-btn--ink post-btn--block post-btn--lg" disabled={applySubmitting}>
              {applySubmitting ? t('community.applying') : t('community.apply')}
            </button>
          </form>
        )}
      </>
    );
  };

  const capacityValue = writeFields.capacity === '' ? null : Number(writeFields.capacity);
  const stepCapacity = (delta) =>
    setWriteFields((f) => {
      const current = f.capacity === '' ? 0 : Number(f.capacity) || 0;
      const next = Math.min(MAX_CAPACITY, current + delta);
      return { ...f, capacity: next < 1 ? '' : String(next) };
    });

  const renderWriteForm = () => (
    <form className="post-write" onSubmit={handleWriteSubmit}>
      <div className="post-write-inner">
        {errorText && <p className="home-error">{errorText}</p>}
        {sanction?.scope === 'post_apply' && <SanctionBanner sanction={sanction} />}
        <p className="post-write-note">{editingPostId ? t('community.write.editHint') : t('community.write.newHintShort')}</p>

        <label htmlFor="community-write-title" className="sr-only">
          {t('community.write.title')}
        </label>
        <input
          id="community-write-title"
          className="post-write-title"
          type="text"
          maxLength={TITLE_MAX}
          placeholder={t('community.write.title')}
          value={writeFields.title}
          onChange={(e) => setWriteFields((f) => ({ ...f, title: e.target.value }))}
          required
        />
        <span className="post-write-count">
          {writeFields.title.length} / {TITLE_MAX}
        </span>
        <label htmlFor="community-write-body" className="sr-only">
          {t('community.write.body')}
        </label>
        <textarea
          id="community-write-body"
          className="post-write-body"
          rows={7}
          maxLength={1000}
          placeholder={t('community.write.bodyPlaceholder')}
          value={writeFields.body}
          onChange={(e) => setWriteFields((f) => ({ ...f, body: e.target.value }))}
          required
        />

        <p className="post-write-group">{t('community.write.group')}</p>
        <div className="write-settings">
          <div className="write-set">
            <span className="write-set-label" id="community-write-category">
              {t('community.write.category')}
            </span>
            <div className="seg" role="group" aria-labelledby="community-write-category">
              {['study', 'project'].map((c) => (
                <button key={c} type="button" className={writeFields.category === c ? 'active' : ''} aria-pressed={writeFields.category === c} onClick={() => setWriteFields((f) => ({ ...f, category: c }))}>
                  {t(`community.category.${c}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="write-set">
            <label className="write-set-label" htmlFor="community-write-capacity">
              {t('community.write.capacityLabel')}
              <small>{t('community.write.optional')}</small>
            </label>
            <div className="stepper">
              <button type="button" onClick={() => stepCapacity(-1)} disabled={capacityValue === null} aria-label={t('community.write.capacityLess')}>
                −
              </button>
              <input
                id="community-write-capacity"
                type="number"
                min={1}
                max={MAX_CAPACITY}
                inputMode="numeric"
                placeholder="–"
                value={writeFields.capacity}
                onChange={(e) => setWriteFields((f) => ({ ...f, capacity: e.target.value }))}
              />
              <span className="stepper-unit">{t('community.write.capacityUnit')}</span>
              <button type="button" onClick={() => stepCapacity(1)} disabled={capacityValue !== null && capacityValue >= MAX_CAPACITY} aria-label={t('community.write.capacityMore')}>
                +
              </button>
            </div>
          </div>
          <div className="write-set">
            <label className="write-set-label" htmlFor="community-recruit-end">
              {t('community.write.endDateLabel')}
              <small>{t('community.write.endDateShort')}</small>
            </label>
            <div className="date-pick">
              <span className={writeFields.recruitEndDate ? 'date-pick-value' : 'date-pick-value empty'}>
                {writeFields.recruitEndDate ? formatDay(writeFields.recruitEndDate, t) : t('community.write.endDateNone')}
              </span>
              <input
                id="community-recruit-end"
                className="date-pick-input"
                type="date"
                min={toDateInputValue(new Date())}
                max={toDateInputValue(new Date(Date.now() + MAX_RECRUIT_DAYS * 86400000))}
                value={writeFields.recruitEndDate}
                onClick={(e) => {
                  // 글자 위를 눌러도 날짜 고르기가 바로 열리게 한다(지원하지 않는 브라우저는 기본 동작).
                  try {
                    e.currentTarget.showPicker?.();
                  } catch {
                    // 이미 열려 있거나 막힌 경우 — 기본 동작으로 둔다
                  }
                }}
                onChange={(e) => setWriteFields((f) => ({ ...f, recruitEndDate: e.target.value }))}
              />
              {writeFields.recruitEndDate && (
                <button type="button" className="date-pick-clear" aria-label={t('community.write.endDateClear')} onClick={() => setWriteFields((f) => ({ ...f, recruitEndDate: '' }))}>
                  <IconX size={13} />
                </button>
              )}
            </div>
          </div>
          <TargetDepartmentsField
            mode={writeFields.deptMode}
            departments={writeFields.departments}
            onChange={({ mode, departments }) => setWriteFields((f) => ({ ...f, deptMode: mode, departments }))}
          />
        </div>
        {editingPostId && <p className="post-write-help">{t('community.write.endDateEditHint')}</p>}
      </div>
      <div className="post-dock">
        <button type="submit" className="post-btn post-btn--ink post-btn--block post-btn--lg" disabled={writeSubmitting}>
          {writeSubmitting ? t('community.write.saving') : editingPostId ? t('community.write.update') : t('community.write.submit')}
        </button>
      </div>
    </form>
  );

  // 전체 글 목록과 검색 결과가 같은 모양으로 보이도록 항목 하나를 그리는 함수를 공유한다.
  const renderPublicPostItem = (p) => {
    const excerpt = excerptOf(p.body);
    return (
      <button key={p.id} type="button" className={`post-row${isRecruitClosed(p.closedAt, p.recruitState) ? ' post-row--closed' : ''}`} onClick={() => openPost(p.id)} disabled={detailLoading}>
        <span className="post-over">
          <CategoryLabel category={p.category} />
          {p.isMyDepartment && <span className="post-mydept">{t('community.badge.myDept')}</span>}
          <RecruitState closedAt={p.closedAt} recruitState={p.recruitState} recruitEndDate={p.recruitEndDate} />
        </span>
        <span className="post-title">{p.title}</span>
        {excerpt && <span className="post-excerpt">{excerpt}</span>}
        {/* 서버가 아직 모집 학과를 안 내려주는 배포 순서(프론트 먼저)에서는 줄을 숨긴다. */}
        {p.targetDepartments && (
          <span className="post-meta post-dept">
            <span className="post-meta-label">{t('community.dept.label')}</span>
            {departmentLine(p.targetDepartments, t)}
          </span>
        )}
        <span className="post-meta">
          <span>{p.author}</span>
          <MetaSep />
          <span>{formatWhen(p.createdAt, t)}</span>
          {p.capacity && (
            <>
              <MetaSep />
              <span>{t('community.capacityShort', { n: p.capacity })}</span>
            </>
          )}
        </span>
      </button>
    );
  };

  const renderSearchResults = () => {
    if (!searchedQuery) return <p className="search-screen-hint">{t('community.search.hint')}</p>;
    if (searchError) return <p className="home-error">{t('community.search.err')}</p>;
    if (searchResults === null) return <p className="search-screen-hint">{t('search.loading')}</p>;
    if (searchResults.length === 0) return <p className="search-screen-hint">{t('search.empty', { query: searchedQuery })}</p>;
    return (
      <>
        <p className="search-screen-count">{t('community.search.count', { count: searchResults.length })}</p>
        <div className="community-post-list">{searchResults.map(renderPublicPostItem)}</div>
      </>
    );
  };

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={handleHeaderBack} aria-label={showWriteForm || selectedPost || noticeView ? t('community.backToList') : t('common.backHome')}>
            <IconChevronLeft />
          </button>
          <span className="screen-title">
            {noticeView ? t(noticeView.mode === 'write' && !noticeView.notice ? 'community.notice.write' : 'community.notice.heading') : t('nav.community')}
          </span>
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

      {toast && (
        <div className="import-toast">
          <IconCheck size={13} />
          <span>{toast}</span>
        </div>
      )}

      <div className="courses-body community-body">
        {sanction?.scope === 'full' ? (
          // 공지 화면과 전면 정지 안내는 예전 배치(안쪽 여백 16px)를 그대로 쓴다.
          <div className="community-pad community-sanction-full">
            <div className="community-sanction-icon">
              <IconBan size={28} />
            </div>
            <p className="community-sanction-heading">{t('community.sanctionFull.heading')}</p>
            <p className="community-sanction-detail">
              {sanction.endsAt ? t('community.sanctionFull.until', { date: formatDate(sanction.endsAt) }) : t('community.sanctionFull.permanent')}
            </p>
            <div className="community-sanction-reason-box">
              {tRich('community.sanctionFull.reason', { reason: sanction.reason })}
            </div>
            <p className="community-sanction-footer">{t('community.sanctionFull.footer')}</p>
          </div>
        ) : noticeView ? (
          <CommunityNotices
            view={noticeView}
            onChangeView={setNoticeView}
            notices={notices}
            isAdmin={user?.role === 'admin'}
            onOpenNotice={openNotice}
            onMarkAllRead={handleMarkAllNoticesRead}
            onChanged={loadNotices}
            onToast={showToast}
            when={noticeWhen}
          />
        ) : selectedPost ? (
          renderDetail()
        ) : showWriteForm ? (
          renderWriteForm()
        ) : (
          <>
            <div className="community-tabs">
              {[
                ['list', 'community.tab.all'],
                ['mine', 'community.tab.mine'],
                ['applications', 'community.tab.apps'],
                ['reports', 'community.tab.reports'],
              ].map(([key, label]) => (
                <button key={key} type="button" className={`community-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)} data-track={`community.tab.${key}`}>
                  {t(label)}
                  {key === 'reports' && unseenReportCount > 0 && tab !== 'reports' && <span className="tab-dot" aria-label={t('community.newResultsAria')} />}
                </button>
              ))}
            </div>

            {(errorText || sanction?.scope === 'post_apply') && (
              <div className="community-alerts">
                {errorText && <p className="home-error">{errorText}</p>}
                {sanction?.scope === 'post_apply' && <SanctionBanner sanction={sanction} />}
              </div>
            )}

            {tab === 'list' && (
              <>
                <div className="community-tools">
                  <button type="button" className="search-entry" onClick={() => setSearchOpen(true)} aria-label={t('community.search.aria')} data-track="community.search.open">
                    <IconSearch />
                    <span>{t('community.search.placeholder')}</span>
                  </button>
                  {user?.departmentId && (
                    <button
                      type="button"
                      className={`community-filter ${myDeptOnly ? 'active' : ''}`}
                      aria-pressed={myDeptOnly}
                      data-track={myDeptOnly ? 'community.mydept.off' : 'community.mydept.on'}
                      aria-label={t('community.myDeptFilter')}
                      onClick={() => {
                        setMyDeptOnly(!myDeptOnly);
                        writeMyDeptOnly(!myDeptOnly);
                      }}
                    >
                      {t('community.badge.myDept')}
                    </button>
                  )}
                </div>
                <NoticePin
                  notices={notices}
                  onOpenList={() => setNoticeView({ mode: 'list' })}
                  onOpenNotice={openNotice}
                  when={noticeWhen}
                  isAdmin={user?.role === 'admin'}
                  onWrite={() => setNoticeView({ mode: 'write' })}
                />
              </>
            )}

            {(tab === 'list' || tab === 'mine') && (
              <div className="post-list-head">
                <h3>
                  {tab === 'list' ? t('community.listHead.posts') : t('community.tab.mine')}
                  {(tab === 'list' ? visiblePosts : myPosts)?.length > 0 && <em>{(tab === 'list' ? visiblePosts : myPosts).length}</em>}
                </h3>
                <button type="button" className="post-write-btn" onClick={() => setShowWriteForm(true)} disabled={sanction?.scope === 'post_apply'} data-track="community.write.open">
                  <IconPlus size={15} />
                  {sanction?.scope === 'post_apply' ? t('community.writeBtnLimited') : t('community.writeBtn')}
                </button>
              </div>
            )}

            {loadFailedTab === tab && currentTabData !== null && <p className="home-stale-note">{t(LOAD_ERR_BY_TAB[tab].key)}</p>}
            {tab === 'list' ? (
              posts === null || notices === null ? (
                listPlaceholder()
              ) : posts.length === 0 ? (
                <p className="post-empty">{t('community.empty.posts')}</p>
              ) : visiblePosts.length === 0 ? (
                <p className="post-empty">{t('community.empty.myDept')}</p>
              ) : (
                <div className="post-list">{visiblePosts.map(renderPublicPostItem)}</div>
              )
            ) : tab === 'mine' ? (
              myPosts === null ? (
                listPlaceholder()
              ) : myPosts.length === 0 ? (
                <p className="post-empty">{t('community.empty.mine')}</p>
              ) : (
                <div className="post-list">
                  {myPosts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`post-row${isRecruitClosed(p.closedAt, p.recruitState) ? ' post-row--closed' : ''}`}
                      onClick={() => openPost(p.id)}
                      disabled={detailLoading}
                    >
                      <span className="post-over">
                        <CategoryLabel category={p.category} />
                        {p.status === 'approved' && <RecruitState closedAt={p.closedAt} recruitState={p.recruitState} recruitEndDate={p.recruitEndDate} />}
                      </span>
                      <span className="post-title">{p.title}</span>
                      <span className="post-meta">
                        <StatusText tone={POST_STATUS_TONE[p.status]}>{t(`community.postStatus.${p.status}`)}</StatusText>
                        <MetaSep />
                        <span>{formatWhen(p.createdAt, t)}</span>
                        {/* 서버가 아직 이 필드를 안 내려주는 배포 순서(프론트 먼저)에서는 undefined라 아무것도 안 보인다. */}
                        {p.applicationCount > 0 && (
                          <>
                            <MetaSep />
                            <span>{t('community.receivedApps', { n: p.applicationCount })}</span>
                          </>
                        )}
                      </span>
                      {p.pendingApplicationCount > 0 && <span className="post-new-apps">{t('community.pendingApps', { n: p.pendingApplicationCount })}</span>}
                    </button>
                  ))}
                </div>
              )
            ) : tab === 'reports' ? (
              myReports === null ? (
                listPlaceholder()
              ) : myReports.length === 0 ? (
                <p className="post-empty">{t('community.empty.reports')}</p>
              ) : (
                <div className="post-list">
                  {myReports.map((r) => (
                    <div key={r.id} className="post-row post-row--static">
                      <span className="post-over">
                        <span>{r.targetType === 'post' ? t('community.reportItem.post') : t('community.reportItem.application')}</span>
                        {r.isUnseen && <span className="post-mydept">{t('community.reportItem.newResult')}</span>}
                        <StatusText tone={r.status === 'resolved' ? 'ok' : 'wait'} end>
                          {t(`community.reportStatus.${r.status}`)}
                        </StatusText>
                      </span>
                      <span className="post-title">{r.targetTitle || t('community.reportItem.deletedPost')}</span>
                      <span className="post-meta">
                        <span>{t('community.reportItem.date', { date: formatDate(r.createdAt) })}</span>
                        {r.status === 'resolved' && r.resolvedAt && (
                          <>
                            <MetaSep />
                            <span>{t('community.reportItem.resolvedDate', { date: formatDate(r.resolvedAt) })}</span>
                          </>
                        )}
                      </span>
                      <p className="post-quote">{tRich('community.reportItem.myReason', { reason: r.reason })}</p>
                      {r.status === 'resolved' ? (
                        <p className="post-quote post-quote--answer">{tRich('community.reportItem.note', { note: r.resolutionNote || t('community.defaultResolution') })}</p>
                      ) : (
                        <p className="post-section-desc">{t('community.reportItem.waiting')}</p>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : myApplications === null ? (
              listPlaceholder()
            ) : myApplications.length === 0 ? (
              <p className="post-empty">{t('community.empty.apps')}</p>
            ) : (
              <div className="post-list">
                {myApplications.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`post-row${isRecruitClosed(a.postClosedAt, a.postRecruitState) ? ' post-row--closed' : ''}`}
                    onClick={() => openPost(a.postId)}
                    disabled={detailLoading}
                  >
                    <span className="post-over">
                      <CategoryLabel category={a.postCategory} />
                      <StatusText tone={APP_STATUS_TONE[a.status]} end>
                        {t(`community.appStatus.${a.status}`)}
                      </StatusText>
                    </span>
                    <span className="post-title">{a.postTitle}</span>
                    <span className="post-meta">{t('community.appItem.date', { author: a.author, date: formatDate(a.createdAt) })}</span>
                    {a.status === 'pending' && a.authorUnavailable && <span className="post-contact-line">{t('community.authorUnavailable')}</span>}
                    {a.contactBlockedAt ? (
                      <span className="post-contact-line">{t('community.contact.blockedBadge')}</span>
                    ) : (
                      a.contactEmail && <span className="post-contact-line">{t('community.appItem.contact', { email: a.contactEmail })}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {searchOpen && (
        <SearchScreen
          search={postSearch}
          onClose={dismissSearch}
          placeholder={t('community.search.placeholder')}
          ariaLabel={t('community.search.aria')}
          // 결과에서 글을 열면 검색 화면은 닫지 않고 숨겨 둔다 — 상세에서 뒤로가면 검색 결과가 그대로 있다.
          hidden={!!selectedPost || showWriteForm}
        >
          {renderSearchResults()}
        </SearchScreen>
      )}

      <BlockContactDialog target={blockTarget} submitting={blockSubmitting} onConfirm={handleBlockContact} onClose={() => setBlockTarget(null)} />

      {sanctionPost && (
        <StudentSanctionDialog
          studentId={sanctionPost.authorId}
          nickname={sanctionPost.author}
          onClose={() => setSanctionPost(null)}
          onDone={(scope) => {
            setSanctionPost(null);
            showToast(t(scope === 'warning' ? 'community.toast.warned' : 'community.toast.sanctioned'));
          }}
        />
      )}

      {reportFormOpen && (
        <div className="career-confirm-overlay" onClick={() => setReportFormOpen(false)}>
          <form className="career-confirm-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleReportPost}>
            {errorText && <p className="home-error">{errorText}</p>}
            <div className="auth-field">
              <label>{t('community.reportReasonLabel')}</label>
              <textarea
                rows={3}
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                placeholder={t('community.reportReasonPlaceholder2')}
                required
                autoFocus
              />
            </div>
            <div className="community-applicant-actions">
              <button type="submit" className="community-act-btn community-act-reject" disabled={reportSubmitting}>
                {reportSubmitting ? t('community.reporting') : t('community.submitReport')}
              </button>
              <button type="button" className="community-outline-btn" onClick={() => setReportFormOpen(false)}>
                {t('onb.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default Community;
