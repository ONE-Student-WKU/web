import { useRef, useState } from 'react';

// 이만큼(px) 넘게 움직여야 드래그로 본다. 그보다 적게 움직이고 떼면 "누르기"(선택·맞바꾸기)로 처리한다.
const DRAG_THRESHOLD = 6;

/**
 * client/src/hooks/useSwapSlots.js
 * 자리(슬롯) 목록에서 두 자리를 맞바꾸는 조작 — 홈 화면 편집의 하단 바 미리보기와 메뉴 순서가 같이 쓴다.
 *  - 끌기: 자리를 끌어 다른 자리에 놓으면 맞바꾼다. Pointer Events로 처리한다(HTML5 드래그 앤 드롭은 모바일 터치에서 동작하지 않는다).
 *    누른 자리에 포인터를 붙잡아(setPointerCapture) 손가락이 밖으로 나가도 이벤트를 계속 받고, 놓을 자리는 손가락이 아니라
 *    "끌고 있는 것의 가운데"로 정한다(가장자리를 잡아도 눈에 보이는 위치대로 판정되게). 어느 자리에도 가깝지 않으면 제자리로 돌아간다.
 *  - 누르기: 자리를 누르면 고르고, 다른 자리를 누르면 맞바꾼다(같은 자리를 다시 누르면 취소). 키보드(Tab·Enter)·화면 읽기와
 *    끌기 어려운 작은 화면을 위한 같은 기능의 다른 길이다.
 *  - 브라우저는 끌고 손을 뗀 뒤에도 click을 보내므로, 드래그 직후 click 한 번은 무시한다.
 *
 * @param {object} options
 * @param {(index: number) => boolean} options.isMovable - 이 자리를 집을 수 있는지(빈 자리는 못 집는다). 놓을 자리로는 모든 자리가 된다.
 * @param {(a: number, b: number) => void} options.onSwap - 두 자리를 맞바꾼다.
 * @param {number} [options.dragScale] - 끄는 동안 줄이는 비율(아래에 깔린 "들어갈 자리" 표시가 가려지지 않게).
 * @returns {{ selected: number|null, clearSelection: Function, slotProps: (index: number) => object, slotState: (index: number) => object }}
 */
export default function useSwapSlots({ isMovable, onSwap, dragScale = 0.85 }) {
  const [selected, setSelected] = useState(null);
  // { from, startX, startY, dx, dy, over, moved, rects } — over는 손을 놓으면 맞바꿀 자리(null이면 제자리로).
  // rects는 누른 순간의 자리 위치(끄는 동안 움직여도 판정 기준이 흔들리지 않게 미리 재 둔다).
  const [drag, setDrag] = useState(null);
  const refs = useRef([]);
  const suppressClick = useRef(false);

  const handleClick = (index) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (selected === null) {
      if (isMovable(index)) setSelected(index);
      return;
    }
    if (selected !== index) onSwap(selected, index);
    setSelected(null);
  };

  const handlePointerDown = (index) => (e) => {
    if (!isMovable(index)) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const rects = refs.current.map((el) => el?.getBoundingClientRect());
    setDrag({ from: index, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, over: index, moved: false, rects });
  };
  const handlePointerMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const moved = drag.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD;
    const origin = drag.rects[drag.from];
    const cx = origin ? origin.left + origin.width / 2 + dx : e.clientX;
    const cy = origin ? origin.top + origin.height / 2 + dy : e.clientY;
    setDrag((d) => d && { ...d, dx, dy, moved, over: moved ? dropSlot(cx, cy, d.rects) : d.from });
  };
  const handlePointerUp = () => {
    if (drag?.moved) {
      suppressClick.current = true;
      if (drag.over !== null && drag.over !== drag.from) onSwap(drag.from, drag.over);
      setSelected(null);
    }
    setDrag(null);
  };

  const isDragging = (index) => Boolean(drag?.moved && drag.from === index);

  // 자리 요소에 그대로 펼쳐 넣는 속성(<button {...slotProps(i)}>).
  const slotProps = (index) => ({
    ref: (el) => (refs.current[index] = el),
    'data-slot': index,
    'aria-pressed': selected === index,
    style: isDragging(index) ? { transform: `translate(${drag.dx}px, ${drag.dy}px) scale(${dragScale})` } : undefined,
    onClick: () => handleClick(index),
    onPointerDown: handlePointerDown(index),
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: () => setDrag(null),
  });

  // 화면 표시용 상태(클래스 이름을 붙이는 데 쓴다).
  const slotState = (index) => ({
    selected: selected === index,
    dragging: isDragging(index),
    dropTarget: Boolean(drag?.moved && drag.from !== index && drag.over === index),
  });

  return { selected, clearSelection: () => setSelected(null), slotProps, slotState };
}

/**
 * 끌고 있는 것의 가운데(x, y)가 들어갈 자리 번호. 가운데끼리 가로 거리가 그 자리 너비 안, 세로 거리가 높이 안인 자리 중 가장 가까운 자리.
 * 어느 자리에도 가깝지 않으면(예: 하단 바 가운데 챗봇 버튼 위) null이라 놓으면 제자리로 돌아간다. 자리 위치를 모를 때도 null.
 */
export function dropSlot(x, y, rects) {
  let best = null;
  let bestDist = Infinity;
  rects.forEach((r, i) => {
    if (!r || r.width === 0) return;
    const ddx = Math.abs(r.left + r.width / 2 - x);
    const ddy = Math.abs(r.top + r.height / 2 - y);
    if (ddx > r.width || ddy > r.height) return;
    const dist = Math.hypot(ddx, ddy);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  });
  return best;
}
