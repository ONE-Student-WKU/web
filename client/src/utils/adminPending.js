import { useEffect, useState } from 'react';
import { getAdminPending } from '../api/chatApi.js';

/**
 * client/src/utils/adminPending.js
 * 관리자 처리할 일 건수(신고·문의·승인 대기) — 계정 메뉴의 빨간 점과 "관리자" 줄의 건수(GET /api/admin/pending).
 * 화면마다 계정 메뉴가 따로 그려져서, 건수는 모듈 하나가 들고 있고 구독한 메뉴들이 같이 바뀐다.
 * 1분 안에 받은 값이 있으면 다시 묻지 않고, 메뉴가 떠 있는 동안 3분마다 새로 묻는다. 관리자 화면에서 처리하면 refreshAdminPending으로 바로 고친다.
 */

const FRESH_MS = 60 * 1000;
const POLL_MS = 3 * 60 * 1000;

let pending = null;
let fetchedAt = 0;
let inFlight = null;
const listeners = new Set();

function publish(next) {
  pending = next;
  for (const listener of listeners) listener(next);
}

export function refreshAdminPending() {
  if (inFlight) return inFlight;
  // 빨간 점은 부가 표시라 조회가 실패하거나(오프라인 등) 함수 자체가 없어도 메뉴를 깨지 않는다 — then 안에서 불러 동기 오류도 거부로 바꾼다.
  inFlight = Promise.resolve()
    .then(() => getAdminPending())
    .then((data) => {
      fetchedAt = Date.now();
      publish(data);
    })
    .catch(() => {})
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

// 로그아웃·계정 전환 때 App.jsx가 부른다 — 이전 관리자의 건수가 다음 계정 메뉴에 남지 않게.
export function resetAdminPending() {
  fetchedAt = 0;
  publish(null);
}

/** 관리자일 때만 건수를 받아 온다({ reports, inquiries, posts, total } | null). 관리자가 아니면 항상 null이고 요청도 하지 않는다. */
export function useAdminPending(isAdmin) {
  const [value, setValue] = useState(isAdmin ? pending : null);
  useEffect(() => {
    if (!isAdmin) {
      setValue(null);
      return undefined;
    }
    listeners.add(setValue);
    setValue(pending);
    if (Date.now() - fetchedAt > FRESH_MS) refreshAdminPending();
    const timer = setInterval(refreshAdminPending, POLL_MS);
    return () => {
      listeners.delete(setValue);
      clearInterval(timer);
    };
  }, [isAdmin]);
  return value;
}
