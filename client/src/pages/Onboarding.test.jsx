import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getDepartments: vi.fn(),
  getTracks: vi.fn(),
  submitOnboarding: vi.fn(),
  updateProfile: vi.fn(),
  saveLeavePeriods: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import Onboarding from './Onboarding.jsx';

/**
 * client/src/pages/Onboarding.test.jsx
 * 학적정보 수정 화면의 "몇 학번이에요?" 단계가 실제로 그려지는지 확인한다. 이 단계는 개편 전 학과의 "이후 학과" 안내
 * (describeSuccessors)를 쓰는데, import가 빠져 이 화면에 들어가는 순간 ReferenceError로 앱 전체가 사라졌던 적이 있다
 * (학과 선택 트리 개편 #297 이후). 다른 테스트는 이 화면을 렌더하지 않아 못 잡았다.
 */

const FORMER_DEPT = {
  id: 4,
  name: '경영학부',
  minAdmissionYear: 2020,
  maxAdmissionYear: 2022,
  coreMinAdmissionYear: 2020,
  coreMaxAdmissionYear: 2022,
  successors: [{ name: '경영계열', effectiveYear: 2023, confirmed: false }],
  college: '경상대학',
  former: true,
  collegeOrder: 12,
};

// 편입생 테스트용 학과: 요건이 있는 학번 2017~2024.
const TRANSFER_DEPT = {
  id: 7,
  name: '국어국문학과',
  minAdmissionYear: 2017,
  maxAdmissionYear: 2024,
  coreMinAdmissionYear: 2017,
  coreMaxAdmissionYear: 2024,
  successors: [],
  college: '인문대학',
  former: false,
  collegeOrder: 1,
};

const transferUser = (over = {}) => ({
  id: 2,
  onboardingCompleted: true,
  departmentId: 7,
  trackId: null,
  enrollmentType: 'TRANSFER_ADMISSION',
  admissionYear: 2024,
  transferGrade: 3,
  leaveSemesters: 0,
  leavePeriods: [],
  ...over,
});

const USER = {
  id: 1,
  onboardingCompleted: true,
  departmentId: 4,
  trackId: null,
  enrollmentType: 'GENERAL',
  admissionYear: 2021,
  leaveSemesters: 0,
  leavePeriods: [],
};

// 요약 화면의 전체 저장 버튼(화면 맨 아래 마지막 '저장').
const saveButton = () => screen.getAllByRole('button', { name: '저장' }).at(-1);

beforeEach(() => {
  vi.clearAllMocks();
  api.getDepartments.mockResolvedValue([FORMER_DEPT, TRANSFER_DEPT]);
  api.updateProfile.mockResolvedValue({});
  api.saveLeavePeriods.mockResolvedValue({});
  api.getTracks.mockResolvedValue([]);
});

describe('학적정보 수정(Onboarding) 화면', () => {
  it('요약 화면이 기존 값을 보여준다', async () => {
    render(<Onboarding user={USER} onDone={() => {}} onSkip={() => {}} />);
    expect(await screen.findByText('경영학부')).toBeInTheDocument();
    expect(screen.getByText('2021학번')).toBeInTheDocument();
    expect(screen.getByText('일반 재학생')).toBeInTheDocument();
  });

  it('학번 항목을 눌러 "몇 학번이에요?" 단계로 가면 오류 없이 그려지고 이후 학과 안내가 보인다', async () => {
    render(<Onboarding user={USER} onDone={() => {}} onSkip={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /학번.*2021학번/ }));

    expect(await screen.findByRole('heading', { name: '몇 학번이에요?' })).toBeInTheDocument();
    expect(screen.getByText('이후 학과(추정): 경영계열')).toBeInTheDocument();
    // 개편 전 학과면 "소속을 옮기지 않았다면 이 학과" 안내(학적 같은 행정 용어는 쓰지 않는다)
    expect(screen.getByText(/소속을 옮기는 신청을 따로 하지 않았다면 이 학과를 고르면 돼요/)).toBeInTheDocument();
    expect(screen.queryByText(/학적/)).toBeNull();
    expect(screen.getByRole('option', { name: '2021학번' })).toBeInTheDocument();
  });
});

