/**
 * server/services/language.js
 * 화면 언어('ko' | 'en') 파싱 — 챗봇(routes/chat.js)과 진로 탐색(routes/career.js)이 같이 쓴다.
 * 클라이언트가 보내는 값은 허용 목록으로만 받고, 모르는 값은 한국어(기존 동작)로 둔다. 새 언어를 지원하면 여기와
 * studentService.VALID_LANGUAGES, aiClient의 답변 언어 지시를 같이 늘린다.
 */
function parseLanguage(value) {
  return value === 'en' ? 'en' : 'ko';
}

module.exports = { parseLanguage };
