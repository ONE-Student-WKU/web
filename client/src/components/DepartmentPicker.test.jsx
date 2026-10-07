import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DepartmentPicker from './DepartmentPicker.jsx';
import { groupDepartmentsByCollege, searchDepartments, normalizeForSearch, FORMER_GROUP_LABEL } from '../utils/departmentTree.js';

const dept = (id, name, extra = {}) => ({
  id, name, minAdmissionYear: 2020, maxAdmissionYear: null, coreMinAdmissionYear: 2020, coreMaxAdmissionYear: null,
  successors: [], college: null, former: false, collegeOrder: null, ...extra,
});

const DEPARTMENTS = [
  dept(1, '공학3계열', { college: '공과대학', collegeOrder: 11 }),
  dept(2, '컴퓨터·소프트웨어공학과', { college: '공과대학', collegeOrder: 11, former: true, maxAdmissionYear: 2025, coreMaxAdmissionYear: 2025, successors: [{ name: '공학3계열', effectiveYear: 2026, confirmed: true }] }),
  dept(3, '경영계열', { college: '경상대학', collegeOrder: 12 }),
  dept(4, '경영학부', { college: '경상대학', collegeOrder: 12, former: true, successors: [{ name: '경영계열', effectiveYear: 2023, confirmed: false }] }),
  dept(5, '원불교학과', { college: '교학대학', collegeOrder: 0 }),
  dept(6, '교육학과', { former: true }), // 어디에도 못 붙은 이전 학과
];

describe('departmentTree 순수 함수', () => {
  it('대학 순서(collegeOrder)대로 묶고, 소속 없는 학과는 맨 끝 "이전 학과" 묶음으로 보낸다', () => {
    const groups = groupDepartmentsByCollege(DEPARTMENTS);
    expect(groups.map((g) => g.college)).toEqual(['교학대학', '공과대학', '경상대학', FORMER_GROUP_LABEL]);
  });

  it('묶음 안에서는 지금 있는 학과가 먼저, 이름이 바뀐 이전 학과가 뒤에 온다', () => {
    const engineering = groupDepartmentsByCollege(DEPARTMENTS).find((g) => g.college === '공과대학');
    expect(engineering.departments.map((d) => d.name)).toEqual(['공학3계열', '컴퓨터·소프트웨어공학과']);
  });

  it('검색: 공백·가운뎃점·대소문자를 무시하고, 이름 시작 일치를 앞에 둔다', () => {
    expect(normalizeForSearch(' 경제금융 · 회계세무 ')).toBe('경제금융회계세무');
    expect(searchDepartments(DEPARTMENTS, '컴퓨터').map((d) => d.id)).toEqual([2]);
    expect(searchDepartments(DEPARTMENTS, '소프트웨어').map((d) => d.id)).toEqual([2]);
    expect(searchDepartments(DEPARTMENTS, '')).toEqual([]);
  });

  it('검색: 소속 대학 이름이나 이후 학과 이름으로도 찾아진다(옛 학과를 새 이름으로 찾기)', () => {
    expect(searchDepartments(DEPARTMENTS, '경상대학').map((d) => d.id)).toEqual([3, 4]);
    expect(searchDepartments(DEPARTMENTS, '공학3').map((d) => d.id)).toEqual([1, 2]); // 공학3계열(이름 일치) 다음에 후속이 공학3계열인 컴소공
  });
});

