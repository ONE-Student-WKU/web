import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', () => ({
  getAdminCommunityPosts: vi.fn(),
  approveAdminPost: vi.fn(),
  rejectAdminPost: vi.fn(),
  deleteAdminPost: vi.fn(),
  getAdminReports: vi.fn(),
  resolveAdminReport: vi.fn(),
  sanctionReport: vi.fn(),
  getAdminSanctions: vi.fn(),
  liftSanction: vi.fn(),
  getAdminInquiries: vi.fn(),
  resolveAdminInquiry: vi.fn(),
  getAdminStats: vi.fn(),
  getAdminPending: vi.fn(),
  getAdminStatsTrend: vi.fn(),
  getAdminStatsComposition: vi.fn(),
  getAdminFeatureUsage: vi.fn(),
  getReportedStudentSummary: vi.fn(),
  getAiLabelComparison: vi.fn(),
  draftInquiryReply: vi.fn(),
  withdrawSanction: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import Admin from './Admin.jsx';
import { resetAdminTrendCache } from '../components/AdminTrendView.jsx';
import { groupReports } from '../components/admin/AdminReports.jsx';

/**
 * client/src/pages/Admin.test.jsx
 * 관리자 화면(2026-10-23 개편): 첫 화면(처리할 일 → 이용 현황 → 최근 24시간 → 관리), 통계(추이·기능 사용·학과·학번),
 * 신고함(대상별로 묶은 목록 → 상세 → 아래에서 올라오는 시트), 문의함(목록 → 상세에서 답변), 커뮤니티 관리, 제재 관리.
 * 새로고침 시 하위 화면 유지, 제재 사유 기본값(중립 문구), 신고자·문의자에게 보낼 안내도 확인한다. API는 mock이다.
 */

const NEUTRAL = '커뮤니티 운영 정책 위반';
const RESOLUTION_DEFAULT = '신고를 검토했고 커뮤니티 운영 정책에 따라 처리했어요. 신고해 주셔서 고마워요.';
const baseProps = {
  user: { name: '관리자', role: 'admin' },
  onGoHome: vi.fn(),
  onLogout: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenOnboarding: vi.fn(),
  onOpenProfile: vi.fn(),
  onOpenInquiry: vi.fn(),
  onOpenPost: vi.fn(),
};

const report = (over = {}) => ({
  id: 10,
  reporter: '신고자',
  reason: '이 사람은 쓰레기예요 010-1234-5678',
  status: 'pending',
  createdAt: '2026-09-20T00:00:00.000Z',
  resolvedAt: null,
  targetType: 'post',
  targetId: 5,
  reportedStudent: '대상자닉',
  reportedStudentId: 77,
  targetTitle: '신고된 글',
  targetBody: '광고 본문',
  targetExists: true,
  targetPostId: 5,
  ...over,
});

const summary = (over = {}) => ({
  id: 77,
  nickname: '대상자닉',
  department: '컴퓨터·소프트웨어공학과',
  admissionYear: 2022,
  joinedAt: '2026-03-02T00:00:00.000Z',
  postCount: 3,
  applicationCount: 2,
  reportsReceived: { pending: 1, resolved: 2, total: 3 },
  sanctions: [
    { id: 1, scope: 'full', reason: '유효 사유', startsAt: '2026-09-01T00:00:00.000Z', endsAt: null, liftedAt: null, state: 'active' },
    { id: 2, scope: 'post_apply', reason: '과거 사유', startsAt: '2026-05-01T00:00:00.000Z', endsAt: '2026-05-08T00:00:00.000Z', liftedAt: null, state: 'expired' },
  ],
  ...over,
});

const composition = () => ({
  minGroupSize: 5,
  noDepartment: 3,
  department: {
    members: { rows: [{ name: '경영학부', count: 20 }, { name: '간호학과', count: 7 }], other: { groups: 2, count: 3 }, total: 30 },
    visitors7d: { rows: [{ name: '경영학부', count: 8 }], other: null, total: 8 },
  },
  cohort: {
    members: { rows: [{ name: 2022, count: 18 }, { name: 2021, count: 9 }], other: { groups: 1, count: 3 }, total: 30 },
    visitors7d: { rows: [{ name: 2022, count: 6 }], other: null, total: 6 },
  },
});

// 최근 14일 방문자(오래된 순). 방문 기록은 since부터 있다.
const last14d = (since = '2026-09-29') => ({
  since,
  daily: Array.from({ length: 14 }, (_, i) => ({ at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10), visitors: i })),
});

const stats = (over = {}) => ({
  totalStudents: 12,
  activeSessions: 1,
  pending: { reports: 0, inquiries: 0, posts: 0 },
  last24h: { signups: 2, chatQuestions: 45, chatNotFound: 6, activeStudents: 9 },
  previous24h: { signups: 1, chatQuestions: 30, chatNotFound: 2 },
  last7d: { visitors: 30, previousVisitors: 24 },
  last14d: last14d(),
  weeklyReturn: { previous: 10, returned: 4 },
  ...over,
});

