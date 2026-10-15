import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/chatApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  updateProfile: vi.fn(),
}));

import * as api from '../api/chatApi.js';
import HomeEdit from './HomeEdit.jsx';

/**
 * client/src/pages/HomeEdit.test.jsx
 * 홈 화면 편집: 하단 바 켜기/끄기, 기능 목록 하나에서 스위치로 넣고 빼며(빈 자리 null, 다 채우지 않아도 저장),
 * 하단 바 미리보기·메뉴 순서에서 끌거나 눌러서 자리를 맞바꾸고, 기본 배치와 같으면 null로 보낸다.
 */

const USER = { id: 1, homeLayout: null };

beforeEach(() => {
  vi.clearAllMocks();
  api.updateProfile.mockImplementation(async (payload) => ({ ...USER, homeLayout: payload.homeLayout }));
});

const renderEdit = (user = USER) => render(<HomeEdit user={user} onCancel={() => {}} onSaved={() => {}} />);

// 미리보기 4자리의 이름(접근성 이름 "N번 자리: 이름"에서 이름만).
const slotNames = () =>
  within(screen.getByRole('group', { name: '하단 바 미리보기' }))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label').replace(/^\d번 자리: /, ''));
const slotButton = (n) => screen.getByRole('button', { name: new RegExp(`^${n}번 자리:`) });
// 기능 스위치 — 위가 메뉴, 아래가 하단 바 목록이라 이름이 같은 스위치가 둘이다.
const menuSwitch = (name) => within(screen.getByText('메뉴', { selector: '.home-card-label' }).closest('section')).getByRole('switch', { name });
const featureSwitch = (name) => within(screen.getByText('하단 바 자리').closest('section')).getByRole('switch', { name });

const DEFAULT_MENU = ['과목 관리', '졸업요건 진단', '진로 탐색', '커뮤니티', '문의하기'];
const menuNames = () =>
  within(screen.getByRole('group', { name: '메뉴 미리보기' }))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label').replace(/^\d번째 메뉴: /, ''));

// jsdom은 화면 배치를 계산하지 않으므로 하단 바 미리보기 자리 i가 가로 [i*50, i*50+40]에 있다고 정해 준다.
const stubSlotRects = (container) => {
  container.querySelectorAll('.home-edit-preview [data-slot]').forEach((el) => {
    const i = Number(el.dataset.slot);
    el.getBoundingClientRect = () => ({ left: i * 50, width: 40, top: 0, height: 40, right: i * 50 + 40, bottom: 40 });
  });
};
// 끌어서 놓기 — 아이콘의 grabOffset만큼 옆을 잡고 끌어, 아이콘 가운데가 toX에 오게 한다.
// 실제 브라우저처럼 손을 뗀 뒤 click도 보낸다(드래그 뒤 click은 무시돼야 한다).
const dragSlot = (container, from, toX, grabOffset = 0) => {
  const el = container.querySelector(`.home-edit-preview [data-slot="${from}"]`);
  fireEvent.pointerDown(el, { pointerId: 1, clientX: from * 50 + 20 + grabOffset, clientY: 20 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: toX + grabOffset, clientY: 25 });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: toX + grabOffset, clientY: 25 });
  fireEvent.click(el);
};