describe('편입생: 편입 연도·학년 입력(제14조③ — 학번 = 편입 연도 − 학년 + 1)', () => {
  it('편입 학년을 저장한 편입생: 요약에 "2026년 3학년 편입"과 적용 학번 2024학번이 보이고, 저장하면 학번·편입 학년이 그대로 간다', async () => {
    render(<Onboarding user={transferUser()} onDone={() => {}} onSkip={() => {}} />);
    expect(await screen.findByText('2026년 3학년 편입')).toBeInTheDocument();
    expect(screen.getByText('2024학번')).toBeInTheDocument();

    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ departmentId: 7, admissionYear: 2024, enrollmentType: 'TRANSFER_ADMISSION', transferGrade: 3 })
    );
  });

  it('옛 방식으로 입력한 편입생(편입 학년 없음): "편입 시점"이 선택 필요로 보이고 다시 입력하기 전에는 저장할 수 없다', async () => {
    render(<Onboarding user={transferUser({ transferGrade: null })} onDone={() => {}} onSkip={() => {}} />);
    const row = await screen.findByRole('button', { name: /편입 시점/ });
    expect(row).toHaveTextContent('선택 필요');
    expect(saveButton()).toBeDisabled();
  });

  it('편입 시점을 고르면 적용 학번을 계산해 보여 주고, 확인 후 저장하면 계산된 학번과 편입 학년이 간다', async () => {
    render(<Onboarding user={transferUser({ transferGrade: null, admissionYear: 2026 })} onDone={() => {}} onSkip={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /편입 시점/ }));
    expect(await screen.findByRole('heading', { name: '언제, 몇 학년으로 편입했어요?' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox'), '2026');
    await userEvent.click(screen.getByRole('button', { name: '3학년' }));
    expect(screen.getByText('적용 학번: 2024학번')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(await screen.findByText('2026년 3학년 편입')).toBeInTheDocument();
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ admissionYear: 2024, transferGrade: 3 }));
  });

  it('그 학번의 자료가 이 학과에 없는 조합(2018년 4학년 편입 → 2015학번)이면 안내를 보여 주고 확인할 수 없다', async () => {
    render(<Onboarding user={transferUser({ transferGrade: null })} onDone={() => {}} onSkip={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /편입 시점/ }));
    await userEvent.selectOptions(await screen.findByRole('combobox'), '2018');
    await userEvent.click(screen.getByRole('button', { name: '4학년' }));
    expect(screen.getByText(/2015학번 자료가 없어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인' })).toBeDisabled();
  });

  it('편입생이 아닌 계정은 편입 시점 항목이 없고, 저장할 때 편입 학년을 null로 보낸다', async () => {
    render(<Onboarding user={USER} onDone={() => {}} onSkip={() => {}} />);
    await screen.findByText('경영학부');
    expect(screen.queryByText('편입 시점')).not.toBeInTheDocument();
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ enrollmentType: 'GENERAL', transferGrade: null }));
  });
});