// 추이 응답. 마지막 점이 현재(진행 중)이고 2026-10-12(월)다. over의 키는 "마지막에서 몇 번째 전"(0 = 마지막)이다.
const TREND_COUNT = { '24h': 24, '7d': 7, '30d': 30, '1y': 365, all: 20 };
const trend = (range = '30d', over = {}) => {
  const hour = range === '24h';
  const count = TREND_COUNT[range];
  return {
    range,
    unit: hour ? 'hour' : 'day',
    generatedAt: '2026-10-12T05:30:00.000Z',
    points: Array.from({ length: count }, (_, i) => {
      const back = count - 1 - i;
      return {
        // 시간 단위는 로컬 시각 기준으로 만든다(라벨이 로컬 시로 나오므로 테스트 환경 시간대와 무관)
        at: hour ? new Date(2026, 9, 12, 5 - back).toISOString() : new Date(Date.UTC(2026, 9, 12 - back)).toISOString().slice(0, 10),
        signups: 0,
        chatQuestions: 0,
        chatNotFound: 0,
        visitors: hour ? null : 0,
        ...(over[back] || {}),
      };
    }),
    previous: null,
    uniqueVisitors: hour ? null : 0,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  api.getAdminStats.mockResolvedValue(stats());
  api.getAiLabelComparison.mockResolvedValue({
    post: { total: 0, actionMatched: 0, resultMatched: 0 },
    report: { total: 0, actionMatched: 0, resultMatched: 0 },
    inquiry: { total: 0, actionMatched: 0, resultMatched: 0 },
  });
  api.getAdminPending.mockResolvedValue({ reports: 0, inquiries: 0, posts: 0, total: 0 });
  api.getAdminStatsTrend.mockImplementation(async (range) => trend(range));
  resetAdminTrendCache();
  api.getAdminReports.mockResolvedValue([]);
  api.getAdminInquiries.mockResolvedValue([]);
  api.getAdminSanctions.mockResolvedValue([]);
  api.getAdminCommunityPosts.mockResolvedValue([]);
  api.getAdminStatsComposition.mockResolvedValue(composition());
  api.getAdminFeatureUsage.mockResolvedValue({ range: '7d', from: '2026-10-06', to: '2026-10-12', firstDate: null, events: [] });
  api.getReportedStudentSummary.mockResolvedValue(summary());
});

describe('새로고침 시 하위 화면 유지', () => {
  it('저장된 하위 화면(문의함)이 있으면 첫 화면이 아니라 그 화면에서 시작한다', async () => {
    sessionStorage.setItem('wku_cache_admin_view', '"inquiries"');
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('문의함', { selector: '.screen-title' })).toBeInTheDocument();
  });

  it('값이 없거나 이상하면 첫 화면으로 시작한다', async () => {
    sessionStorage.setItem('wku_cache_admin_view', '"hacked"');
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('관리자', { selector: '.screen-title' })).toBeInTheDocument();
  });

  it('상세(신고 보기)에 있다가 새로고침하면 무엇을 열었는지 남지 않아 그 목록으로 돌아간다', async () => {
    sessionStorage.setItem('wku_cache_admin_view', '"report"');
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('신고함', { selector: '.screen-title' })).toBeInTheDocument();
  });

  it('하위 화면 이동은 저장되고, 관리자 화면을 떠나면(언마운트) 지워져 다음엔 첫 화면부터 시작한다', async () => {
    const { unmount } = render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '신고함' }));
    expect(sessionStorage.getItem('wku_cache_admin_view')).toBe('"reports"');
    unmount();
    expect(sessionStorage.getItem('wku_cache_admin_view')).toBeNull();
  });
});

describe('첫 화면', () => {
  it('처리할 일이 없으면 한 줄로 알려 주고, 관리 메뉴로 들어갈 수 있다', async () => {
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('지금 처리할 일이 없어요')).toBeInTheDocument();
    for (const name of ['신고함', '문의함', '커뮤니티 관리', '제재 관리']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^통계/ })).toBeInTheDocument();
  });

  it('처리 대기가 있는 것만 건수와 함께 위에 보이고, 100건이 넘으면 99+로 줄인다', async () => {
    api.getAdminStats.mockResolvedValue(stats({ pending: { reports: 0, inquiries: 1, posts: 120 } }));
    render(<Admin {...baseProps} />);
    const inquiry = await screen.findByRole('button', { name: '문의함, 처리 대기 1건' });
    expect(inquiry.querySelector('.admin-count').textContent).toBe('1');
    expect(screen.getByRole('button', { name: '커뮤니티 승인 대기, 처리 대기 120건' }).querySelector('.admin-count').textContent).toBe('99+');
    expect(screen.queryByRole('button', { name: /신고함, 처리 대기/ })).toBeNull();
    expect(screen.queryByText('지금 처리할 일이 없어요')).toBeNull();
  });

  it('이용 현황: 최근 7일 방문자와 지난주 비교, 작은 칸(접속 중·가입자·다시 온 비율), 14일 막대', async () => {
    const { container } = render(<Admin {...baseProps} />);
    expect(await screen.findByText('지난주보다 6명 많아요')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument(); // 전체 가입자
    expect(screen.getByText('40%')).toBeInTheDocument(); // 지난주 10명 중 4명
    expect(screen.getByText('지난주 10명 중 4명')).toBeInTheDocument();
    expect(container.querySelectorAll('.admin-spark i')).toHaveLength(14);
  });

  it('방문 기록이 지난주를 다 덮지 못하면(기록 시작이 13일 전보다 늦으면) 지난주 비교를 보여주지 않는다', async () => {
    api.getAdminStats.mockResolvedValue(stats({ last14d: last14d('2026-10-08') }));
    render(<Admin {...baseProps} />);
    await screen.findByText('30');
    expect(screen.queryByText(/지난주보다/)).toBeNull();
  });

  it('지난주 방문 기록이 없으면 비율 대신 "—"와 안내를 보여준다', async () => {
    api.getAdminStats.mockResolvedValue(stats({ weeklyReturn: { previous: 0, returned: 0 } }));
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('방문 기록이 2주 쌓이면 보여요')).toBeInTheDocument();
  });

  it('최근 24시간은 어제와 비교하고, 답 못 찾은 질문은 질문 중 비율로 보여준다', async () => {
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('어제 30')).toBeInTheDocument(); // 챗봇 질문
    expect(screen.getByText('질문의 13%')).toBeInTheDocument(); // 6/45
    expect(screen.getByText('어제 1')).toBeInTheDocument(); // 신규 가입
  });

  it('통계를 한 번만 불러온다(신고·문의 목록 전체를 불러와 건수를 세지 않는다)', async () => {
    render(<Admin {...baseProps} />);
    await screen.findByText('어제 30');
    expect(api.getAdminStats).toHaveBeenCalledTimes(1);
    expect(api.getAdminReports).not.toHaveBeenCalled();
    expect(api.getAdminInquiries).not.toHaveBeenCalled();
  });
});

