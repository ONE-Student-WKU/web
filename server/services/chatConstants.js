/**
 * server/services/chatConstants.js
 * 챗봇이 근거 문서를 하나도 못 찾았을 때 저장·응답하는 고정 안내 문구. routes/chat.js가 쓰고, 관리자 대시보드의
 * "근거 못 찾은 답변" 집계(adminStatsService)가 같은 문구로 해당 답변을 센다 — 한쪽만 고치면 집계가 어긋나므로 한곳에 둔다.
 */
const NOT_FOUND_MESSAGE = '관련 규정을 찾지 못했어요. 질문을 다르게 표현해보시거나, 관련 부서에 직접 확인해주세요.';
const NOT_FOUND_MESSAGE_EN = "I couldn't find a relevant regulation. Try rephrasing your question, or check directly with the relevant office.";

module.exports = { NOT_FOUND_MESSAGE, NOT_FOUND_MESSAGE_EN };