describe('휴학 기간(휴학 "수"가 아니라 시기를 받는다)', () => {
  it('휴학 질문에 답하지 않은 계정은 요약의 휴학이 "선택 필요"이고 저장할 수 없다', async () => {
    render(<Onboarding user={{ ...USER, leavePeriods: null }} onDone={() => {}} onSkip={() => {}} />);
    expect(await screen.findByRole('button', { name: /휴학.*선택 필요/ })).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('휴학 항목에서 "휴학한 적 없어요"를 고르고 저장하면 학적정보 다음에 빈 휴학 기간을 보낸다', async () => {
    render(<Onboarding user={{ ...USER, leavePeriods: null }} onDone={() => {}} onSkip={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /휴학.*선택 필요/ }));
    expect(await screen.findByRole('heading', { name: '휴학한 적이 있나요?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '휴학한 적 없어요' }));
    await userEvent.click(screen.getByRole('button', { name: '확인' }));

    expect(await screen.findByRole('button', { name: /휴학.*없음/ })).toBeInTheDocument();
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalled();
    expect(api.saveLeavePeriods).toHaveBeenCalledWith([]);
    expect(api.updateProfile.mock.invocationCallOrder[0]).toBeLessThan(api.saveLeavePeriods.mock.invocationCallOrder[0]);
  });

  it('저장된 휴학 기간을 요약에 보여 주고, 서버가 겹침으로 거부하면 이유를 알려 준다', async () => {
    api.saveLeavePeriods.mockRejectedValue(Object.assign(new Error('x'), { code: 'LEAVE_PERIODS_OVERLAP' }));
    render(<Onboarding user={{ ...USER, leavePeriods: [{ startYear: 2022, startSemester: 2, semesters: 4 }] }} onDone={() => {}} onSkip={() => {}} />);
    expect(await screen.findByText('2022학년도 2학기부터 4학기')).toBeInTheDocument();
    await userEvent.click(saveButton());
    expect(await screen.findByText('휴학 기간이 서로 겹쳐요.')).toBeInTheDocument();
  });
});


describe('학과 선택: 학과 검색에서 고르면 바로 다음 질문, "다음"은 화면 아래에 떠 있음', () => {
  const NEW_USER = { id: 9, onboardingCompleted: false };
  const searchAndPick = async (query, name) => {
    await userEvent.click(await screen.findByRole('button', { name: '학과 검색' }));
    await userEvent.type(screen.getByRole('searchbox', { name: '학과 검색' }), query);
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
  };

  it('"다음"은 떠 있는 버튼 영역에 있고, 검색 결과를 누르면 그 학과로 바로 다음 질문(입학 유형)으로 간다', async () => {
    const { container } = render(<Onboarding user={NEW_USER} onDone={() => {}} onSkip={() => {}} />);
    expect(await screen.findByRole('heading', { name: '어느 학과 소속이에요?' })).toBeInTheDocument();
    expect(container.querySelector('.onb-float-action')).toContainElement(screen.getByRole('button', { name: '다음' }));

    await searchAndPick('국어', '국어국문학과');
    expect(await screen.findByRole('heading', { name: '어떤 유형으로 재학 중이에요?' })).toBeInTheDocument();
    expect(api.getTracks).toHaveBeenCalledWith(7);
  });

  it('검색창에 입력하고 엔터를 누르면 맨 위 학과로 바로 다음 질문으로 간다', async () => {
    render(<Onboarding user={NEW_USER} onDone={() => {}} onSkip={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: '학과 검색' }));
    await userEvent.type(screen.getByRole('searchbox', { name: '학과 검색' }), '국어{enter}');
    expect(await screen.findByRole('heading', { name: '어떤 유형으로 재학 중이에요?' })).toBeInTheDocument();
    expect(api.getTracks).toHaveBeenCalledWith(7);
  });

  it('목록에서 학과를 고르고 엔터를 누르면 "다음"을 누른 것처럼 다음 질문으로 간다', async () => {
    render(<Onboarding user={NEW_USER} onDone={() => {}} onSkip={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /인문대학/ }));
    await userEvent.click(screen.getByRole('button', { name: /^국어국문학과/ }));
    expect(screen.getByRole('heading', { name: '어느 학과 소속이에요?' })).toBeInTheDocument(); // 클릭만으로는 넘어가지 않는다
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: '어떤 유형으로 재학 중이에요?' })).toBeInTheDocument();
  });

  it('세부전공이 있는 학과는 세부전공 목록을 받은 뒤 세부전공 질문으로 바로 간다', async () => {
    api.getTracks.mockResolvedValue([{ id: 31, name: '인공지능' }]);
    render(<Onboarding user={NEW_USER} onDone={() => {}} onSkip={() => {}} />);
    await searchAndPick('경영학부', '경영학부');
    expect(await screen.findByRole('heading', { name: '희망하는 세부전공을 선택하세요' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '인공지능' })).toBeInTheDocument();
  });
});