describe('신고함', () => {
  beforeEach(() => {
    sessionStorage.setItem('wku_cache_admin_view', '"reports"');
    api.getAdminReports.mockResolvedValue([report(), report({ id: 11, reporter: '두번째', reason: '전화번호가 있어요' })]);
    api.resolveAdminReport.mockResolvedValue({ resolvedCount: 2 });
    api.sanctionReport.mockResolvedValue({ resolvedCount: 2 });
  });

  const openDetail = async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: /신고된 글/ }));
    await screen.findByText('신고 보기', { selector: '.screen-title' });
  };

  it('같은 글의 신고는 한 줄로 묶어 "신고 2건"과 첫 사유 외 1건으로 보여준다', async () => {
    render(<Admin {...baseProps} />);
    const row = await screen.findByRole('button', { name: /신고된 글/ });
    expect(within(row).getByText('신고 2건')).toBeInTheDocument();
    expect(within(row).getByText(/외 1건/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /신고된 글/ })).toHaveLength(1);
  });

  it('묶는 규칙: 같은 종류·같은 대상끼리, targetId가 없는 예전 응답은 신고마다 따로', () => {
    const groups = groupReports([report(), report({ id: 11 }), report({ id: 12, targetType: 'application' }), report({ id: 13, targetId: undefined })]);
    expect(groups.map((g) => g.reports.map((r) => r.id))).toEqual([[10, 11], [12], [13]]);
  });

  it('상세에는 신고 당시 내용, 사유 전체, 대상자 정보(학과·학번·가입·글·신고·제재 이력)가 한 화면에 있고 이메일은 없다', async () => {
    await openDetail();
    expect(screen.getByText('신고 당시 내용')).toBeInTheDocument();
    expect(screen.getByText('광고 본문')).toBeInTheDocument();
    expect(screen.getByText('신고 사유 2건')).toBeInTheDocument();
    expect(screen.getByText('전화번호가 있어요')).toBeInTheDocument();
    expect(api.getReportedStudentSummary).toHaveBeenCalledWith(77);
    expect(await screen.findByText(/컴퓨터·소프트웨어공학과 · 2022학번/)).toBeInTheDocument();
    expect(screen.getByText('3개 · 2건')).toBeInTheDocument();
    expect(screen.getByText(/커뮤니티 이용 정지 · 적용 중/)).toBeInTheDocument();
    expect(screen.getByText(/글쓰기·신청 금지 · 기간 종료/)).toBeInTheDocument();
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it('"커뮤니티에서 글 보기"를 누르면 그 글을 연다', async () => {
    await openDetail();
    await userEvent.click(screen.getByRole('button', { name: '커뮤니티에서 글 보기' }));
    expect(baseProps.onOpenPost).toHaveBeenCalledWith(5);
  });

  it('대상자 조회가 실패해도 화면은 안 깨지고 안내가 나온다', async () => {
    api.getReportedStudentSummary.mockRejectedValue(Object.assign(new Error('not found'), { code: 'STUDENT_NOT_FOUND' }));
    await openDetail();
    expect(await screen.findByText(/대상자 정보를 불러오지 못했어요/)).toBeInTheDocument();
  });

  it('대상 정보가 없는 예전 신고는 제재하기를 누를 수 없다', async () => {
    api.getAdminReports.mockResolvedValue([report({ reportedStudent: null, reportedStudentId: null })]);
    await openDetail();
    expect(screen.getByText(/대상 정보가 없는 예전 신고예요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '제재하기' })).toBeDisabled();
  });

  it('조치 없이 처리: 기본 안내 그대로 보내면 그 문구가 가고, 묶음이 함께 처리된다고 알려 주며, 처리하면 목록으로 돌아간다', async () => {
    await openDetail();
    await userEvent.click(screen.getByRole('button', { name: '조치 없이 처리' }));
    const sheet = screen.getByRole('dialog', { name: '조치 없이 처리' });
    expect(within(sheet).getByText(/신고 2건이 함께 처리완료돼요/)).toBeInTheDocument();
    expect(within(sheet).getByRole('textbox', { name: /신고자에게 보낼 안내/ })).toHaveValue(RESOLUTION_DEFAULT);
    expect(within(sheet).getByText(/개인 정보나 제재 내용은 쓰지 마세요/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: '처리완료로 표시' }));
    await waitFor(() => expect(api.resolveAdminReport).toHaveBeenCalledWith(10, RESOLUTION_DEFAULT));
    expect(await screen.findByText('처리할 신고가 없어요.')).toBeInTheDocument();
    expect(screen.getByText('신고함', { selector: '.screen-title' })).toBeInTheDocument();
  });

  it('조치 없이 처리: 안내를 비우면 null로 가고, 닫기·Esc를 누르면 서버 호출 없이 닫힌다', async () => {
    await openDetail();
    await userEvent.click(screen.getByRole('button', { name: '조치 없이 처리' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '조치 없이 처리' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.resolveAdminReport).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '조치 없이 처리' }));
    await userEvent.clear(screen.getByRole('textbox', { name: /신고자에게 보낼 안내/ }));
    await userEvent.click(screen.getByRole('button', { name: '처리완료로 표시' }));
    await waitFor(() => expect(api.resolveAdminReport).toHaveBeenCalledWith(10, null));
  });

  it('제재 사유의 기본값은 신고 사유가 아니라 중립 문구이고, 신고 사유는 사용자에게 가지 않는다고 알려 준다', async () => {
    await openDetail();
    await userEvent.click(screen.getByRole('button', { name: '제재하기' }));
    const sheet = within(screen.getByRole('dialog', { name: '대상자닉 제재하기' }));
    const reason = sheet.getByRole('textbox', { name: /제재 사유/ });
    expect(reason).toHaveValue(NEUTRAL);
    expect(reason.value).not.toContain('쓰레기');
    expect(sheet.getByText(/신고 사유는 제재받는 사용자에게 전달되지 않아요/)).toBeInTheDocument();
    expect(sheet.getByText(/함께 지워지고 되돌릴 수 없어요/)).toBeInTheDocument();
  });

  it('제재: 확정 버튼에 고른 범위·기간이 그대로 적히고, 그대로 보내면 중립 문구와 기본 안내가 간다', async () => {
    await openDetail();
    await userEvent.click(screen.getByRole('button', { name: '제재하기' }));
    await userEvent.click(screen.getByRole('button', { name: '7일 글쓰기·신청 금지' }));
    await waitFor(() => expect(api.sanctionReport).toHaveBeenCalledWith(10, { scope: 'post_apply', duration: '7d', reason: NEUTRAL, resolutionNote: RESOLUTION_DEFAULT }));
  });

  it('제재: 범위·기간·사유·안내를 바꾸면 그 값이 가고, 사유를 비우면 확정할 수 없다', async () => {
    await openDetail();
    await userEvent.click(screen.getByRole('button', { name: '제재하기' }));
    await userEvent.click(screen.getByRole('radio', { name: /커뮤니티 이용 정지/ }));
    await userEvent.click(screen.getByRole('radio', { name: '영구' }));
    const reason = screen.getByRole('textbox', { name: /제재 사유/ });
    await userEvent.clear(reason);
    expect(screen.getByRole('button', { name: '영구 커뮤니티 이용 정지' })).toBeDisabled();
    await userEvent.type(reason, '반복적인 광고성 글 게시');
    const note = screen.getByRole('textbox', { name: /신고자에게 보낼 안내/ });
    await userEvent.clear(note);
    await userEvent.type(note, '조치했어요.');
    await userEvent.click(screen.getByRole('button', { name: '영구 커뮤니티 이용 정지' }));
    await waitFor(() =>
      expect(api.sanctionReport).toHaveBeenCalledWith(10, { scope: 'full', duration: 'permanent', reason: '반복적인 광고성 글 게시', resolutionNote: '조치했어요.' })
    );
  });

  it('처리완료 탭에서는 처리 버튼 대신 신고자에게 보낸 안내를 보여준다', async () => {
    api.getAdminReports.mockImplementation(async (status) => (status === 'resolved' ? [report({ status: 'resolved', resolutionNote: '확인했어요.' })] : []));
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('tab', { name: '처리완료' }));
    await userEvent.click(await screen.findByRole('button', { name: /신고된 글/ }));
    expect(await screen.findByText('확인했어요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '제재하기' })).toBeNull();
  });
});