describe('DepartmentPicker', () => {
  const renderPicker = (props = {}) => {
    const onSelect = vi.fn();
    render(<DepartmentPicker departments={DEPARTMENTS} selectedId={null} onSelect={onSelect} {...props} />);
    return { onSelect };
  };

  it('처음에는 대학 묶음만 보이고 학과는 접혀 있다, 묶음을 누르면 그 대학의 학과가 펼쳐진다', async () => {
    renderPicker();
    expect(screen.getByRole('button', { name: /공과대학/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('컴퓨터·소프트웨어공학과')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /공과대학/ }));
    expect(screen.getByRole('button', { name: /공과대학/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('컴퓨터·소프트웨어공학과')).toBeInTheDocument();
    expect(screen.getByText('이후 학과: 공학3계열')).toBeInTheDocument();
  });

  it('펼친 묶음에서 학과를 누르면 onSelect가 그 학과로 불린다', async () => {
    const { onSelect } = renderPicker();
    await userEvent.click(screen.getByRole('button', { name: /경상대학/ }));
    // 이전 학과 카드(경영학부)의 "이후 학과: 경영계열" 안내에도 같은 글자가 있어 이름이 그 글자로 시작하는 카드만 고른다.
    await userEvent.click(screen.getByRole('button', { name: /^경영계열/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 3, name: '경영계열' }));
  });

  it('이미 고른 학과가 있으면(학적정보 수정) 그 학과의 대학 묶음이 처음부터 펼쳐져 있다', () => {
    renderPicker({ selectedId: 2 });
    expect(screen.getByRole('button', { name: /공과대학/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /컴퓨터·소프트웨어공학과/ })).toHaveClass('selected');
    expect(screen.getByRole('button', { name: /경상대학/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('검색창에 입력하면 트리 대신 일치하는 학과가 소속과 함께 한 줄 목록으로 나온다', async () => {
    renderPicker();
    await userEvent.type(screen.getByRole('searchbox', { name: '학과 검색' }), '컴퓨터');
    expect(screen.getByText('검색 결과 1개')).toBeInTheDocument();
    const card = screen.getByRole('button', { name: /컴퓨터·소프트웨어공학과/ });
    expect(within(card).getByText(/공과대학 \(이전 학과\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /경상대학/ })).toBeNull(); // 트리는 숨겨짐
  });

  it('검색 결과에서 학과를 누르면 onSelect가 불린다', async () => {
    const { onSelect } = renderPicker();
    await userEvent.type(screen.getByRole('searchbox', { name: '학과 검색' }), '경영학부');
    await userEvent.click(screen.getByRole('button', { name: /경영학부/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
  });

  it('일치하는 학과가 없으면 안내 문구가 나오고, 지우기 버튼으로 트리로 돌아간다', async () => {
    renderPicker();
    await userEvent.type(screen.getByRole('searchbox', { name: '학과 검색' }), '없는학과');
    expect(screen.getByText(/맞는 학과가 없어요/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '검색어 지우기' }));
    expect(screen.getByRole('button', { name: /공과대학/ })).toBeInTheDocument();
  });

  it('"이전 학과 (개편·폐지)" 묶음에는 입학 당시 이름을 고르라는 안내가 있다', async () => {
    renderPicker();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(FORMER_GROUP_LABEL.replace(/[()]/g, '\\$&')) }));
    expect(screen.getByText(/입학 당시 학과 이름을 고르세요/)).toBeInTheDocument();
    expect(screen.getByText('교육학과')).toBeInTheDocument();
  });

  it('서버가 소속 정보(college)를 아직 안 내려주는 배포 순서에서는 기존처럼 평평한 목록이다(검색은 됨)', async () => {
    const legacy = DEPARTMENTS.map(({ college, former, collegeOrder, ...rest }) => rest); // eslint-disable-line no-unused-vars
    renderPicker({ departments: legacy });
    expect(screen.queryByRole('button', { name: /공과대학/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^경영계열/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^원불교학과/ })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: '학과 검색' }), '원불교');
    expect(screen.getByText('검색 결과 1개')).toBeInTheDocument();
  });

  it('한글 조합 중에는 검색을 보류하고(깜빡임 방지, 과목 카탈로그 검색과 같은 방식) 글자가 완성되는 순간에만 반영한다', () => {
    renderPicker();
    const input = screen.getByRole('searchbox', { name: '학과 검색' });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '컴ㅍ' } }); // 조합 중 낱자 — 이 상태로 걸러 내면 "맞는 학과가 없어요"가 번쩍인다
    expect(input).toHaveValue('컴ㅍ'); // 입력창에는 바로 보이지만
    expect(screen.queryByText(/맞는 학과가 없어요/)).toBeNull(); // 검색은 아직 안 했고
    expect(screen.getByRole('button', { name: /공과대학/ })).toBeInTheDocument(); // 트리가 그대로다
    fireEvent.change(input, { target: { value: '컴퓨' } });
    fireEvent.compositionEnd(input, { target: { value: '컴퓨' } });
    expect(screen.getByText('검색 결과 1개')).toBeInTheDocument();
  });
});
