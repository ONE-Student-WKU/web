const curriculumService = require('./curriculumService');
const curriculumContext = require('./curriculumContextService');

/**
 * server/services/chatContextService.js
 * 챗봇 한 번의 질문에 쓸 "근거 청크"를 모은다 — routes/chat.js에서 분리한 이유는 학번/학년도별로 어떤 데이터가
 * 조회되는지를 AI 호출 없이 테스트하기 위해서다. 연도 판단(yearContext)은 호출자가 한 번 정해서 넘기고,
 * 여기서는 모든 구조화 조회가 같은 yearContext를 쓴다(예전에는 조회마다 연도를 따로 읽어 서로 다른 연도를 썼다).
 */

// 앞쪽일수록 모델이 먼저 보는 근거다. 연도별 졸업요건·변경 이력이 질문의 핵심인 경우가 많아 맨 앞에 둔다.
async function assembleStructuredChunks({ message, searchText, student, previousUserMessage, yearContext }) {
  const [graduation, history, curriculum, requirement, offering, linkedMajor, microDegree] = await Promise.all([
    curriculumContext.lookupGraduationRequirements({ message, student, yearContext }),
    curriculumContext.lookupChangeHistory({ message, contextText: previousUserMessage, student, yearContext }),
    curriculumService.lookupFromMessage(message, student, yearContext),
    curriculumService.lookupRequirementsFromMessage(searchText || message, student, yearContext),
    curriculumService.lookupOfferingsFromMessage(message, student, yearContext),
    curriculumService.lookupLinkedMajorsFromMessage(message),
    curriculumService.lookupMicroDegreesFromMessage(message),
  ]);
  return { graduation, history, curriculum, requirement, offering, linkedMajor, microDegree };
}

// 구조화 근거 + 직전 turn 인용 + RAG 검색 결과를 하나의 목록으로 합친다(chunkId 중복 제거).
// 직전 turn 청크 중 다른 해 책자의 것은 이번 질문의 학년도와 섞이지 않도록 뺀다.
function mergeChunks({ structured, previousCitedChunks = [], freshChunks = [], yearContext }) {
  const allowedBookYears = new Set(yearContext.bookYears);
  const previous = previousCitedChunks.filter((c) => c.bookYear == null || allowedBookYears.size === 0 || allowedBookYears.has(c.bookYear));

  const merged = [];
  const seen = new Set();
  for (const c of [
    ...structured.graduation,
    ...structured.history,
    ...structured.curriculum,
    ...structured.requirement,
    ...structured.offering,
    ...structured.linkedMajor,
    ...structured.microDegree,
    ...previous,
    ...freshChunks,
  ]) {
    if (seen.has(c.chunkId)) continue;
    seen.add(c.chunkId);
    merged.push(c);
  }
  return merged;
}

module.exports = { assembleStructuredChunks, mergeChunks };