describe('문의함', () => {
  const inquiry = (over = {}) => ({
    id: 5, title: '버튼이 안 눌려요', content: '졸업요건 화면에서요', status: 'open',
    createdAt: '2026-10-01T00:00:00.000Z', resolvedAt: null, resolutionNote: null, student: '문의자닉',
    department: '경영학부', admissionYear: 2023, ...over,
  });

  beforeEach(() => {
    sessionStorage.setItem('wku_cache_admin_view', '"inquiries"');
    api.getAdminInquiries.mockResolvedValue([inquiry()]);
    api.resolveAdminInquiry.mockResolvedValue(null);
  });

  const openDetail = async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: /버튼이 안 눌려요/ }));
    await screen.findByText('문의 보기', { selector: '.screen-title' });
  };

  it('목록과 상세에 문의한 학생의 학과·학번이 같이 보인다', async () => {
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('문의자닉 · 경영학부 · 2023학번')).toBeInTheDocument();
  });

  it('답변을 적으면 "답변 보내고 처리완료"로 그 글이 가고, 목록으로 돌아간다', async () => {
    await openDetail();
    const note = screen.getByRole('textbox', { name: /학생에게 보낼 답변/ });
    expect(note).toHaveValue(''); // 신고와 달리 기본 문구는 없다
    expect(screen.getByRole('button', { name: '답변 없이 처리완료' })).toBeInTheDocument();
    await userEvent.type(note, '  수정해서 배포했어요.  ');
    await userEvent.click(screen.getByRole('button', { name: '답변 보내고 처리완료' }));
    await waitFor(() => expect(api.resolveAdminInquiry).toHaveBeenCalledWith(5, '수정해서 배포했어요.'));
    expect(await screen.findByText('답변을 기다리는 문의가 없어요.')).toBeInTheDocument();
  });

  it('답변을 비워 두면 null로 가서 답변 없이 처리완료된다', async () => {
    await openDetail();
    await userEvent.click(screen.getByRole('button', { name: '답변 없이 처리완료' }));
    await waitFor(() => expect(api.resolveAdminInquiry).toHaveBeenCalledWith(5, null));
  });

  it('뒤로를 누르면 서버 호출 없이 목록으로 돌아간다', async () => {
    await openDetail();
    await userEvent.click(screen.getByRole('button', { name: '뒤로' }));
    expect(await screen.findByText('문의함', { selector: '.screen-title' })).toBeInTheDocument();
    expect(api.resolveAdminInquiry).not.toHaveBeenCalled();
  });

  it('[AI 초안 만들기]는 초안을 답변 칸에 채우고, 욕설 문의면 반영한 조치를 알려준다', async () => {
    api.draftInquiryReply.mockResolvedValue({ draft: '확인해서 다시 알려 드릴게요.', action: '경고' });
    await openDetail();
    await userEvent.click(screen.getByRole('button', { name: 'AI 초안 만들기' }));
    expect(screen.getByRole('textbox', { name: /학생에게 보낼 답변/ })).toHaveValue('확인해서 다시 알려 드릴게요.');
    expect(api.draftInquiryReply).toHaveBeenCalledWith(5);
    expect(screen.getByText(/AI가 쓴 초안이에요/)).toHaveTextContent('"경고" 기준이에요');
    expect(screen.getByRole('button', { name: 'AI 초안 다시 만들기' })).toBeInTheDocument();
  });

  it('정지 이의 제기에는 초안 버튼이 없다', async () => {
    api.getAdminInquiries.mockResolvedValue([inquiry({ appealFor: { id: 9, scope: 'account', reason: '욕설', endsAt: null, liftedAt: null } })]);
    await openDetail();
    expect(screen.queryByRole('button', { name: 'AI 초안 만들기' })).not.toBeInTheDocument();
  });

  it('처리완료 탭에서는 보낸 답변을 보여주고, 답변이 없었으면 그렇게 표시한다', async () => {
    api.getAdminInquiries.mockImplementation(async (status) =>
      status === 'resolved' ? [inquiry({ id: 6, status: 'resolved', resolutionNote: '수정해서 배포했어요.' }), inquiry({ id: 7, title: '다른 문의', status: 'resolved' })] : []
    );
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('tab', { name: '처리완료' }));
    expect(await screen.findByText(/수정해서 배포했어요\./)).toBeInTheDocument();
    expect(screen.getByText(/답변 없이 처리완료/)).toBeInTheDocument();
  });
});

