import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
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

  // 검색은 별도 전체 화면(SearchScreen)에서 한다 — 진입 버튼을 눌러 열고, 결과는 그 화면(dialog) 안에서 본다.
  const openSearch = async () => {
    await userEvent.click(screen.getByRole('button', { name: '학과 검색' }));
    return screen.getByRole('dialog', { name: '학과 검색' });
  };

  it('검색 진입 버튼을 누르면 검색 전용 화면이 열리고, 입력하면 일치하는 학과가 소속과 함께 한 줄 목록으로 나온다', async () => {
    renderPicker();
    expect(screen.queryByRole('dialog')).toBeNull();
    const dialog = await openSearch();
    expect(within(dialog).getByText(/학과 이름의 일부만 입력해도 찾아요/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('searchbox', { name: '학과 검색' }), '컴퓨터');
    expect(within(dialog).getByText('검색 결과 1개')).toBeInTheDocument();
    const card = within(dialog).getByRole('button', { name: /컴퓨터·소프트웨어공학과/ });
    expect(within(card).getByText(/공과대학 \(이전 학과\)/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /경상대학/ })).toBeNull(); // 결과 화면에는 트리가 없다
  });

  it('검색 결과에서 학과를 누르면 onSelect가 불리고 검색 화면이 닫힌다', async () => {
    const { onSelect } = renderPicker();
    const dialog = await openSearch();
    await userEvent.type(within(dialog).getByRole('searchbox', { name: '학과 검색' }), '경영학부');
    await userEvent.click(within(dialog).getByRole('button', { name: /경영학부/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('onSelectFromSearch를 주면(온보딩: 고른 뒤 바로 다음 질문) 검색 결과에서 고를 때 onSelect 대신 그것이 불린다', async () => {
    const onSelectFromSearch = vi.fn();
    const { onSelect } = renderPicker({ onSelectFromSearch });
    const dialog = await openSearch();
    await userEvent.type(within(dialog).getByRole('searchbox', { name: '학과 검색' }), '경영학부');
    await userEvent.click(within(dialog).getByRole('button', { name: /경영학부/ }));
    expect(onSelectFromSearch).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('검색창에서 엔터를 누르면 맨 위 결과가 바로 선택된다(결과가 없으면 아무 일도 없다)', async () => {
    const onSelectFromSearch = vi.fn();
    renderPicker({ onSelectFromSearch });
    let dialog = await openSearch();
    await userEvent.type(within(dialog).getByRole('searchbox', { name: '학과 검색' }), '없는학과{enter}');
    expect(onSelectFromSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const input = within(dialog).getByRole('searchbox', { name: '학과 검색' });
    await userEvent.clear(input);
    await userEvent.type(input, '경영{enter}'); // 경영계열(이름 시작 일치)이 맨 위, 경영학부가 다음
    expect(onSelectFromSearch).toHaveBeenCalledTimes(1);
    expect(onSelectFromSearch).toHaveBeenCalledWith(expect.objectContaining({ id: 3, name: '경영계열' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('↑↓로 가리키는 결과를 옮기고 엔터로 그 학과를 고른다(처음엔 맨 위, 끝에서는 더 안 움직임)', async () => {
    const onSelectFromSearch = vi.fn();
    renderPicker({ onSelectFromSearch });
    const dialog = await openSearch();
    const input = within(dialog).getByRole('searchbox', { name: '학과 검색' });
    await userEvent.type(input, '경영'); // 결과: 경영계열, 경영학부
    const card = (name) => within(dialog).getByRole('button', { name: new RegExp(`^${name}`) });
    expect(card('경영계열')).toHaveClass('active');

    await userEvent.keyboard('{ArrowUp}'); // 맨 위에서 위로 — 그대로
    expect(card('경영계열')).toHaveClass('active');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}'); // 맨 아래에서 아래로 — 그대로
    expect(card('경영학부')).toHaveClass('active');
    expect(card('경영계열')).not.toHaveClass('active');
    expect(input).toHaveValue('경영'); // 방향키가 입력 칸 글자를 건드리지 않는다

    await userEvent.keyboard('{Enter}');
    expect(onSelectFromSearch).toHaveBeenCalledTimes(1);
    expect(onSelectFromSearch).toHaveBeenCalledWith(expect.objectContaining({ id: 4, name: '경영학부' }));
  });

  it('검색어를 바꾸면 가리키는 결과가 다시 맨 위로 돌아간다', async () => {
    renderPicker();
    const dialog = await openSearch();
    const input = within(dialog).getByRole('searchbox', { name: '학과 검색' });
    await userEvent.type(input, '경영');
    await userEvent.keyboard('{ArrowDown}');
    expect(within(dialog).getByRole('button', { name: /^경영학부/ })).toHaveClass('active');
    await userEvent.type(input, '계열');
    expect(within(dialog).getByRole('button', { name: /^경영계열/ })).toHaveClass('active');
  });

  it('한글 조합을 끝내는 엔터(조합 중)는 건너뛰어 두 번 선택되지 않는다', async () => {
    const onSelectFromSearch = vi.fn();
    renderPicker({ onSelectFromSearch });
    const dialog = await openSearch();
    const input = within(dialog).getByRole('searchbox', { name: '학과 검색' });
    fireEvent.change(input, { target: { value: '컴퓨터' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onSelectFromSearch).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelectFromSearch).toHaveBeenCalledTimes(1);
    expect(onSelectFromSearch).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it('일치하는 학과가 없으면 안내 문구가 나오고, 뒤로가기 버튼으로 닫으면 검색어가 비워진 채 트리로 돌아간다', async () => {
    renderPicker();
    let dialog = await openSearch();
    await userEvent.type(within(dialog).getByRole('searchbox', { name: '학과 검색' }), '없는학과');
    expect(within(dialog).getByText(/맞는 학과가 없어요/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '검색 닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: /공과대학/ })).toBeInTheDocument();
    dialog = await openSearch(); // 다시 열면 이전 검색어가 남아 있지 않다
    expect(within(dialog).getByRole('searchbox', { name: '학과 검색' })).toHaveValue('');
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
    const dialog = await openSearch();
    await userEvent.type(within(dialog).getByRole('searchbox', { name: '학과 검색' }), '원불교');
    expect(within(dialog).getByText('검색 결과 1개')).toBeInTheDocument();
  });

  it('한글 조합 중에는 검색을 보류하고(깜빡임 방지, 과목 카탈로그 검색과 같은 방식) 글자가 완성되는 순간에만 반영한다', async () => {
    renderPicker();
    const dialog = await openSearch();
    const input = within(dialog).getByRole('searchbox', { name: '학과 검색' });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '컴ㅍ' } }); // 조합 중 낱자 — 이 상태로 걸러 내면 "맞는 학과가 없어요"가 번쩍인다
    expect(input).toHaveValue('컴ㅍ'); // 입력창에는 바로 보이지만
    expect(within(dialog).queryByText(/맞는 학과가 없어요/)).toBeNull(); // 검색은 아직 안 했고
    expect(within(dialog).getByText(/학과 이름의 일부만 입력해도 찾아요/)).toBeInTheDocument(); // 안내가 그대로다
    fireEvent.change(input, { target: { value: '컴퓨' } });
    fireEvent.compositionEnd(input, { target: { value: '컴퓨' } });
    expect(within(dialog).getByText('검색 결과 1개')).toBeInTheDocument();
  });
});