describe('HomeEdit', () => {
  it('기본 배치(홈·졸업요건·진로·커뮤니티, 하단 바 켬)가 보이고, 바꾸지 않고 저장하면 null로 보낸다', async () => {
    const onSaved = vi.fn();
    render(<HomeEdit user={USER} onCancel={() => {}} onSaved={onSaved} />);
    expect(screen.getByRole('switch', { name: /하단 바 사용/ })).toBeChecked();
    expect(slotNames()).toEqual(['홈', '졸업요건 진단', '진로 탐색', '커뮤니티']);

    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenCalledWith({ homeLayout: null });
    expect(onSaved).toHaveBeenCalled();
  });

  it('기능 목록은 하나 — 6개 기능이 스위치로 나오고, 하단 바에 있는 것만 켜져 있다', () => {
    renderEdit();
    const on = ['홈', '졸업요건 진단', '진로 탐색', '커뮤니티'];
    for (const name of ['홈', '과목 관리', '졸업요건 진단', '진로 탐색', '커뮤니티', '문의하기']) {
      expect(featureSwitch(name).checked).toBe(on.includes(name));
    }
    // 4자리가 다 찼으면 꺼진 기능은 켤 수 없다.
    expect(featureSwitch('문의하기')).toBeDisabled();
    expect(screen.getByText('4자리가 모두 찼어요. 다른 기능을 켜려면 먼저 하나를 꺼 주세요.')).toBeInTheDocument();
  });

  it('끈 기능의 자리는 빈 자리로 남고, 다 채우지 않아도 저장된다 — 켜면 첫 빈 자리에 들어간다', async () => {
    renderEdit();
    await userEvent.click(featureSwitch('졸업요건 진단'));
    expect(slotNames()).toEqual(['홈', '빈 자리', '진로 탐색', '커뮤니티']);
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenLastCalledWith({
      homeLayout: { tabs: ['home', null, 'career', 'community'], showTabBar: true, menu: ['courses', 'graduation', 'career', 'community', 'inquiry'] },
    });

    await userEvent.click(featureSwitch('과목 관리'));
    expect(slotNames()).toEqual(['홈', '과목 관리', '진로 탐색', '커뮤니티']);
  });

  it('모두 끄면 챗봇 버튼만 남는다고 알려 주고, 그대로 저장된다', async () => {
    renderEdit();
    for (const name of ['홈', '졸업요건 진단', '진로 탐색', '커뮤니티']) {
      await userEvent.click(featureSwitch(name));
    }
    expect(screen.getByText('모두 비우면 하단 바 없이 가운데 챗봇 버튼만 남아요.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenCalledWith({
      homeLayout: { tabs: [null, null, null, null], showTabBar: true, menu: ['courses', 'graduation', 'career', 'community', 'inquiry'] },
    });
  });

  it('누르기: 아이콘을 누른 뒤 다른 자리(빈 자리 포함)를 누르면 맞바꾸고, 같은 아이콘을 다시 누르면 취소된다', async () => {
    renderEdit();
    await userEvent.click(slotButton(1));
    expect(slotButton(1)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/홈: 옮길 자리를 눌러 주세요/)).toBeInTheDocument();
    await userEvent.click(slotButton(4));
    expect(slotNames()).toEqual(['커뮤니티', '졸업요건 진단', '진로 탐색', '홈']);

    await userEvent.click(featureSwitch('졸업요건 진단'));
    await userEvent.click(slotButton(4));
    await userEvent.click(slotButton(2));
    expect(slotNames()).toEqual(['커뮤니티', '홈', '진로 탐색', '빈 자리']);

    await userEvent.click(slotButton(1));
    await userEvent.click(slotButton(1));
    expect(slotButton(1)).toHaveAttribute('aria-pressed', 'false');
    expect(slotNames()).toEqual(['커뮤니티', '홈', '진로 탐색', '빈 자리']);
  });

  it('빈 자리를 먼저 누르면 아무것도 고르지 않는다', async () => {
    renderEdit({ ...USER, homeLayout: { tabs: [null, 'home', null, null], showTabBar: true } });
    await userEvent.click(slotButton(1));
    expect(slotButton(1)).toHaveAttribute('aria-pressed', 'false');
  });

  it('드래그: 아이콘을 끌어 놓으면 놓은 자리와 맞바꾸고(빈 자리로도), 뒤따르는 click으로 선택되지 않는다', async () => {
    const { container } = renderEdit();
    stubSlotRects(container);
    dragSlot(container, 0, 170); // 홈(0번) → 3번 자리 근처에 놓기
    expect(slotNames()).toEqual(['커뮤니티', '졸업요건 진단', '진로 탐색', '홈']);
    expect(container.querySelector('[aria-pressed="true"]')).toBeNull();

    await userEvent.click(featureSwitch('졸업요건 진단'));
    stubSlotRects(container);
    dragSlot(container, 3, 70); // 홈(3번) → 비어 있는 1번 자리
    expect(slotNames()).toEqual(['커뮤니티', '홈', '진로 탐색', '빈 자리']);
  });

  it('판정은 손가락이 아니라 끌고 있는 아이콘의 가운데로 한다 — 가장자리를 잡아도 보이는 위치대로 들어간다', () => {
    const { container } = renderEdit();
    stubSlotRects(container);
    // 홈(0번)의 오른쪽 가장자리(+18px)를 잡고 아이콘 가운데를 93에 놓는다 — 아이콘은 1번 자리(가운데 70)에 더 가깝지만
    // 손가락(111)은 2번 자리(가운데 120)에 더 가깝다. 보이는 아이콘대로 1번에 들어가야 한다.
    dragSlot(container, 0, 93, 18);
    expect(slotNames()).toEqual(['졸업요건 진단', '홈', '진로 탐색', '커뮤니티']);
  });

  it('끄는 동안 들어갈 자리를 표시하고, 어느 자리에도 가깝지 않은 곳에 놓으면 제자리로 돌아간다', () => {
    const { container } = renderEdit();
    stubSlotRects(container);
    const el = container.querySelector('.home-edit-preview [data-slot="0"]');
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 120, clientY: 20 });
    expect(container.querySelector('.home-edit-preview [data-slot="2"]')).toHaveClass('drop-target');
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 400, clientY: 20 });
    expect(container.querySelector('.drop-target')).toBeNull();
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 400, clientY: 20 });
    expect(slotNames()).toEqual(['홈', '졸업요건 진단', '진로 탐색', '커뮤니티']);
  });

  it('조금만 움직이고 떼면 드래그가 아니라 누르기로 본다', () => {
    const { container } = renderEdit();
    stubSlotRects(container);
    dragSlot(container, 0, 23); // 3px 이동
    expect(slotNames()).toEqual(['홈', '졸업요건 진단', '진로 탐색', '커뮤니티']);
    expect(slotButton(1)).toHaveAttribute('aria-pressed', 'true');
  });

  it('빈 자리는 끌 수 없다', () => {
    const { container } = renderEdit({ ...USER, homeLayout: { tabs: [null, 'home', null, null], showTabBar: true } });
    stubSlotRects(container);
    dragSlot(container, 0, 70);
    expect(slotNames()).toEqual(['빈 자리', '홈', '빈 자리', '빈 자리']);
  });

  it('메뉴 순서: 카드 5개가 기본 순서로 나오고, 누르거나 끌어서 맞바꾼 순서가 저장된다', async () => {
    const { container } = renderEdit();
    expect(menuNames()).toEqual(DEFAULT_MENU);

    await userEvent.click(screen.getByRole('button', { name: '1번째 메뉴: 과목 관리' }));
    await userEvent.click(screen.getByRole('button', { name: '5번째 메뉴: 문의하기' }));
    expect(menuNames()).toEqual(['문의하기', '졸업요건 진단', '진로 탐색', '커뮤니티', '과목 관리']);

    // 2열 격자: 카드 i가 (i%2)*100, floor(i/2)*60 자리에 있다고 정하고, 0번 카드를 3번 카드(오른쪽 둘째 줄) 위로 끈다.
    container.querySelectorAll('.home-edit-menu [data-slot]').forEach((el) => {
      const i = Number(el.dataset.slot);
      el.getBoundingClientRect = () => ({ left: (i % 2) * 100, top: Math.floor(i / 2) * 60, width: 90, height: 50 });
    });
    const card = container.querySelector('.home-edit-menu [data-slot="0"]');
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 45, clientY: 25 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 145, clientY: 85 });
    expect(container.querySelector('.home-edit-menu [data-slot="3"]')).toHaveClass('drop-target');
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 145, clientY: 85 });
    expect(menuNames()).toEqual(['커뮤니티', '졸업요건 진단', '진로 탐색', '문의하기', '과목 관리']);

    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenCalledWith({
      homeLayout: {
        tabs: ['home', 'graduation', 'career', 'community'],
        showTabBar: true,
        menu: ['community', 'graduation', 'career', 'inquiry', 'courses'],
      },
    });
  });

  it('하단 바를 꺼도 메뉴는 바꿀 수 있다', async () => {
    renderEdit();
    await userEvent.click(screen.getByRole('switch', { name: /하단 바 사용/ }));
    expect(menuNames()).toEqual(DEFAULT_MENU);
    expect(menuSwitch('과목 관리')).toBeChecked();
  });

  it('메뉴 카드를 빼면 뒤 카드가 당겨지고, 다시 켜면 맨 끝에 들어간다', async () => {
    renderEdit();
    await userEvent.click(menuSwitch('졸업요건 진단'));
    expect(menuNames()).toEqual(['과목 관리', '진로 탐색', '커뮤니티', '문의하기']);
    await userEvent.click(menuSwitch('졸업요건 진단'));
    expect(menuNames()).toEqual(['과목 관리', '진로 탐색', '커뮤니티', '문의하기', '졸업요건 진단']);
  });

  it('메뉴를 모두 빼면 홈에 메뉴가 없다고 알려 주고, 빈 메뉴로 저장된다(하단 바와 같이 비워도 막지 않는다)', async () => {
    renderEdit();
    for (const name of DEFAULT_MENU) await userEvent.click(menuSwitch(name));
    expect(screen.getByText('모두 끄면 홈 화면에 메뉴가 보이지 않아요.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: /하단 바 사용/ }));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenCalledWith({
      homeLayout: { tabs: ['home', 'graduation', 'career', 'community'], showTabBar: false, menu: [] },
    });
  });

  it('하단 바를 끄면 자리 편집이 사라지고, 끈 채로 저장된다', async () => {
    renderEdit();
    await userEvent.click(screen.getByRole('switch', { name: /하단 바 사용/ }));
    expect(screen.getByText(/챗봇 버튼을 포함한 하단 바가 모든 화면에서 사라져요/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '하단 바 미리보기' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenCalledWith({
      homeLayout: { tabs: ['home', 'graduation', 'career', 'community'], showTabBar: false, menu: ['courses', 'graduation', 'career', 'community', 'inquiry'] },
    });
  });

  it('기본값으로 되돌리면 null로 보낸다', async () => {
    renderEdit({ ...USER, homeLayout: { tabs: ['courses', 'inquiry', null, 'home'], showTabBar: false } });
    await userEvent.click(screen.getByRole('button', { name: '기본값으로 되돌리기' }));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(api.updateProfile).toHaveBeenCalledWith({ homeLayout: null });
  });

  it('저장에 실패하면 알려 준다', async () => {
    api.updateProfile.mockRejectedValue(new Error('x'));
    renderEdit();
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('저장하지 못했어요. 다시 시도해 주세요.')).toBeInTheDocument();
  });
});