describe('커뮤니티 관리', () => {
  const post = (over = {}) => ({
    id: 3, title: '알고리즘 스터디', body: '같이 풀어요', category: 'study', capacity: 4, status: 'pending',
    createdAt: '2026-10-20T00:00:00.000Z', author: '글쓴이', rejectReason: null, recruitEndDate: '2026-10-31',
    targetDepartments: [{ id: 1, name: '컴퓨터·소프트웨어공학과' }], ...over,
  });

  beforeEach(() => {
    sessionStorage.setItem('wku_cache_admin_view', '"approval"');
    api.getAdminCommunityPosts.mockResolvedValue([post()]);
    api.approveAdminPost.mockResolvedValue(null);
    api.rejectAdminPost.mockResolvedValue(null);
    api.deleteAdminPost.mockResolvedValue(null);
  });

  it('제목이 메뉴 이름과 같고, 글마다 종류·인원·모집 학과·마감이 보이며 반려 사유 칸은 처음엔 없다', async () => {
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('커뮤니티 관리', { selector: '.screen-title' })).toBeInTheDocument();
    expect(await screen.findByText('컴퓨터·소프트웨어공학과')).toBeInTheDocument();
    expect(screen.getByText('4명')).toBeInTheDocument();
    expect(screen.getByText('2026.10.31')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('모집 학과가 없으면 "모든 학과", 마감이 없으면 "없음"', async () => {
    api.getAdminCommunityPosts.mockResolvedValue([post({ targetDepartments: [], recruitEndDate: null })]);
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('모든 학과')).toBeInTheDocument();
    expect(screen.getByText('없음')).toBeInTheDocument();
  });

  it('승인하면 목록에서 빠진다', async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '승인' }));
    await waitFor(() => expect(api.approveAdminPost).toHaveBeenCalledWith(3));
    expect(await screen.findByText('승인을 기다리는 글이 없어요.')).toBeInTheDocument();
  });

  it('반려를 누르면 사유 칸이 펼쳐지고, 적은 사유로 반려된다(취소하면 접힌다)', async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '반려' }));
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '반려' }));
    await userEvent.type(screen.getByRole('textbox', { name: /반려 사유/ }), '오픈카톡 링크 대신 신청 기능을 써주세요');
    await userEvent.click(screen.getByRole('button', { name: '반려하기' }));
    await waitFor(() => expect(api.rejectAdminPost).toHaveBeenCalledWith(3, '오픈카톡 링크 대신 신청 기능을 써주세요'));
  });

  it('삭제는 ⋯ 메뉴에 있고, 확인을 거친 뒤에만 지운다', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<Admin {...baseProps} />);
    expect(screen.queryByRole('menuitem', { name: '글 삭제' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: '더 보기' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '글 삭제' }));
    expect(api.deleteAdminPost).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '더 보기' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '글 삭제' }));
    await waitFor(() => expect(api.deleteAdminPost).toHaveBeenCalledWith(3));
    confirm.mockRestore();
  });
});

describe('제재 관리', () => {
  const sanction = (over = {}) => ({
    id: 8, student: '대상자닉', reason: '운영 정책 위반', scope: 'post_apply',
    startsAt: '2026-10-20T00:00:00.000Z', endsAt: '2099-10-27T00:00:00.000Z', liftedAt: null, reportId: 10, ...over,
  });

  beforeEach(() => {
    sessionStorage.setItem('wku_cache_admin_view', '"sanctions"');
    api.getAdminSanctions.mockImplementation(async (status) =>
      status === 'past' ? [sanction({ id: 9, liftedAt: '2026-10-21T00:00:00.000Z', scope: 'full' })] : [sanction()]
    );
    api.liftSanction.mockResolvedValue(null);
  });

  it('적용 중: 범위·남은 기간·신고에서 이어졌는지 보이고, 해제는 한 번 더 확인한다', async () => {
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('글쓰기·신청 금지')).toBeInTheDocument();
    expect(screen.getByText(/일 남음/)).toBeInTheDocument();
    expect(screen.getByText(/신고에서 이어짐/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '기간 전에 해제' }));
    expect(api.liftSanction).not.toHaveBeenCalled();
    expect(screen.getByText(/제재를 지금 해제할까요/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '해제' }));
    await waitFor(() => expect(api.liftSanction).toHaveBeenCalledWith(8));
    expect(await screen.findByText('지금 제재 중인 계정이 없어요.')).toBeInTheDocument();
  });

  it('지난 제재 탭은 해제·기간 종료된 제재를 보여주고 해제 버튼이 없다', async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('tab', { name: '지난 제재' }));
    await waitFor(() => expect(api.getAdminSanctions).toHaveBeenCalledWith('past'));
    expect(await screen.findByText('커뮤니티 이용 정지 · 해제됨')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '기간 전에 해제' })).toBeNull();
  });
});

