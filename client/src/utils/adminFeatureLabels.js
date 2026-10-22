// 관리자 "기능 사용" 화면의 이름표 — 기능 이름(utils/track.js의 data-track·track() 값)을 사람이 읽는 이름으로 바꾼다.
// 새 data-track을 붙이면 여기에도 이름을 더한다(없으면 기능 이름이 그대로 보인다).

export const SCREEN_LABEL = {
  view: '화면 열림',
  home: '홈',
  tabbar: '하단 바',
  career: '진로 탐색',
  community: '커뮤니티',
  inquiry: '문의',
  settings: '설정',
  chat: '챗봇',
  courses: '과목 관리',
  graduation: '졸업요건 진단',
  profile: '계정',
  onboarding: '학과·학번',
  menu: '메뉴',
};

// 화면(view.*)과 메뉴 칸(home.menu.*, tabbar.*)이 가리키는 곳.
const VIEW_LABEL = {
  home: '홈',
  chat: '챗봇',
  courses: '과목 관리',
  graduation: '졸업요건 진단',
  career: '진로 탐색',
  community: '커뮤니티',
  inquiry: '문의하기',
  settings: '설정',
  profile: '계정 정보',
  onboarding: '학과·학번 수정',
  admin: '관리자',
  privacy: '개인정보처리방침',
  terms: '이용약관',
};

const EXACT = {
  'home.edit': '홈 화면 편집',
  'career.recommend.limit': '진로 추천 받기(대화 한도에 닿았을 때)',
  'career.recommend.confirm': '진로 추천 확인 · 받기',
  'career.recommend.cancel': '진로 추천 확인 · 취소',
  'community.write.open': '글쓰기 열기',
  'community.write.posted': '글 등록',
  'community.post.applied': '참여 신청',
  'community.search.open': '검색 열기',
  'community.mydept.on': '내 학과 글만 보기 켜기',
  'community.mydept.off': '내 학과 글만 보기 끄기',
  'community.tab.list': '탭 · 전체 글',
  'community.tab.mine': '탭 · 내가 쓴 글',
  'community.tab.applications': '탭 · 내 신청',
  'community.tab.reports': '탭 · 신고 내역',
  'inquiry.sent': '문의 보내기',
  'chat.citations.show': '참고한 자료 펼치기',
  'chat.citations.hide': '참고한 자료 접기',
  'settings.theme.light': '테마 · 밝게',
  'settings.theme.dark': '테마 · 어둡게',
  'settings.font.small': '글자 크기 · 작게',
  'settings.font.medium': '글자 크기 · 보통',
  'settings.font.large': '글자 크기 · 크게',
  'settings.lang.ko': '언어 · 한국어',
  'settings.lang.en': '언어 · English',
};

export function screenOf(event) {
  return event.split('.')[0];
}

export function featureLabel(event) {
  if (EXACT[event]) return EXACT[event];
  const parts = event.split('.');
  if (parts[0] === 'view') return VIEW_LABEL[parts[1]] || parts[1];
  if (parts[0] === 'home' && parts[1] === 'menu') return `메뉴 · ${VIEW_LABEL[parts[2]] || parts[2]}`;
  if (parts[0] === 'tabbar') return VIEW_LABEL[parts[1]] || parts[1];
  if (parts[0] === 'career' && parts[1] === 'recommend' && parts[2]?.startsWith('turn_')) {
    const n = parts[2].slice(5);
    return `진로 추천 받기 · ${n === '10plus' ? '10번째 대화 이후' : `${n}번째 대화`}`;
  }
  return event;
}

// 하단 바와 홈 메뉴에 둘 다 있는 기능 — "같은 기능, 어디서 더 누를까" 비교 대상.
export const SHARED_MENU_VIEWS = ['graduation', 'courses', 'career', 'community', 'inquiry'];

export function viewLabel(view) {
  return VIEW_LABEL[view] || view;
}

// 진로 추천을 누른 대화 횟수 구간(그래프 칸). 6~9번은 한 칸으로 묶는다.
export const RECOMMEND_BINS = [
  { label: '0', turns: ['0'] },
  { label: '1', turns: ['1'] },
  { label: '2', turns: ['2'] },
  { label: '3', turns: ['3'] },
  { label: '4', turns: ['4'] },
  { label: '5', turns: ['5'] },
  { label: '6~9', turns: ['6', '7', '8', '9'] },
  { label: '10+', turns: ['10plus'] },
];
