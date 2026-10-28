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
// warning은 기능을 막지 않는 경고(기록만, student_warnings).
export const SANCTION_SCOPE_LABEL = { warning: '경고', post_apply: '글쓰기·신청 금지', full: '커뮤니티 이용 정지', account: '서비스 전체 이용 정지' };

// 지금 적용 중인지·해제됐는지·기간이 끝났는지(서버 sanction state 또는 목록 행으로 판단).
export function sanctionState(s, now = Date.now()) {
  if (s.state) return s.state;
  if (s.liftedAt) return 'lifted';
  if (s.endsAt && new Date(s.endsAt).getTime() <= now) return 'expired';
  return 'active';
}

export const SANCTION_STATE_LABEL = { active: '적용 중', lifted: '해제됨', expired: '기간 종료' };

// AI 사전 분류(#458)의 제안 조치 — 서버(moderationLabelService.js)가 "범위:기간"이나 warning·none·approve·reject로 내려준다.
// 제재 창의 범위·기간 값과 같은 모양이라, 열 때 그대로 미리 골라 둘 수 있다.
export function parseSuggestedAction(action) {
  if (!action || !action.includes(':')) return null;
  const [scope, duration] = action.split(':');
  return { scope, duration };
}

const DURATION_TEXT = { '1d': '1일', '3d': '3일', '7d': '7일', '30d': '30일', permanent: '영구' };
const SHORT_SCOPE = { post_apply: '글쓰기·신청 금지', full: '커뮤니티 정지', account: '계정 정지' };

// 목록 배지("제안 ○○")에 쓰는 짧은 이름. long이면 상세 상자에 쓰는 정식 이름.
export function suggestionText(action, long = false) {
  if (action === 'approve') return '승인';
  if (action === 'reject') return '반려';
  if (action === 'none') return '조치 없음';
  if (action === 'warning') return '경고';
  const parsed = parseSuggestedAction(action);
  if (!parsed) return action;
  const scope = long ? SANCTION_SCOPE_LABEL[parsed.scope] : SHORT_SCOPE[parsed.scope];
  const duration = DURATION_TEXT[parsed.duration] || parsed.duration;
  return parsed.duration === 'permanent' ? `${scope} 영구` : `${scope} ${duration}`;
}

// 배지 색 — 조치 없음·승인은 회색, 경고·반려는 노랑, 그 밖(제한·정지)은 빨강.
export function suggestionTone(action) {
  if (action === 'none' || action === 'approve') return '';
  if (action === 'warning' || action === 'reject') return 'warn';
  return 'danger';
}

// AI가 고른 심각도 — 제안의 계산 근거 한 줄에 쓴다.
export const SEVERITY_LABEL = {
  minor: '가벼운 위반',
  moderate: '중간 위반',
  severe: '중대한 위반',
  abuse: '문의 욕설·비방',
  none: '위반 없음',
  reject: '규칙 위반',
  approve: '위반 없음',
};

// 원문을 형광펜 조각 기준으로 나눈다 — [{ text, mark }]. 조각이 겹치면 앞의 것을 따르고, 원문에 없는 조각은 무시한다.
// 화면은 이 조각들을 <mark>로 감싸 그린다(HTML 문자열을 넣지 않아 글 속 스크립트가 실행되지 않는다).
export function splitHighlights(text, highlights = []) {
  if (!text) return [];
  const ranges = [];
  for (const h of highlights) {
    if (!h) continue;
    let from = 0;
    let at;
    while ((at = text.indexOf(h, from)) !== -1) {
      ranges.push([at, at + h.length]);
      from = at + h.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const parts = [];
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start < pos) continue;
    if (start > pos) parts.push({ text: text.slice(pos, start), mark: false });
    parts.push({ text: text.slice(start, end), mark: true });
    pos = end;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), mark: false });
  return parts;
}

// 경고를 학생이 봤는지 — 다음 접속 때 한 번 뜨는 안내에서 [확인]을 눌렀으면 acknowledgedAt이 있다.
export function warningSeenLabel(w) {
  return w.acknowledgedAt ? '학생 확인함' : '아직 안 봄';
}

// 남은 기간 — 오늘 끝나면 "오늘까지", 하루 넘게 남으면 "N일 남음".
export function remainingLabel(endsAt, now = Date.now()) {
  if (!endsAt) return '영구';
  const days = Math.ceil((new Date(endsAt).getTime() - now) / 86400000);
  return `${shortDate(endsAt)}까지 · ${days <= 1 ? '오늘 끝나요' : `${days}일 남음`}`;
}