describe('통계 · 기능 사용', () => {
  const usage = {
    range: '7d',
    from: '2026-10-06',
    to: '2026-10-12',
    firstDate: '2026-10-01',
    events: [
      { event: 'view.home', count: 120, devices: 70 },
      { event: 'home.menu.graduation', count: 30, devices: 14 },
      { event: 'tabbar.graduation', count: 10, devices: 7 },
      { event: 'career.recommend.turn_3', count: 8, devices: 8 },
      { event: 'career.recommend.turn_7', count: 2, devices: 2 },
      { event: 'career.recommend.confirm', count: 8, devices: 8 },
      { event: 'career.recommend.cancel', count: 2, devices: 2 },
      { event: 'home.edit', count: 1, devices: 1 },
    ],
  };

  const openFeatures = async () => {
    sessionStorage.setItem('wku_cache_admin_view', '"stats"');
    sessionStorage.setItem('wku_cache_admin_stats_tab', '"features"');
    api.getAdminFeatureUsage.mockResolvedValue(usage);
    render(<Admin {...baseProps} />);
    await screen.findByText('같은 기능, 어디서 더 누를까');
  };

  it('같은 기능을 홈 메뉴와 하단 바에서 몇 번 눌렀는지 비교한다', async () => {
    await openFeatures();
    expect(screen.getByRole('img', { name: '졸업요건 진단 홈 메뉴 30회, 하단 바 10회' })).toBeInTheDocument();
    expect(api.getAdminFeatureUsage).toHaveBeenCalledWith('7d');
  });

  it('진로 추천을 누른 대화 횟수 분포(6~9번은 한 칸)와 실제로 추천받은 비율을 보여준다', async () => {
    await openFeatures();
    expect(screen.getByRole('img', { name: /3번째 8회.*6~9번째 2회/ })).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('화면별로 묶어 많이 쓴 순서로, 사람이 읽는 이름과 하루 평균 기기 수(기간의 날 수로 나눔)를 보여준다', async () => {
    await openFeatures();
    const groups = [...document.querySelectorAll('.admin-group-head span')].map((e) => e.textContent);
    expect(groups.slice(0, 2)).toEqual(['화면 열림', '홈']);
    expect(screen.getByText('메뉴 · 졸업요건 진단')).toBeInTheDocument();
    expect(screen.getByText('홈 화면 편집')).toBeInTheDocument();
    expect(screen.getByText('하루 평균 10대')).toBeInTheDocument(); // view.home 70대 ÷ 7일
  });

  it('기간을 바꾸면 그 기간을 다시 묻고, 기록이 없으면 그렇게 알려 준다', async () => {
    await openFeatures();
    api.getAdminFeatureUsage.mockResolvedValue({ ...usage, range: '30d', events: [] });
    await userEvent.click(screen.getByRole('tab', { name: '30일' }));
    await waitFor(() => expect(api.getAdminFeatureUsage).toHaveBeenCalledWith('30d'));
    expect(await screen.findByText(/아직 기록이 없어요/)).toBeInTheDocument();
  });
});

describe('통계 · 학과·학번', () => {
  const openComposition = async () => {
    sessionStorage.setItem('wku_cache_admin_view', '"stats"');
    sessionStorage.setItem('wku_cache_admin_stats_tab', '"composition"');
    render(<Admin {...baseProps} />);
    await screen.findByText('경영학부');
  };

  it('학과별 가입자와 최근 7일 방문자를 한 줄에 같이 보여주고, 방문자가 5명 미만이면 숫자 대신 "5명 미만"', async () => {
    await openComposition();
    const row = screen.getByText('경영학부').closest('tr');
    expect(within(row).getByText('20명')).toBeInTheDocument();
    expect(within(row).getByText('8명')).toBeInTheDocument();
    expect(within(screen.getByText('간호학과').closest('tr')).getByText('5명 미만')).toBeInTheDocument();
    expect(screen.getByText('기타 (5명 미만 학과 2곳)')).toBeInTheDocument();
    expect(screen.getByText(/학과를 아직 고르지 않은 3명은 빠져 있어요/)).toBeInTheDocument();
  });

  it('학번별로 바꿔 볼 수 있다', async () => {
    await openComposition();
    await userEvent.click(screen.getByRole('tab', { name: '학번별' }));
    expect(screen.getByText('2022학번')).toBeInTheDocument();
    expect(within(screen.getByText('2021학번').closest('tr')).getByText('5명 미만')).toBeInTheDocument();
  });
});

describe('통계 · 추이', () => {
  // 첫 화면의 이용 현황(최근 7일 방문자)과 최근 24시간 줄을 누르면 통계의 추이 탭으로 간다.
  const openTrend = async (label) => {
    const name = label === '최근 7일 방문자' ? '최근 7일 방문자 추이 보기' : new RegExp(`^${label} .*추이 보기$`);
    await userEvent.click(await screen.findByRole('button', { name }));
  };
  const withData = (over30 = {}, extra = {}) =>
    api.getAdminStatsTrend.mockImplementation(async (range) => trend(range, range === '30d' ? over30 : extra[range] || {}));

  it('신규 가입·챗봇 질문·근거 못 찾은 답변 칸은 누르면 추이 화면으로 가고, 그 지표와 30일이 선택돼 있다', async () => {
    withData({ 2: { chatQuestions: 7 }, 0: { chatQuestions: 3 } });
    render(<Admin {...baseProps} />);
    await openTrend('최근 24시간 챗봇 질문');
    expect(await screen.findByText('통계', { selector: '.screen-title' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '챗봇 질문' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '30일' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('30일 챗봇 질문')).toBeInTheDocument();
    expect(api.getAdminStatsTrend).toHaveBeenCalledWith('30d');
    expect(screen.getByText('10', { selector: '.admin-trend-total' })).toBeInTheDocument();
    expect(screen.getByText('가장 많았던 날 2026.10.10 (토) · 7건')).toBeInTheDocument();
    expect(sessionStorage.getItem('wku_cache_admin_view')).toBe('"stats"');
    expect(sessionStorage.getItem('wku_cache_admin_stats_tab')).toBe('"trend"');
  });

  it('전체 가입자·현재 접속자·다시 온 비율 칸은 그래프로 이어지지 않는다', async () => {
    render(<Admin {...baseProps} />);
    await screen.findByRole('button', { name: /^최근 24시간 신규 가입 .*추이 보기$/ });
    expect(screen.queryByRole('button', { name: /전체 가입자/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /현재 접속자/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /다시 온 비율/ })).toBeNull();
  });

  it('방문자 칸은 7일 방문자 추이로 가고, 합계는 날마다 더한 값이 아니라 기간 중 한 번 이상 온 사람 수다', async () => {
    api.getAdminStatsTrend.mockImplementation(async (range) => ({ ...trend(range, range === '7d' ? { 0: { visitors: 4 }, 1: { visitors: 3 } } : {}), uniqueVisitors: range === '7d' ? 5 : 0 }));
    render(<Admin {...baseProps} />);
    await openTrend('최근 7일 방문자');
    expect(await screen.findByText('7일 방문자')).toBeInTheDocument();
    expect(api.getAdminStatsTrend).toHaveBeenCalledWith('7d');
    expect(screen.getByRole('tab', { name: '7일' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('5', { selector: '.admin-trend-total' })).toBeInTheDocument();
    expect(screen.getByText(/한 번 이상 온 사람 수라 막대를 더한 값과 달라요/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: '24시간' }));
    expect(await screen.findByText('방문자는 하루 단위로만 세요. 7일 이상 기간을 골라주세요.')).toBeInTheDocument();
  });

  it('지난주 방문 기록이 없으면 비율 대신 "—"와 안내를 보여준다', async () => {
    api.getAdminStats.mockResolvedValue(stats({ weeklyReturn: { previous: 0, returned: 0 } }));
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('방문 기록이 2주 쌓이면 보여요')).toBeInTheDocument();
  });

  it('뒤로가기는 홈이 아니라 직전 화면인 관리자 대시보드로 돌아간다', async () => {
    render(<Admin {...baseProps} />);
    await openTrend('최근 24시간 신규 가입');
    await userEvent.click(await screen.findByRole('button', { name: '뒤로' }));
    expect(await screen.findByText('관리자', { selector: '.screen-title' })).toBeInTheDocument();
    expect(baseProps.onGoHome).not.toHaveBeenCalled();
  });

  it('지표 탭을 바꾸면 그 지표의 합계로 바뀌고, 막대를 가리키면 그 날의 값이 보인다', async () => {
    withData({ 1: { signups: 2, chatNotFound: 5 }, 0: { signups: 1 } });
    render(<Admin {...baseProps} />);
    await openTrend('최근 24시간 신규 가입');
    await screen.findByText('30일 신규 가입');
    expect(screen.getByText('3', { selector: '.admin-trend-total' })).toBeInTheDocument();

    await userEvent.hover(screen.getByRole('img', { name: '2026.10.11 (일) 2명' }));
    expect(screen.getByText('2026.10.11 (일) · 2명')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: '답 못 찾은 질문' }));
    expect(await screen.findByText('30일 답 못 찾은 질문')).toBeInTheDocument();
    expect(screen.getByText('5', { selector: '.admin-trend-total' })).toBeInTheDocument();
  });

  it('기간 탭: 24시간은 1시간 단위, 1년은 선 그래프로 바뀌고 서버에 그 기간을 요청한다', async () => {
    withData({}, { '24h': { 3: { signups: 4 } }, '1y': { 0: { signups: 6 }, 1: { signups: 2 } } });
    render(<Admin {...baseProps} />);
    await openTrend('최근 24시간 신규 가입');
    await screen.findByText('30일 신규 가입');

    await userEvent.click(screen.getByRole('tab', { name: '24시간' }));
    expect(await screen.findByText('24시간 신규 가입')).toBeInTheDocument();
    expect(api.getAdminStatsTrend).toHaveBeenCalledWith('24h');
    expect(screen.getByText(/가장 많았던 시간 2시~3시 · 4명/)).toBeInTheDocument();
    expect(screen.getAllByRole('img').filter((e) => e.tagName.toLowerCase() === 'g')).toHaveLength(24);

    await userEvent.click(screen.getByRole('tab', { name: '1년' }));
    expect(await screen.findByText('1년 신규 가입')).toBeInTheDocument();
    expect(api.getAdminStatsTrend).toHaveBeenCalledWith('1y');
    expect(screen.getByText('8', { selector: '.admin-trend-total' })).toBeInTheDocument();
    const chart = screen.getByRole('img', { name: '1년 신규 가입 일별 그래프' });
    expect(chart.tagName.toLowerCase()).toBe('svg'); // 365점은 선 그래프 하나(막대 365개가 아님)
    expect(chart.querySelectorAll('.trend-chart-line')).toHaveLength(1);
    expect(chart.querySelectorAll('.trend-chart-col')).toHaveLength(0);
  });

  it('선 그래프는 포커스하면 마지막 날을 잡고 ←/→/Home/End로 날을 옮긴다', async () => {
    withData({}, { '1y': { 0: { signups: 6 }, 1: { signups: 2 } } });
    render(<Admin {...baseProps} />);
    await openTrend('최근 24시간 신규 가입');
    await userEvent.click(await screen.findByRole('tab', { name: '1년' }));
    const chart = await screen.findByRole('img', { name: '1년 신규 가입 일별 그래프' });

    fireEvent.focus(chart);
    expect(screen.getByText('2026.10.12 (월) (오늘) · 6명')).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(screen.getByText('2026.10.11 (일) · 2명')).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(screen.getByText('2025.10.13 (월) · 0명')).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: 'ArrowLeft' }); // 처음에서 더 못 간다
    expect(screen.getByText('2025.10.13 (월) · 0명')).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: 'End' });
    expect(screen.getByText('2026.10.12 (월) (오늘) · 6명')).toBeInTheDocument();
    fireEvent.blur(chart);
    expect(screen.getByText(/가장 많았던 날 2026.10.12 \(월\) \(오늘\) · 6명/)).toBeInTheDocument();
  });

  it('키보드로 막대에 포커스를 옮겨도 그 날의 값이 보이고, 벗어나면 요약으로 돌아간다', async () => {
    withData({ 4: { chatQuestions: 9 }, 3: { chatQuestions: 2 } });
    render(<Admin {...baseProps} />);
    await openTrend('최근 24시간 챗봇 질문');
    const bar = await screen.findByRole('img', { name: '2026.10.09 (금) 2건' });
    fireEvent.focus(bar);
    expect(screen.getByText('2026.10.09 (금) · 2건')).toBeInTheDocument();
    fireEvent.blur(bar);
    expect(screen.getByText(/가장 많았던 날 2026.10.08 \(목\) · 9건/)).toBeInTheDocument();
  });

  it('기록이 하나도 없으면 그렇게 알려 준다', async () => {
    render(<Admin {...baseProps} />);
    await openTrend('최근 24시간 챗봇 질문');
    expect(await screen.findByText('이 기간에 기록된 건이 없어요.')).toBeInTheDocument();
  });

  it('표 보기에 날짜가 최신 순으로 나오고, 탈퇴 계정 기록이 빠질 수 있다는 안내가 있다', async () => {
    withData({ 0: { signups: 4 } });
    render(<Admin {...baseProps} />);
    await openTrend('최근 24시간 신규 가입');
    await screen.findByText('30일 신규 가입');
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(31); // 머리글 + 30일
    expect(within(rows[1]).getByText('2026.10.12 (월) (오늘)')).toBeInTheDocument();
    expect(within(rows[1]).getByText('4명')).toBeInTheDocument();
    expect(screen.getByText(/탈퇴한 계정의 가입·챗봇 기록은 계정과 함께 지워져/)).toBeInTheDocument();
  });

  it('한 번 본 기간은 다시 열 때 불러오는 동안에도 직전 그래프가 바로 보인다(기간별로 따로 기억)', async () => {
    withData({ 0: { signups: 6 } });
    render(<Admin {...baseProps} />);
    await openTrend('최근 24시간 신규 가입');
    await screen.findByText('30일 신규 가입');
    await userEvent.click(screen.getByRole('button', { name: '뒤로' }));

    api.getAdminStatsTrend.mockReturnValue(new Promise(() => {})); // 응답이 안 오는 상태
    await openTrend('최근 24시간 신규 가입');
    expect(screen.getByText('6', { selector: '.admin-trend-total' })).toBeInTheDocument();
    expect(screen.queryByLabelText('불러오는 중')).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: '1년' })); // 안 본 기간은 자리표시
    expect(screen.getByLabelText('불러오는 중')).toBeInTheDocument();
  });

  it('처음 보는 기간은 불러오는 동안 자리표시가 보이고, 실패하면 오류 문구가 나온다', async () => {
    api.getAdminStatsTrend.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<Admin {...baseProps} />);
    await openTrend('최근 24시간 신규 가입');
    expect(screen.getByLabelText('불러오는 중')).toBeInTheDocument();
    unmount();

    sessionStorage.clear();
    api.getAdminStatsTrend.mockRejectedValue(new Error('x'));
    render(<Admin {...baseProps} />);
    await openTrend('최근 24시간 신규 가입');
    expect(await screen.findByText(/추이를 불러오지 못했어요/)).toBeInTheDocument();
  });

  it('새로고침해도(저장된 화면·지표·기간) 보던 추이 화면에 머문다', async () => {
    sessionStorage.setItem('wku_cache_admin_view', '"stats"');
    sessionStorage.setItem('wku_cache_admin_trend_metric', '"chatNotFound"');
    sessionStorage.setItem('wku_cache_admin_trend_range', '"1y"');
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('통계', { selector: '.screen-title' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '답 못 찾은 질문' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '1년' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(api.getAdminStatsTrend).toHaveBeenCalledWith('1y'));
  });
});

