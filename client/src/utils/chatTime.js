// 채팅 말풍선의 시각 — 브라우저 언어가 아니라 화면 언어를 따른다. 인자 없는 toLocaleTimeString()은
// 한국어 브라우저에서 영어 화면이어도 "오전 6:23"으로 나왔다(운영 점검 2026-10-17).
export function formatChatTime(sentAt, lang) {
  if (!sentAt) return '';
  const date = new Date(sentAt);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(lang);
}