describe('학과 선택: 고르지 않고 "다음"을 누르면 그대로 넘어갈지 묻는다', () => {
  const NEW_USER = { id: 9, onboardingCompleted: false };
  const pressNextWithoutDepartment = async () => {
    expect(await screen.findByRole('heading', { name: '어느 학과 소속이에요?' })).toBeInTheDocument();
    const next = screen.getByRole('button', { name: '다음' });
    expect(next).toBeEnabled(); // 고르기 전에도 누를 수 있다
    await userEvent.click(next);
    return screen.getByRole('dialog', { name: '학과를 선택하지 않으셨어요' });
  };

  it('"학과 고르기"나 ESC는 창만 닫고 학과 질문에 머문다', async () => {
    const onSkip = vi.fn();
    render(<Onboarding user={NEW_USER} onDone={() => {}} onSkip={onSkip} />);
    await pressNextWithoutDepartment();
    await userEvent.click(screen.getByRole('button', { name: '학과 고르기' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await pressNextWithoutDepartment();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: '어느 학과 소속이에요?' })).toBeInTheDocument();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('"이대로 넘어가기"는 나중에 선택하기와 같다(뒤의 학적 질문 없이 나가고 아무것도 저장하지 않음)', async () => {
    const onSkip = vi.fn();
    render(<Onboarding user={NEW_USER} onDone={() => {}} onSkip={onSkip} />);
    await pressNextWithoutDepartment();
    await userEvent.click(screen.getByRole('button', { name: '이대로 넘어가기' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(api.submitOnboarding).not.toHaveBeenCalled();
  });

  it('"나중에 선택하기"는 질문 제목 줄에 있다', async () => {
    const onSkip = vi.fn();
    render(<Onboarding user={NEW_USER} onDone={() => {}} onSkip={onSkip} />);
    const title = await screen.findByRole('heading', { name: '어느 학과 소속이에요?' });
    const later = screen.getByRole('button', { name: '나중에 선택하기' });
    expect(later.nextElementSibling).toBe(title); // 제목 바로 앞에서 오른쪽으로 띄워(float) 같은 줄에 놓인다
    await userEvent.click(later);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

describe('약학과: 6년제(세부전공 없음)와 2+4년제를 고른다(#352)', () => {
  const PHARM_DEPT = {
    id: 9, name: '약학과', minAdmissionYear: 2017, maxAdmissionYear: 2026, coreMinAdmissionYear: 2017, coreMaxAdmissionYear: 2026,
    successors: [], college: '약학대학', former: false, collegeOrder: 20,
  };
  const pharmUser = (over = {}) => ({ ...USER, departmentId: 9, department: '약학과', admissionYear: 2023, ...over });

  beforeEach(() => {
    api.getDepartments.mockResolvedValue([FORMER_DEPT, TRANSFER_DEPT, PHARM_DEPT]);
    api.getTracks.mockResolvedValue([{ id: 51, name: '2+4년제' }]);
  });

  it('세부전공이 없는 약학과 계정은 요약에 "6년제 (세부전공 없음)"으로 보이고, 저장하면 세부전공을 null로 보낸다', async () => {
    render(<Onboarding user={pharmUser()} onDone={() => {}} onSkip={() => {}} />);
    expect(await screen.findByRole('button', { name: /세부전공.*6년제 \(세부전공 없음\)/ })).toBeInTheDocument();
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ departmentId: 9, trackId: null }));
  });

  it('세부전공 질문에 6년제와 2+4년제가 설명과 함께 나오고, 6년제를 고르면 세부전공 null로 저장한다', async () => {
    render(<Onboarding user={pharmUser({ trackId: 51 })} onDone={() => {}} onSkip={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /세부전공.*2\+4년제/ }));
    expect(await screen.findByText('2022학번부터 일반 입학한 학생')).toBeInTheDocument();
    expect(screen.getByText('편입생 (2+4년제 교육과정)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '어느 교육과정이에요?' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /6년제 \(세부전공 없음\)/ }));
    await userEvent.click(screen.getByRole('button', { name: '확인' }));
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ trackId: null }));
  });

  it('2022학번 이후 일반 입학인데 2+4년제를 골랐으면 확인 안내를 띄우되 저장은 막지 않는다', async () => {
    render(<Onboarding user={pharmUser({ trackId: 51 })} onDone={() => {}} onSkip={() => {}} />);
    expect(await screen.findByText(/편입생이 아니라면 세부전공을 다시 확인해 주세요/)).toBeInTheDocument();
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ trackId: 51 }));
  });

  it('2021학번 이전이면 2+4년제를 골라도 확인 안내가 없다', async () => {
    render(<Onboarding user={pharmUser({ trackId: 51, admissionYear: 2020 })} onDone={() => {}} onSkip={() => {}} />);
    await screen.findByRole('button', { name: /세부전공.*2\+4년제/ });
    expect(screen.queryByText(/편입생이 아니라면 세부전공을 다시 확인해 주세요/)).toBeNull();
  });
});

describe('교직과정 이수 여부·편입 인정학점(D-67)', () => {
  // 교직기본이수 요건이 있는 학과. 사범대학은 "이수하고 있어요"를 미리 고른다.
  const TEACHER_DEPT = {
    id: 9, name: '국어교육과', minAdmissionYear: 2017, maxAdmissionYear: null, coreMinAdmissionYear: 2017, coreMaxAdmissionYear: null,
    successors: [], college: '사범대학', former: false, collegeOrder: 16, teachingCourseYears: { min: null, max: null }, teacherCollege: true,
  };
  const TEACHING_DEPT = { ...TRANSFER_DEPT, teachingCourseYears: { min: null, max: null }, teacherCollege: false };
  const teacherUser = (over = {}) => ({ ...USER, departmentId: 9, department: '국어교육과', admissionYear: 2023, teachingCourse: null, ...over });

  beforeEach(() => {
    api.getDepartments.mockResolvedValue([FORMER_DEPT, TEACHING_DEPT, TEACHER_DEPT]);
  });

  it('사범대학 계정은 답하지 않았어도 "이수하고 있어요"가 골라져 있고, 저장하면 교직 이수로 보낸다', async () => {
    render(<Onboarding user={teacherUser()} onDone={() => {}} onSkip={() => {}} />);
    const row = await screen.findByRole('button', { name: /교직과정/ });
    expect(row).toHaveTextContent('이수하고 있어요');
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ teachingCourse: true }));
  });

  it('사범대학 학생은 교직 포기를 고를 수 있다(안내도 사범대학용)', async () => {
    render(<Onboarding user={teacherUser()} onDone={() => {}} onSkip={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /교직과정/ }));
    expect(await screen.findByText(/교직포기각서를 내서 교직을 포기했다면/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /이수하지 않아요/ }));
    await userEvent.click(screen.getByRole('button', { name: '확인' }));
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ teachingCourse: false }));
  });

  it('교직과정 설치 학과의 일반 학생은 답하기 전에는 "선택 필요"이고 저장할 수 없다', async () => {
    render(<Onboarding user={{ ...USER, departmentId: 7, admissionYear: 2022, teachingCourse: null }} onDone={() => {}} onSkip={() => {}} />);
    const row = await screen.findByRole('button', { name: /교직과정/ });
    expect(row).toHaveTextContent('선택 필요');
    expect(saveButton()).toBeDisabled();
  });

  it('교직 요건이 없는 학과와 편입생에게는 교직 질문이 없고, 교직 여부를 null로 보낸다', async () => {
    render(<Onboarding user={transferUser()} onDone={() => {}} onSkip={() => {}} />);
    await screen.findByText('2026년 3학년 편입');
    expect(screen.queryByRole('button', { name: /교직과정/ })).toBeNull();
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ teachingCourse: null, transferRecognizedCredits: null }));
  });

  it('편입생은 인정학점을 비워 둘 수 있고, 입력하면 그 값을 보낸다(160 초과는 확인할 수 없다)', async () => {
    render(<Onboarding user={transferUser()} onDone={() => {}} onSkip={() => {}} />);
    expect(await screen.findByRole('button', { name: /편입 인정학점/ })).toHaveTextContent('입력 안 함 (학교 기준으로 계산)');

    await userEvent.click(screen.getByRole('button', { name: /편입 인정학점/ }));
    const input = await screen.findByLabelText('편입할 때 인정받은 학점 (선택)');
    await userEvent.type(input, '200');
    expect(screen.getByText('0~160 사이의 숫자만 입력할 수 있어요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인' })).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, '65');
    await userEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(await screen.findByRole('button', { name: /편입 인정학점/ })).toHaveTextContent('65학점');
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ transferRecognizedCredits: 65 }));
  });
});