describe('통계 · 추이의 앞 기간 비교', () => {
  const withPrevious = (prevOver) =>
    api.getAdminStatsTrend.mockImplementation(async (range) => {
      const t = trend(range, { 0: { chatQuestions: 9, visitors: 4 }, 1: { chatQuestions: 3, visitors: 2 } });
      return { ...t, previous: { points: trend(range, prevOver).points } };
    });
  const openChat = async () => {
    sessionStorage.setItem('wku_cache_admin_view', '"stats"');
    sessionStorage.setItem('wku_cache_admin_trend_metric', '"chatQuestions"');
    const view = render(<Admin {...baseProps} />);
    await screen.findByText('30일 챗봇 질문');
    return view;
  };

  it('바로 앞 30일보다 늘었는지 줄었는지 알려 주고, 앞 기간을 점선으로 겹친다', async () => {
    withPrevious({ 3: { chatQuestions: 5 } });
    const { container } = await openChat();
    expect(screen.getByText('그 전 30일보다 7건 많아요')).toBeInTheDocument();
    expect(container.querySelector('.trend-chart-prev')).not.toBeNull();
  });

  it('방문자는 하루 평균으로 비교한다(합계가 한 번 이상 온 사람 수라서)', async () => {
    withPrevious({ 3: { visitors: 3 } });
    await openChat();
    await userEvent.click(screen.getByRole('tab', { name: '방문자' }));
    expect(await screen.findByText('하루 평균 0.2명 · 그 전 30일 0.1명')).toBeInTheDocument();
  });

  it('앞 기간에 기록이 하나도 없으면(기록을 쌓기 전) 비교도 점선도 없다', async () => {
    withPrevious({});
    const { container } = await openChat();
    expect(screen.queryByText(/그 전 30일/)).toBeNull();
    expect(container.querySelector('.trend-chart-prev')).toBeNull();
  });
});
