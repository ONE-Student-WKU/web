// 관리자 화면들이 같이 쓰는 날짜·이름표. 관리자 화면은 학생에게 보이지 않아 한국어로만 쓴다(번역 사전을 거치지 않는다).

export function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

// 'MM.DD' — 목록 메타처럼 자리가 좁은 곳.
export function shortDate(dateStr) {
  const d = new Date(dateStr);
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export const CATEGORY_LABEL = { study: '스터디', project: '팀 활동·공모전' };

// 제재 범위 — 학생에게 보이는 제재 안내와 같은 뜻으로, 무엇이 막히는지 바로 알게 쓴다.
// account(#457)는 약관 6항의 이름 그대로 — 언제 고르는지는 docs/moderation-policy.md.
export const SANCTION_SCOPE_LABEL = { post_apply: '글쓰기·신청 금지', full: '커뮤니티 이용 정지', account: '서비스 전체 이용 정지' };

// 지금 적용 중인지·해제됐는지·기간이 끝났는지(서버 sanction state 또는 목록 행으로 판단).
export function sanctionState(s, now = Date.now()) {
  if (s.state) return s.state;
  if (s.liftedAt) return 'lifted';
  if (s.endsAt && new Date(s.endsAt).getTime() <= now) return 'expired';
  return 'active';
}

export const SANCTION_STATE_LABEL = { active: '적용 중', lifted: '해제됨', expired: '기간 종료' };

// 남은 기간 — 오늘 끝나면 "오늘까지", 하루 넘게 남으면 "N일 남음".
export function remainingLabel(endsAt, now = Date.now()) {
  if (!endsAt) return '영구';
  const days = Math.ceil((new Date(endsAt).getTime() - now) / 86400000);
  return `${shortDate(endsAt)}까지 · ${days <= 1 ? '오늘 끝나요' : `${days}일 남음`}`;
}
