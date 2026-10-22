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
  getAdminStatsTrend: vi.fn(),
  getAdminStatsComposition: vi.fn(),
  getReportedStudentSummary: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import Admin from './Admin.jsx';
import { resetAdminTrendCache } from '../components/AdminTrendView.jsx';

/**
 * client/src/pages/Admin.test.jsx
 * 관리자 화면(PR2): 새로고침 시 하위 화면 유지(항목 3), 신고 대상자 요약(항목 6), 제재 사유 기본값(항목 7).
 * API는 mock이라 실제 로그인/서버 없이 화면 동작만 확인한다.
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
  reportedStudent: '대상자닉',
  reportedStudentId: 77,
  targetTitle: '신고된 글',
  targetBody: '본문',
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

const stats = (over = {}) => ({
  totalStudents: 12,
  activeSessions: 1,
  pending: { reports: 0, inquiries: 0, posts: 0 },
  last24h: { signups: 2, chatQuestions: 45, chatNotFound: 6, activeStudents: 9 },
  last7d: { visitors: 30 },
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
    uniqueVisitors: hour ? null : 0,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  api.getAdminStats.mockResolvedValue(stats());
  api.getAdminStatsTrend.mockImplementation(async (range) => trend(range));
  resetAdminTrendCache();
  api.getAdminReports.mockResolvedValue([]);
  api.getAdminInquiries.mockResolvedValue([]);
  api.getAdminSanctions.mockResolvedValue([]);
  api.getAdminCommunityPosts.mockResolvedValue([]);
  api.getAdminStatsComposition.mockResolvedValue(composition());
});

describe('새로고침 시 하위 화면 유지', () => {
  it('저장된 하위 화면(문의함)이 있으면 대시보드가 아니라 그 화면에서 시작한다', async () => {
    sessionStorage.setItem('wku_cache_admin_view', '"inquiries"');
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('문의함', { selector: '.screen-title' })).toBeInTheDocument();
  });

  it('값이 없거나 이상하면 대시보드로 시작한다', async () => {
    sessionStorage.setItem('wku_cache_admin_view', '"hacked"');
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('관리자', { selector: '.screen-title' })).toBeInTheDocument();
  });

  it('하위 화면 이동은 저장되고, 관리자 화면을 떠나면(언마운트) 지워져 다음엔 대시보드부터 시작한다', async () => {
    const { unmount } = render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: /신고함/ }));
    expect(sessionStorage.getItem('wku_cache_admin_view')).toBe('"reports"');
    unmount();
    expect(sessionStorage.getItem('wku_cache_admin_view')).toBeNull();
  });
});

describe('대시보드 현황과 처리 대기 뱃지', () => {
  it('현황에는 운영 지표를 보여주고 "미처리 신고/문의" 칸은 없다', async () => {
    render(<Admin {...baseProps} />);
    await waitFor(() => expect(screen.getByText('45')).toBeInTheDocument());
    for (const label of ['전체 가입자', '현재 접속자', '최근 24시간 방문자', '최근 7일 방문자', '지난주 방문자 중 다시 온 비율', '최근 24시간 신규 가입', '최근 24시간 챗봇 질문', '최근 24시간 답 못 찾은 질문']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('12')).toBeInTheDocument(); // 전체 가입자
    expect(screen.getByText('6')).toBeInTheDocument(); // 답 못 찾은 질문
    expect(screen.getByText('40%')).toBeInTheDocument(); // 지난주 10명 중 4명
    expect(screen.getByText('지난주 10명 중 4명')).toBeInTheDocument();
    expect(screen.queryByText('미처리 신고')).toBeNull();
    expect(screen.queryByText('미처리 문의')).toBeNull();
  });

  it('처리 대기가 있는 타일에만 건수 뱃지를 달고, 0건이면 뱃지가 없다', async () => {
    api.getAdminStats.mockResolvedValue(stats({ pending: { reports: 0, inquiries: 1, posts: 120 } }));
    render(<Admin {...baseProps} />);
    const inquiryTile = await screen.findByRole('button', { name: '문의함, 처리 대기 1건' });
    expect(inquiryTile.querySelector('.admin-tile-badge').textContent).toBe('1');
    expect(screen.getByRole('button', { name: '커뮤니티 관리, 처리 대기 120건' }).querySelector('.admin-tile-badge').textContent).toBe('99+');
    const reportTile = screen.getByRole('button', { name: '신고함' });
    expect(reportTile.querySelector('.admin-tile-badge')).toBeNull();
    expect(screen.getByRole('button', { name: '제재 관리' }).querySelector('.admin-tile-badge')).toBeNull();
  });

  it('통계를 한 번만 불러온다(신고·문의 목록 전체를 불러와 건수를 세지 않는다)', async () => {
    render(<Admin {...baseProps} />);
    await waitFor(() => expect(screen.getByText('45')).toBeInTheDocument());
    expect(api.getAdminStats).toHaveBeenCalledTimes(1);
    expect(api.getAdminReports).not.toHaveBeenCalled();
    expect(api.getAdminInquiries).not.toHaveBeenCalled();
  });
});

describe('신고 대상자 요약 (항목 6)', () => {
  beforeEach(() => {
    sessionStorage.setItem('wku_cache_admin_view', '"reports"');
    api.getAdminReports.mockResolvedValue([report()]);
  });

  it('신고 대상자 이름을 누르면 학과·입학년도·가입일·글/신청 수·신고 접수 횟수·제재 이력이 보이고, 글 이동은 일어나지 않는다', async () => {
    api.getReportedStudentSummary.mockResolvedValue(summary());
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '대상자닉' }));

    expect(api.getReportedStudentSummary).toHaveBeenCalledWith(77);
    expect(await screen.findByText('신고 대상자 정보')).toBeInTheDocument();
    expect(screen.getByText(/컴퓨터·소프트웨어공학과/)).toBeInTheDocument();
    expect(screen.getByText(/2022학년도 입학/)).toBeInTheDocument();
    expect(screen.getByText(/작성한 글 3개 · 낸 신청 2건/)).toBeInTheDocument();
    expect(screen.getByText(/총 3건 \(대기 1건 · 처리완료\s*2건\)/)).toBeInTheDocument();
    expect(screen.getByText('제재 이력 (2건)')).toBeInTheDocument();
    expect(screen.getByText(/유효 사유/)).toBeInTheDocument();
    expect(screen.getByText('적용 중')).toBeInTheDocument();
    expect(screen.getByText('기간 종료')).toBeInTheDocument();
    expect(baseProps.onOpenPost).not.toHaveBeenCalled();
  });

  it('요약 화면에는 이메일 같은 필드를 그릴 자리가 없고, 닫기를 누르면 닫힌다', async () => {
    api.getReportedStudentSummary.mockResolvedValue(summary());
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '대상자닉' }));
    const modal = (await screen.findByText('신고 대상자 정보')).closest('.career-confirm-modal');
    expect(within(modal).queryByText(/@/)).toBeNull();
    await userEvent.click(within(modal).getByRole('button', { name: '닫기' }));
    expect(screen.queryByText('신고 대상자 정보')).toBeNull();
  });

  it('제재 이력이 없으면 안내 문구, 탈퇴 등으로 조회가 실패하면 에러 안내(화면은 안 깨짐)', async () => {
    api.getReportedStudentSummary.mockResolvedValueOnce(summary({ sanctions: [] }));
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '대상자닉' }));
    expect(await screen.findByText('제재 이력이 없어요.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '닫기' }));

    api.getReportedStudentSummary.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'STUDENT_NOT_FOUND' }));
    await userEvent.click(screen.getByRole('button', { name: '대상자닉' }));
    expect(await screen.findByText(/대상자 정보를 불러오지 못했어요/)).toBeInTheDocument();
  });

  it('서버가 reportedStudentId를 아직 안 내려주는 배포 순서(또는 탈퇴한 대상자)에서는 이름만 보이고 눌러도 아무 일 없다', async () => {
    api.getAdminReports.mockResolvedValue([report({ reportedStudentId: undefined })]);
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('대상자닉')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '대상자닉' })).toBeNull();
  });
});

describe('제재 사유 기본값 (항목 7)', () => {
  beforeEach(() => {
    sessionStorage.setItem('wku_cache_admin_view', '"reports"');
    api.getAdminReports.mockResolvedValue([report()]);
    api.sanctionReport.mockResolvedValue(null);
  });

  async function openSanctionModal() {
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '제재' }));
    // 팝업에는 입력칸이 둘이다(제재 사유 = 제재받는 사용자에게 보임, 처리 안내 = 신고자에게 보임) — 제재 사유 쪽을 라벨로 고른다.
    return screen.getByRole('textbox', { name: /제재 사유/ });
  }

  it('제재 사유 입력란의 기본값은 신고 사유가 아니라 고정된 중립 문구다', async () => {
    const textarea = await openSanctionModal();
    expect(textarea).toHaveValue(NEUTRAL);
    expect(textarea.value).not.toContain('쓰레기');
    expect(textarea.value).not.toContain('010-1234-5678');
  });

  it('신고 사유는 팝업에서 "참고용"으로만 보이고 제재 사유 안내 문구가 함께 나온다', async () => {
    const textarea = await openSanctionModal();
    const modal = within(textarea.closest('.career-confirm-modal')); // 뒤의 신고 카드에도 같은 사유가 보이므로 팝업 안만 본다
    expect(modal.getByText(/신고 사유\(참고용\)/)).toBeInTheDocument();
    expect(modal.getByText(/이 사람은 쓰레기예요/)).toBeInTheDocument();
    expect(modal.getByText(/신고 사유는 제재받는 사용자에게 전달되지 않아요/)).toBeInTheDocument();
  });

  it('기본값 그대로 확정하면 서버로 중립 문구가 가고(신고 사유는 가지 않음), 관리자가 고쳐 쓰면 그 문구가 간다', async () => {
    await openSanctionModal();
    await userEvent.click(screen.getByRole('button', { name: '제재 확정' }));
    await waitFor(() => expect(api.sanctionReport).toHaveBeenCalledTimes(1));
    expect(api.sanctionReport).toHaveBeenLastCalledWith(10, { scope: 'post_apply', duration: '7d', reason: NEUTRAL, resolutionNote: RESOLUTION_DEFAULT });

    api.getAdminReports.mockResolvedValue([report({ id: 11 })]);
    // 다른 신고로 다시 열기: 목록을 다시 불러오도록 하위 화면을 한 번 오간다
    await userEvent.click(screen.getByRole('button', { name: '뒤로' }));
    await userEvent.click(await screen.findByRole('button', { name: /신고함/ }));
    await userEvent.click(await screen.findByRole('button', { name: '제재' }));
    const textarea = screen.getByRole('textbox', { name: /제재 사유/ });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, '반복적인 광고성 글 게시');
    await userEvent.click(screen.getByRole('button', { name: '제재 확정' }));
    await waitFor(() => expect(api.sanctionReport).toHaveBeenCalledTimes(2));
    expect(api.sanctionReport).toHaveBeenLastCalledWith(11, { scope: 'post_apply', duration: '7d', reason: '반복적인 광고성 글 게시', resolutionNote: RESOLUTION_DEFAULT });
  });
});

describe('현황 추이 그래프', () => {
  const openTrend = async (label) => {
    await userEvent.click(await screen.findByRole('button', { name: `${label} 추이 보기` }));
  };
  const withData = (over30 = {}, extra = {}) =>
    api.getAdminStatsTrend.mockImplementation(async (range) => trend(range, range === '30d' ? over30 : extra[range] || {}));

  it('신규 가입·챗봇 질문·근거 못 찾은 답변 칸은 누르면 추이 화면으로 가고, 그 지표와 30일이 선택돼 있다', async () => {
    withData({ 2: { chatQuestions: 7 }, 0: { chatQuestions: 3 } });
    render(<Admin {...baseProps} />);
    await openTrend('최근 24시간 챗봇 질문');
    expect(await screen.findByText('현황 추이', { selector: '.screen-title' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '챗봇 질문' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '30일' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('30일 챗봇 질문')).toBeInTheDocument();
    expect(api.getAdminStatsTrend).toHaveBeenCalledWith('30d');
    expect(screen.getByText('10', { selector: '.admin-trend-total' })).toBeInTheDocument();
    expect(screen.getByText('가장 많았던 날 2026.10.10 (토) · 7건')).toBeInTheDocument();
    expect(sessionStorage.getItem('wku_cache_admin_view')).toBe('"trend"');
  });

  it('전체 가입자·현재 접속자·다시 온 비율 칸은 그래프로 이어지지 않는다', async () => {
    render(<Admin {...baseProps} />);
    await screen.findByRole('button', { name: '최근 24시간 신규 가입 추이 보기' });
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
    sessionStorage.setItem('wku_cache_admin_view', '"trend"');
    sessionStorage.setItem('wku_cache_admin_trend_metric', '"chatNotFound"');
    sessionStorage.setItem('wku_cache_admin_trend_range', '"1y"');
    render(<Admin {...baseProps} />);
    expect(await screen.findByText('현황 추이', { selector: '.screen-title' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '답 못 찾은 질문' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '1년' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(api.getAdminStatsTrend).toHaveBeenCalledWith('1y'));
  });
});

describe('문의자에게 보낼 처리 답변', () => {
  const inquiry = (over = {}) => ({
    id: 5, title: '버튼이 안 눌려요', content: '졸업요건 화면에서요', status: 'open',
    createdAt: '2026-10-01T00:00:00.000Z', resolvedAt: null, resolutionNote: null, student: '문의자닉', ...over,
  });

  // 하위 탭("처리완료")과 카드의 처리 버튼("처리완료")이 이름이 같아서 클래스로 구분한다.
  const pickButton = (className) => screen.queryAllByRole('button', { name: '처리완료' }).find((b) => b.classList.contains(className));
  const resolveButton = () => waitFor(() => expect(pickButton('community-act-accept')).toBeTruthy()).then(() => pickButton('community-act-accept'));
  const resolvedTab = () => waitFor(() => expect(pickButton('admin-sub-tab')).toBeTruthy()).then(() => pickButton('admin-sub-tab'));

  beforeEach(() => {
    sessionStorage.setItem('wku_cache_admin_view', '"inquiries"');
    api.getAdminInquiries.mockResolvedValue([inquiry()]);
    api.resolveAdminInquiry.mockResolvedValue(null);
  });

  it('처리완료를 누르면 답변 팝업이 열리고, 답변을 적어 확정하면 그 글이 서버로 간다', async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await resolveButton());
    const note = screen.getByRole('textbox', { name: /문의자에게 보낼 답변/ });
    expect(note).toHaveValue(''); // 신고와 달리 기본 문구는 없다
    await userEvent.type(note, '  수정해서 배포했어요.  ');
    await userEvent.click(screen.getByRole('button', { name: '처리완료로 표시' }));
    await waitFor(() => expect(api.resolveAdminInquiry).toHaveBeenCalledWith(5, '수정해서 배포했어요.'));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /문의자에게 보낼 답변/ })).toBeNull());
  });

  it('답변을 비워 두면 null로 가서 답변 없이 처리완료된다', async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await resolveButton());
    await userEvent.click(screen.getByRole('button', { name: '처리완료로 표시' }));
    await waitFor(() => expect(api.resolveAdminInquiry).toHaveBeenCalledWith(5, null));
  });

  it('취소하면 서버 호출 없이 팝업만 닫힌다', async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await resolveButton());
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(api.resolveAdminInquiry).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: /문의자에게 보낼 답변/ })).toBeNull();
  });

  it('처리완료 탭에서는 보낸 답변을 보여주고, 답변이 없었으면 그렇게 표시한다', async () => {
    api.getAdminInquiries.mockResolvedValue([
      inquiry({ id: 6, status: 'resolved', resolutionNote: '수정해서 배포했어요.' }),
      inquiry({ id: 7, title: '다른 문의', status: 'resolved', resolutionNote: null }),
    ]);
    render(<Admin {...baseProps} />);
    await userEvent.click(await resolvedTab());
    expect(await screen.findByText(/수정해서 배포했어요\./)).toBeInTheDocument();
    expect(screen.getByText(/답변 없이 처리완료/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '처리완료' }).filter((b) => b.classList.contains('community-act-accept'))).toHaveLength(0); // 이미 처리된 문의에는 처리 버튼이 없다
  });
});

describe('신고자에게 보낼 처리 안내', () => {
  beforeEach(() => {
    sessionStorage.setItem('wku_cache_admin_view', '"reports"');
    api.getAdminReports.mockResolvedValue([report()]);
    api.resolveAdminReport.mockResolvedValue(null);
    api.sanctionReport.mockResolvedValue(null);
  });

  it('반려를 누르면 처리 안내 팝업이 열리고, 기본 문구 그대로 확정하면 그 문구가 서버로 간다', async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '반려' }));
    const note = screen.getByRole('textbox', { name: /처리 안내/ });
    expect(note).toHaveValue(RESOLUTION_DEFAULT);
    expect(screen.getByText(/개인 정보나 제재 내용은 쓰지 마세요/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '처리완료로 표시' }));
    await waitFor(() => expect(api.resolveAdminReport).toHaveBeenCalledWith(10, RESOLUTION_DEFAULT));
  });

  it('처리 안내를 고쳐 쓰거나 비우면 그대로(비우면 null) 서버로 간다', async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '반려' }));
    const note = screen.getByRole('textbox', { name: /처리 안내/ });
    await userEvent.clear(note);
    await userEvent.type(note, '확인했고 문제가 없어 종료했어요.');
    await userEvent.click(screen.getByRole('button', { name: '처리완료로 표시' }));
    await waitFor(() => expect(api.resolveAdminReport).toHaveBeenCalledWith(10, '확인했고 문제가 없어 종료했어요.'));

    api.getAdminReports.mockResolvedValue([report({ id: 12 })]);
    await userEvent.click(screen.getByRole('button', { name: '뒤로' }));
    await userEvent.click(await screen.findByRole('button', { name: /신고함/ }));
    await userEvent.click(await screen.findByRole('button', { name: '반려' }));
    await userEvent.clear(screen.getByRole('textbox', { name: /처리 안내/ }));
    await userEvent.click(screen.getByRole('button', { name: '처리완료로 표시' }));
    await waitFor(() => expect(api.resolveAdminReport).toHaveBeenLastCalledWith(12, null));
  });

  it('취소하면 서버 호출 없이 팝업만 닫힌다', async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '반려' }));
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(api.resolveAdminReport).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: /처리 안내/ })).toBeNull();
  });

  it('제재 팝업의 처리 안내를 고치면 제재 사유와 별개로 resolutionNote로 간다', async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '제재' }));
    const note = screen.getByRole('textbox', { name: /처리 안내/ });
    await userEvent.clear(note);
    await userEvent.type(note, '조치했어요.');
    await userEvent.click(screen.getByRole('button', { name: '제재 확정' }));
    await waitFor(() => expect(api.sanctionReport).toHaveBeenCalledWith(10, { scope: 'post_apply', duration: '7d', reason: NEUTRAL, resolutionNote: '조치했어요.' }));
  });
});

describe('학과·학번별 사용자', () => {
  it('학과별 가입자를 많은 순으로 보여주고, 5명 미만 학과는 이름 없이 기타로 묶어 보여준다', async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '학과·학번별 사용자' }));
    expect(await screen.findByText('학과·학번별 사용자', { selector: '.screen-title' })).toBeInTheDocument();
    expect(await screen.findByText('경영학부')).toBeInTheDocument();
    expect(screen.getByText('20명 · 67%')).toBeInTheDocument();
    expect(screen.getByText('기타 (5명 미만 학과 2곳)')).toBeInTheDocument();
    expect(screen.getByText(/학과를 아직 고르지 않은 3명은 빠져 있어요/)).toBeInTheDocument();
  });

  it('학번별·최근 7일 방문자로 바꿔 볼 수 있다', async () => {
    render(<Admin {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: '학과·학번별 사용자' }));
    await userEvent.click(await screen.findByRole('tab', { name: '학번별' }));
    expect(screen.getByText('2022학번')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '최근 7일 방문자' }));
    expect(screen.getByText('학번별 최근 7일 방문자')).toBeInTheDocument();
    expect(screen.getByText('6명 · 100%')).toBeInTheDocument();
  });
});