describe('광역 계열전공 이수유형(#378 결정 3-1 A)', () => {
  const SERIES_DEPT = {
    id: 11, name: '공학1계열', minAdmissionYear: 2026, maxAdmissionYear: null, coreMinAdmissionYear: 2026, coreMaxAdmissionYear: null,
    successors: [], college: '공과대학', former: false, collegeOrder: 11,
  };
  const seriesUser = (over = {}) => ({ ...USER, departmentId: 11, department: '공학1계열', admissionYear: 2026, majorTrackType: null, ...over });

  beforeEach(() => {
    api.getDepartments.mockResolvedValue([FORMER_DEPT, TRANSFER_DEPT, SERIES_DEPT]);
  });

  it('계열 학생은 답하기 전에는 "선택 필요"라 저장할 수 없고, 고르면 그 값을 보낸다', async () => {
    render(<Onboarding user={seriesUser()} onDone={() => {}} onSkip={() => {}} />);
    const row = await screen.findByRole('button', { name: /전공 이수유형/ });
    expect(row).toHaveTextContent('선택 필요');
    expect(saveButton()).toBeDisabled();
    await userEvent.click(row);
    await userEvent.click(screen.getByRole('button', { name: /전공심화형/ }));
    await userEvent.click(screen.getByRole('button', { name: '확인' }));
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ majorTrackType: 'INTENSIVE' }));
  });

  it('"아직 안 정했어요"도 답으로 저장한다', async () => {
    render(<Onboarding user={seriesUser({ majorTrackType: 'UNDECIDED' })} onDone={() => {}} onSkip={() => {}} />);
    expect(await screen.findByRole('button', { name: /전공 이수유형/ })).toHaveTextContent('아직 안 정했어요');
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ majorTrackType: 'UNDECIDED' }));
  });

  it('계열이 아닌 학과에는 이수유형 질문이 없고 null로 보낸다', async () => {
    render(<Onboarding user={USER} onDone={() => {}} onSkip={() => {}} />);
    await screen.findByRole('button', { name: /학과/ });
    expect(screen.queryByRole('button', { name: /전공 이수유형/ })).toBeNull();
    await userEvent.click(saveButton());
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ majorTrackType: null }));
  });
});
