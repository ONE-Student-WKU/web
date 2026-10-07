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
} from '../api/chatApi.js';
import AccountMenu from '../components/AccountMenu.jsx';
import { IconChevronLeft, IconCheck, IconPlus, IconSiren, IconX, IconBan, IconAlertTriangle } from '../components/icons.jsx';
import { readCache, writeCache, clearCache } from '../utils/sessionCache.js';
import { useI18n } from '../i18n/I18nContext.jsx';

// Home.jsx와 동일한 이유(재진입 시 빈 화면 깜빡임 방지)로 모듈 스코프에 캐시해둔다.
// sessionStorage에서 초기값을 복원해서, 탭이 살아있는 채로 페이지가 다시 로드되는 경우
// (utils/sessionCache.js 참고)에도 즉시 보여줄 수 있다.
const communityCache = {
  posts: readCache('community_posts'),
  myPosts: readCache('community_myPosts'),
  myApplications: readCache('community_myApplications'),
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
  clearCache('community_posts');
  clearCache('community_myPosts');
  clearCache('community_myApplications');
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
  const errorText = error && (typeof error === 'object' ? t(error.key) : error);

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

  const [showWriteForm, setShowWriteForm] = useState(false);
  const [writeFields, setWriteFields] = useState({ title: '', body: '', category: 'study', capacity: '', recruitEndDate: '' });
  const [writeSubmitting, setWriteSubmitting] = useState(false);
  // null이면 새 글 작성, 값이 있으면 그 id의 글을 수정 중(같은 폼을 재사용).
  const [editingPostId, setEditingPostId] = useState(null);

  const [applyMessage, setApplyMessage] = useState('');
  const [applySubmitting, setApplySubmitting] = useState(false);
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // 글 신고 — 상세 화면 하나에 글이 하나뿐이라 단일 상태로 충분.
  const [reportFormOpen, setReportFormOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  // 신청 메시지 신고 — 신청자 목록엔 여러 카드가 있어서 id별로 따로 들고 있어야 한다
  // (rejectMessages와 동일한 이유).
  const [applicantReportOpenId, setApplicantReportOpenId] = useState(null);
  const [applicantReportReasons, setApplicantReportReasons] = useState({});
  const [applicantReportSubmittingId, setApplicantReportSubmittingId] = useState(null);

  // 목록 → 상세/글쓰기 이동도 모바일 뒤로가기 스택에 반영해야, 뒤로가기를 눌렀을 때 곧장
  // 홈으로 나가지 않고 먼저 목록으로 돌아온다(App.jsx의 view 히스토리 관리, Admin.jsx의
  // adminView 히스토리 관리와 같은 방식 — 실사용 확인된 문제: 상세 보다가 뒤로가기를 누르면
  // 목록을 건너뛰고 곧장 홈으로 나가버림). 상세/글쓰기는 글 id 등 실제 데이터가 있어야
  // 복원 가능해서, 뒤로가기로는 항상 목록으로만 돌아가게 하고 그 안의 세부 화면(상세 vs
  // 글쓰기)까지 구분해서 복원하지는 않는다 — 목록 밖으로 새지만 않으면 되는 문제라 이 정도로 충분.
  const inSubView = showWriteForm || !!selectedPost;
  const skipHistoryPush = useRef(true);

  useEffect(() => {
    function handlePopState(event) {
      skipHistoryPush.current = true;
      if (!event.state?.communityInSubView) {
        setSelectedPost(null);
        setShowWriteForm(false);
      }
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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
    function handleFetchError(err, fallbackMessage) {
      if (err.code === 'SANCTIONED') setSanction(err.data);
      else setError(fallbackMessage);
    }

    if (tab === 'list') {
      getCommunityPosts()
        .then((list) => {
          setPosts(list);
          setCommunityCache('posts', list);
        })
        .catch((err) => handleFetchError(err, ERR.loadPosts));
    } else if (tab === 'mine') {
      getMyCommunityPosts()
        .then((mine) => {
          setMyPosts(mine);
          setCommunityCache('myPosts', mine);
        })
        .catch((err) => handleFetchError(err, ERR.loadMine));
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
        .catch((err) => handleFetchError(err, ERR.loadReports));
    } else {
      getMyCommunityApplications()
        .then((myApps) => {
          setMyApplications(myApps);
          setCommunityCache('myApplications', myApps);
        })
        .catch((err) => handleFetchError(err, ERR.loadApps));
    }
  }, [tab]);

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
    setWriteFields({ title: '', body: '', category: 'study', capacity: '', recruitEndDate: '' });
    setEditingPostId(null);
    setShowWriteForm(false);
  };

  // 헤더 좌측 화살표 — 목록/상세/글쓰기 중 어디에 있는지에 따라 한 단계만 뒤로 간다.
  // 글쓰기·상세 화면에서도 그냥 onGoHome을 쓰면 커뮤니티 목록을 건너뛰고 바로 홈으로
  // 나가버려서(글 쓰던 중이면 작성 중이던 내용까지 예고 없이 날아감), 서브뷰가 열려있을
  // 땐 그 서브뷰만 닫고 목록으로 돌아가게 한다.
  const handleHeaderBack = () => {
    if (showWriteForm) {
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
    setWriteSubmitting(true);
    setError(null);
    try {
      const payload = {
        title: writeFields.title.trim(),
        body: writeFields.body.trim(),
        category: writeFields.category,
        capacity: writeFields.capacity === '' ? null : Number(writeFields.capacity),
        recruitEndDate: writeFields.recruitEndDate || null,
      };
      if (editingPostId) {
        await editCommunityPost(editingPostId, payload);
        showToast(t('community.toast.edited'));
      } else {
        await createCommunityPost(payload);
        showToast(t('community.toast.posted'));
      }
      resetAfterWrite();
      setSelectedPost(null);
      setTab('mine');
      await refreshLists();
    } catch (err) {
      // 제재가 걸린 뒤 이 화면을 열어둔 경우(또는 getMySanction이 실패했던 경우)에도 안내가 나오게 서버 응답으로 채운다.
      if (err.code === 'SANCTIONED') {
        setSanction(err.data);
        setError(editingPostId ? t('community.err.editSanctioned') : t('community.err.writeSanctioned'));
      } else if (err.code === 'INVALID_RECRUIT_END') {
        setError(t('community.err.recruitEnd'));
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
    });
    setEditingPostId(post.id);
    setSelectedPost(null);
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
    return (
      <div className="community-detail">
        {errorText && <p className="home-error">{errorText}</p>}
        <div className="community-detail-title-row">
          <h2 className="community-detail-title">
            {isRecruitClosed(post.closedAt, post.recruitState) && <span className="community-closed-prefix">{t('community.closedPrefix')}</span>}
            {post.contentHidden ? t('community.hiddenTitle') : post.title}
          </h2>
          {!post.isMine && (
            <div className="community-detail-title-actions">
              <button type="button" className="community-title-icon-btn" onClick={() => setReportFormOpen(true)} aria-label={t('community.reportAria')}>
                <IconSiren size={20} />
              </button>
              {user?.role === 'admin' && (
                <button
                  type="button"
                  className="community-title-icon-btn"
                  onClick={() => handleAdminDelete(post)}
                  disabled={deleteSubmitting}
                  aria-label={t('community.adminDeleteAria')}
                >
                  <IconX size={20} />
                </button>
              )}
            </div>
          )}
        </div>
        <p className="community-detail-meta">
          {post.author} · {formatDate(post.createdAt)}
          <span className={`community-badge community-badge-${post.category}`}>{t(`community.category.${post.category}`)}</span>
          {post.capacity && <span className="community-badge community-badge-capacity">{t('community.capacity', { n: post.capacity })}</span>}
          {post.closedAt && <span className="community-badge community-badge-closed">{t('community.badge.closed')}</span>}
          {!post.closedAt && post.recruitState === 'ended' && <span className="community-badge community-badge-closed">{t('community.badge.periodEnded')}</span>}
          {!post.closedAt && post.recruitState === 'open' && post.recruitEndDate && (
            <span className="community-badge community-badge-capacity">{t('community.deadlineBadge', { date: formatDeadline(post.recruitEndDate) })}</span>
          )}
          {post.status !== 'approved' && (
            <span className={`community-badge community-badge-${post.status}`}>{t(`community.postStatus.${post.status}`)}</span>
          )}
        </p>
        {post.contentHidden ? (
          <p className="courses-manual-hint">
            {t('community.hiddenBody')}
          </p>
        ) : (
          <p className="community-detail-body">{post.body}</p>
        )}

        {post.status === 'rejected' && post.rejectReason && (
          <p className="admin-reject-reason">
            <b>{t('community.label.rejectReason')}</b> · {post.rejectReason}
          </p>
        )}

        {post.isMine ? (
          <>
            {post.status === 'approved' && !post.closedAt && post.recruitState === 'ended' && (
              <p className="community-close-hint">
                {t('community.endedHint', { date: formatDeadline(post.recruitEndDate) })}
              </p>
            )}
            {post.status === 'approved' && !post.closedAt && (
              <>
                <button
                  type="button"
                  className="community-close-btn"
                  onClick={() => handleClose(post)}
                  disabled={closeSubmitting || applicantsLoading || applicants.length === 0}
                >
                  {closeSubmitting ? t('community.processing') : t('community.closeBtn')}
                </button>
                {!applicantsLoading && applicants.length === 0 && (
                  <p className="community-close-hint">{t('community.closeNeedApplicant')}</p>
                )}
              </>
            )}
            {sanction?.scope === 'post_apply' && <SanctionBanner sanction={sanction} />}
            <div className="community-owner-actions">
              <button type="button" className="community-outline-btn" onClick={() => startEdit(post)} disabled={sanction?.scope === 'post_apply'}>
                {sanction?.scope === 'post_apply' ? t('community.editLimited') : t('community.edit')}
              </button>
              <button type="button" className="community-outline-btn community-danger" onClick={() => handleDelete(post)} disabled={deleteSubmitting}>
                {deleteSubmitting ? t('community.deleting') : t('community.delete')}
              </button>
            </div>

            <p className="community-section-label">
              {t('community.applicantsHeading', { title: post.title, count: applicants.length })}
            </p>
            {applicantsLoading ? (
              <p className="courses-manual-hint">{t('community.loading')}</p>
            ) : applicants.length === 0 ? (
              <p className="courses-manual-hint">{t('community.noApplicants')}</p>
            ) : (
              <div className="community-applicant-list">
                {applicants.map((a) => (
                  <div className="community-applicant-card" key={a.id}>
                    <div className="community-applicant-top">
                      <span className="community-applicant-name">{a.applicant}</span>
                      {a.hasAppliedBefore && <span className="community-badge community-badge-reapply">{t('community.reapplied')}</span>}
                      <span className={`community-badge community-badge-${a.status}`}>{t(`community.appStatus.${a.status}`)}</span>
                    </div>
                    <p className="community-applicant-msg">{a.message}</p>
                    <div className="community-applicant-date">
                      {t('community.applicantDate', { date: formatDate(a.createdAt), title: post.title })}
                    </div>
                    {a.status === 'pending' && (
                      <>
                        <textarea
                          className="community-reject-message-input"
                          rows={2}
                          placeholder={t('community.rejectPlaceholder')}
                          value={rejectMessages[a.id] || ''}
                          onChange={(e) => setRejectMessages((prev) => ({ ...prev, [a.id]: e.target.value }))}
                        />
                        <div className="community-applicant-actions">
                          <button
                            type="button"
                            className="community-act-btn community-act-accept"
                            onClick={() => handleDecideApplication(a.id, 'accepted')}
                            disabled={applicantActionId === a.id}
                          >
                            {t('community.accept')}
                          </button>
                          <button
                            type="button"
                            className="community-act-btn community-act-reject"
                            onClick={() => handleDecideApplication(a.id, 'rejected')}
                            disabled={applicantActionId === a.id}
                          >
                            {t('community.decline')}
                          </button>
                        </div>
                      </>
                    )}
                    {a.status === 'accepted' && a.contactEmail && (
                      <div className="community-contact-box">
                        <b>{t('community.label.contactEmail')}</b> · {a.contactEmail}
                      </div>
                    )}
                    {a.status === 'rejected' && a.rejectReason && (
                      <p className="community-reject-message">
                        <b>{t('community.label.declineReason')}</b> · {a.rejectReason}
                      </p>
                    )}
                    {applicantReportOpenId === a.id ? (
                      <>
                        <textarea
                          className="community-reject-message-input"
                          rows={2}
                          placeholder={t('community.reportReasonPlaceholder')}
                          value={applicantReportReasons[a.id] || ''}
                          onChange={(e) => setApplicantReportReasons((prev) => ({ ...prev, [a.id]: e.target.value }))}
                        />
                        <div className="community-applicant-actions">
                          <button
                            type="button"
                            className="community-act-btn community-act-reject"
                            onClick={() => handleReportApplication(a.id)}
                            disabled={applicantReportSubmittingId === a.id}
                          >
                            {applicantReportSubmittingId === a.id ? t('community.reporting') : t('community.submitReport')}
                          </button>
                          <button type="button" className="community-outline-btn" onClick={() => setApplicantReportOpenId(null)}>
                            {t('onb.cancel')}
                          </button>
                        </div>
                      </>
                    ) : (
                      <button type="button" className="community-outline-btn community-danger" onClick={() => setApplicantReportOpenId(a.id)}>
                        {t('community.report')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {post.myApplication === null ? (
              post.closedAt ? (
                <p className="courses-manual-hint">{t('community.recruitClosed')}</p>
              ) : post.recruitState === 'ended' ? (
                <p className="courses-manual-hint">{t('community.recruitEndedLine', { date: formatDeadline(post.recruitEndDate) })}</p>
              ) : sanction?.scope === 'post_apply' ? (
                <p className="courses-manual-hint">{t('community.applyRestricted', { reason: sanction.reason })}</p>
              ) : (
                <form className="community-apply-form" onSubmit={handleApply}>
                  <div className="auth-field">
                    <label>{t('community.applyMessage')}</label>
                    <textarea
                      rows={5}
                      value={applyMessage}
                      onChange={(e) => setApplyMessage(e.target.value)}
                      placeholder={t('community.applyPlaceholder')}
                      required
                    />
                  </div>
                  <button type="submit" className="auth-submit-btn" disabled={applySubmitting}>
                    {applySubmitting ? t('community.applying') : t('community.apply')}
                  </button>
                </form>
              )
            ) : (
              <div className="community-status-box">
                <div className="community-status-top">
                  <span className="community-status-label">{t('community.myApplication')}</span>
                  <span className={`community-badge community-badge-${post.myApplication.status}`}>
                    {t(`community.appStatus.${post.myApplication.status}`)}
                  </span>
                </div>
                {post.myApplication.status === 'pending' && (
                  <p className="community-status-desc">{t('community.pendingDesc')}</p>
                )}
                {post.myApplication.status === 'accepted' && (
                  <p className="community-status-desc">{t('community.acceptedDesc')}</p>
                )}
                {post.myApplication.status === 'rejected' && post.myApplication.rejectReason && (
                  <p className="community-reject-message">
                    <b>{t('community.label.declineReason')}</b> · {post.myApplication.rejectReason}
                  </p>
                )}
                {post.myApplication.status === 'rejected' && !isRecruitClosed(post.closedAt, post.recruitState) && (
                  <>
                    <p className="community-status-desc">{t('community.notSelectedDesc')}</p>
                    {sanction?.scope === 'post_apply' ? (
                      <p className="courses-manual-hint">{t('community.reapplyRestricted', { reason: sanction.reason })}</p>
                    ) : (
                      <form className="community-apply-form" onSubmit={handleApply}>
                        <div className="auth-field">
                          <label>{t('community.reapplyLabel')}</label>
                          <textarea
                            rows={4}
                            value={applyMessage}
                            onChange={(e) => setApplyMessage(e.target.value)}
                            placeholder={t('community.reapplyPlaceholder')}
                            required
                          />
                        </div>
                        <button type="submit" className="auth-submit-btn" disabled={applySubmitting}>
                          {applySubmitting ? t('community.applying') : t('community.reapplyBtn')}
                        </button>
                      </form>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const renderWriteForm = () => (
    <form className="courses-manual-fields community-write-form" onSubmit={handleWriteSubmit}>
      {errorText && <p className="home-error">{errorText}</p>}
      {sanction?.scope === 'post_apply' && <SanctionBanner sanction={sanction} />}
      <p className="courses-manual-hint">
        {editingPostId ? t('community.write.editHint') : t('community.write.newHint')}
      </p>
      <div className="community-write-row">
        <div className="auth-field">
          <label>{t('community.write.category')}</label>
          <select className="onb-select" value={writeFields.category} onChange={(e) => setWriteFields((f) => ({ ...f, category: e.target.value }))}>
            <option value="study">{t('community.category.study')}</option>
            <option value="project">{t('community.category.project')}</option>
          </select>
        </div>
        <div className="auth-field">
          <label>{t('community.write.capacity')}</label>
          <input
            type="number"
            min={1}
            max={999}
            placeholder={t('community.write.capacityPlaceholder')}
            value={writeFields.capacity}
            onChange={(e) => setWriteFields((f) => ({ ...f, capacity: e.target.value }))}
          />
        </div>
      </div>
      <div className="auth-field">
        <label htmlFor="community-recruit-end">{t('community.write.endDate')}</label>
        <input
          id="community-recruit-end"
          type="date"
          min={toDateInputValue(new Date())}
          max={toDateInputValue(new Date(Date.now() + MAX_RECRUIT_DAYS * 86400000))}
          value={writeFields.recruitEndDate}
          onChange={(e) => setWriteFields((f) => ({ ...f, recruitEndDate: e.target.value }))}
        />
        <p className="courses-manual-hint">
          {t('community.write.endDateHint')}
          {editingPostId && ` ${t('community.write.endDateEditHint')}`}
        </p>
      </div>
      <div className="auth-field">
        <label htmlFor="community-write-title">{t('community.write.title')}</label>
        <input
          id="community-write-title"
          type="text"
          maxLength={20}
          value={writeFields.title}
          onChange={(e) => setWriteFields((f) => ({ ...f, title: e.target.value }))}
          required
        />
      </div>
      <div className="auth-field">
        <label htmlFor="community-write-body">{t('community.write.body')}</label>
        <textarea id="community-write-body" rows={6} maxLength={1000} value={writeFields.body} onChange={(e) => setWriteFields((f) => ({ ...f, body: e.target.value }))} required />
      </div>
      <button type="submit" className="auth-submit-btn" disabled={writeSubmitting}>
        {writeSubmitting ? t('community.write.saving') : editingPostId ? t('community.write.update') : t('community.write.submit')}
      </button>
      <button type="button" className="courses-manual-only-note courses-catalog-back" onClick={resetAfterWrite}>
        {t('onb.cancel')}
      </button>
    </form>
  );

  return (
    <div className="courses-page">
      <header className="screen-header">
        <div className="screen-header-left">
          <button className="back-btn" onClick={handleHeaderBack} aria-label={showWriteForm || selectedPost ? t('community.backToList') : t('common.backHome')}>
            <IconChevronLeft />
          </button>
          <span className="screen-title">{t('nav.community')}</span>
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

      <div className="courses-body">
        {sanction?.scope === 'full' ? (
          <div className="community-sanction-full">
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
        ) : selectedPost ? (
          renderDetail()
        ) : showWriteForm ? (
          renderWriteForm()
        ) : (
          <>
            {errorText && <p className="home-error">{errorText}</p>}

            {sanction?.scope === 'post_apply' && <SanctionBanner sanction={sanction} />}

            <div className="courses-year-tabs">
              <button type="button" className={`courses-year-tab ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>
                {t('community.tab.all')}
              </button>
              <button type="button" className={`courses-year-tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>
                {t('community.tab.mine')}
              </button>
              <button
                type="button"
                className={`courses-year-tab ${tab === 'applications' ? 'active' : ''}`}
                onClick={() => setTab('applications')}
              >
                {t('community.tab.apps')}
              </button>
              <button type="button" className={`courses-year-tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>
                {t('community.tab.reports')}
                {unseenReportCount > 0 && tab !== 'reports' && <span className="tab-dot" aria-label={t('community.newResultsAria')} />}
              </button>
            </div>

            {tab === 'list' ? (
              posts === null ? (
                <p className="courses-manual-hint">{t('community.loading')}</p>
              ) : posts.length === 0 ? (
                <p className="courses-manual-hint">{t('community.empty.posts')}</p>
              ) : (
                <div className="community-post-list">
                  {posts.map((p) => (
                    <button
                      key={p.id}
                      className={`community-post-list-item ${isRecruitClosed(p.closedAt, p.recruitState) ? 'community-post-list-item-closed' : ''}`}
                      onClick={() => openPost(p.id)}
                      disabled={detailLoading}
                    >
                      <span className="community-post-list-row">
                        {isRecruitClosed(p.closedAt, p.recruitState) && <span className="community-closed-prefix">{t('community.closedPrefix')}</span>}
                        <span className="community-post-list-title">{p.title}</span>
                        <span className={`community-badge community-badge-${p.category}`}>{t(`community.category.${p.category}`)}</span>
                      </span>
                      <span className="courses-list-item-meta">
                        {p.author} · {formatDate(p.createdAt)}
                        {p.capacity && ` · ${t('community.capacity', { n: p.capacity })}`}
                        {p.recruitEndDate && !isRecruitClosed(p.closedAt, p.recruitState) && ` · ${t('community.deadlineShort', { date: formatDeadline(p.recruitEndDate) })}`}
                      </span>
                    </button>
                  ))}
                </div>
              )
            ) : tab === 'mine' ? (
              myPosts === null ? (
                <p className="courses-manual-hint">{t('community.loading')}</p>
              ) : myPosts.length === 0 ? (
                <p className="courses-manual-hint">{t('community.empty.mine')}</p>
              ) : (
                <div className="community-post-list">
                  {myPosts.map((p) => (
                    <button
                      key={p.id}
                      className={`community-post-list-item ${isRecruitClosed(p.closedAt, p.recruitState) ? 'community-post-list-item-closed' : ''}`}
                      onClick={() => openPost(p.id)}
                      disabled={detailLoading}
                    >
                      <span className="community-post-list-row">
                        {isRecruitClosed(p.closedAt, p.recruitState) && <span className="community-closed-prefix">{t('community.closedPrefix')}</span>}
                        <span className="community-post-list-title">{p.title}</span>
                        <span className={`community-badge community-badge-${p.category}`}>{t(`community.category.${p.category}`)}</span>
                        <span className={`community-badge community-badge-${p.status}`}>{t(`community.postStatus.${p.status}`)}</span>
                      </span>
                      <span className="courses-list-item-meta">
                        {formatDate(p.createdAt)}
                        {p.capacity && ` · ${t('community.capacity', { n: p.capacity })}`}
                        {p.recruitEndDate && !isRecruitClosed(p.closedAt, p.recruitState) && ` · ${t('community.deadlineShort', { date: formatDeadline(p.recruitEndDate) })}`}
                        {/* 서버가 아직 이 필드를 안 내려주는 배포 순서(프론트 먼저)에서는 undefined라 아무것도 안 보인다. */}
                        {p.applicationCount > 0 && ` · ${t('community.receivedApps', { n: p.applicationCount })}`}
                      </span>
                      {p.pendingApplicationCount > 0 && (
                        <span className="community-row-pending">{t('community.pendingApps', { n: p.pendingApplicationCount })}</span>
                      )}
                    </button>
                  ))}
                </div>
              )
            ) : tab === 'reports' ? (
              myReports === null ? (
                <p className="courses-manual-hint">{t('community.loading')}</p>
              ) : myReports.length === 0 ? (
                <p className="courses-manual-hint">{t('community.empty.reports')}</p>
              ) : (
                <div className="community-post-list">
                  {myReports.map((r) => (
                    <div key={r.id} className="community-status-box">
                      <div className="community-status-top">
                        <span className="community-status-label">
                          {r.targetType === 'post' ? t('community.reportItem.post') : t('community.reportItem.application')} · {r.targetTitle || t('community.reportItem.deletedPost')}
                        </span>
                        <span className={`community-badge community-badge-${r.status === 'resolved' ? 'accepted' : 'pending'}`}>
                          {t(`community.reportStatus.${r.status}`)}
                        </span>
                      </div>
                      <p className="community-detail-meta">
                        {t('community.reportItem.date', { date: formatDate(r.createdAt) })}
                        {r.status === 'resolved' && r.resolvedAt && ` · ${t('community.reportItem.resolvedDate', { date: formatDate(r.resolvedAt) })}`}
                        {r.isUnseen && <span className="community-badge community-badge-new">{t('community.reportItem.newResult')}</span>}
                      </p>
                      <p className="community-detail-body">
                        {tRich('community.reportItem.myReason', { reason: r.reason })}
                      </p>
                      {r.status === 'resolved' ? (
                        <p className="community-resolution-note">
                          {tRich('community.reportItem.note', { note: r.resolutionNote || t('community.defaultResolution') })}
                        </p>
                      ) : (
                        <p className="community-status-desc">{t('community.reportItem.waiting')}</p>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : myApplications === null ? (
              <p className="courses-manual-hint">{t('community.loading')}</p>
            ) : myApplications.length === 0 ? (
              <p className="courses-manual-hint">{t('community.empty.apps')}</p>
            ) : (
              <div className="community-post-list">
                {myApplications.map((a) => (
                  <button
                    key={a.id}
                    className={`community-post-list-item ${isRecruitClosed(a.postClosedAt, a.postRecruitState) ? 'community-post-list-item-closed' : ''}`}
                    onClick={() => openPost(a.postId)}
                    disabled={detailLoading}
                  >
                    <span className="community-post-list-row">
                      {isRecruitClosed(a.postClosedAt, a.postRecruitState) && <span className="community-closed-prefix">{t('community.closedPrefix')}</span>}
                      <span className="community-post-list-title">{a.postTitle}</span>
                      <span className={`community-badge community-badge-${a.postCategory}`}>{t(`community.category.${a.postCategory}`)}</span>
                      <span className={`community-badge community-badge-${a.status}`}>{t(`community.appStatus.${a.status}`)}</span>
                    </span>
                    <span className="courses-list-item-meta">
                      {t('community.appItem.date', { author: a.author, date: formatDate(a.createdAt) })}
                    </span>
                    {a.contactEmail && <span className="community-row-contact">{t('community.appItem.contact', { email: a.contactEmail })}</span>}
                  </button>
                ))}
              </div>
            )}

            {(tab === 'list' || tab === 'mine') && (
              <button
                type="button"
                className="community-write-btn"
                onClick={() => setShowWriteForm(true)}
                disabled={sanction?.scope === 'post_apply'}
              >
                <IconPlus size={16} />
                {sanction?.scope === 'post_apply' ? t('community.writeBtnLimited') : t('community.writeBtn')}
              </button>
            )}
          </>
        )}
      </div>

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
