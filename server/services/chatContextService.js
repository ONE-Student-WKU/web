const curriculumService = require('./curriculumService');
const curriculumContext = require('./curriculumContextService');
const regulationContext = require('./regulationContextService');

/**
 * server/services/chatContextService.js
 * 챗봇 한 번의 질문에 쓸 "근거 청크"를 모은다 — routes/chat.js에서 분리한 이유는 학번/학년도별로 어떤 데이터가
 * 조회되는지를 AI 호출 없이 테스트하기 위해서다. 연도 판단(yearContext)은 호출자가 한 번 정해서 넘기고,
 * 여기서는 모든 구조화 조회가 같은 yearContext를 쓴다(예전에는 조회마다 연도를 따로 읽어 서로 다른 연도를 썼다).
 *
 * 근거 우선순위(파트 3, DECISIONS D-31) — 앞쪽일수록 모델이 먼저 보고, 시스템 프롬프트도 같은 순서로 우선하라고 지시한다:
 *  ① 규정 판단 결과(regulationContextService: 이 학생에게 적용되는 규정·신뢰도·근거 조문 원문)
 *  ② 연도별 졸업요건·변경 이력·과목/요건 조회(구조화 데이터)
 *  ③ 직전 turn 인용 청크
 *  ④ RAG 검색 결과(학칙 원문 청크, 정리 문서, 교육과정 책자)
 * RAG가 ①과 같은 조문 원문을 또 가져오면 뺀다 — 같은 조문이 두 번 들어가면 판본 표시가 없는 쪽(RAG)이 판단과 다른
 * 근거처럼 보일 수 있어서다.
 */

// regulationJudgment: routes/chat.js가 RAG 검색 전에 미리 구한 판단(lookupRegulationJudgment 결과). 넘기지 않으면 여기서 구한다
// (테스트·다른 호출자 호환).
async function assembleStructuredChunks({ message, searchText, student, previousUserMessage, yearContext, regulationJudgment }) {
  const judgmentPromise = regulationJudgment !== undefined
    ? Promise.resolve(regulationJudgment)
    : regulationContext.lookupRegulationJudgment({ message, student, yearContext });
  const [judgment, graduation, history, curriculum, requirement, offering, linkedMajor, microDegree] = await Promise.all([
    judgmentPromise,
    curriculumContext.lookupGraduationRequirements({ message, student, yearContext }),
    curriculumContext.lookupChangeHistory({ message, contextText: previousUserMessage, student, yearContext }),
    curriculumService.lookupFromMessage(message, student, yearContext),
    curriculumService.lookupRequirementsFromMessage(searchText || message, student, yearContext),
    curriculumService.lookupOfferingsFromMessage(message, student, yearContext),
    curriculumService.lookupLinkedMajorsFromMessage(message),
    curriculumService.lookupMicroDegreesFromMessage(message),
  ]);
  const regulation = judgment ? judgment.chunks : [];
  return { regulation, judgment: judgment ? judgment.judgment : null, graduation, history, curriculum, requirement, offering, linkedMajor, microDegree };
}

/**
 * RAG 청크가 판단 쪽 조문 원문과 같은 조문인가. RAG 원문 문서 제목은 "원광대학교 학칙 전문"/"원광대학교 학칙시행규칙 전문"이고
 * 원문 청크는 조 단위라 "제13조(…"로 시작한다. 제목은 완전 일치로 본다 — "학칙"이 "학칙시행규칙"에 포함돼 부분 일치는 틀린다.
 */
function duplicatesJudgedArticle(chunk, articleChunks) {
  const text = String(chunk.content || '').trimStart();
  return articleChunks.some((a) => chunk.documentTitle === a.ragDocumentTitle && text.startsWith(`${a.articleKey}(`));
}

// 구조화 근거 + 직전 turn 인용 + RAG 검색 결과를 하나의 목록으로 합친다(chunkId 중복 제거).
// 직전 turn 청크 중 다른 해 책자의 것은 이번 질문의 학년도와 섞이지 않도록 뺀다.
function mergeChunks({ structured, previousCitedChunks = [], freshChunks = [], yearContext }) {
  const allowedBookYears = new Set(yearContext.bookYears);
  const previous = previousCitedChunks.filter((c) => c.bookYear == null || allowedBookYears.size === 0 || allowedBookYears.has(c.bookYear));
  const regulation = structured.regulation || [];
  const articleChunks = regulation.filter((c) => c.articleKey);
  const fresh = freshChunks.filter((c) => !duplicatesJudgedArticle(c, articleChunks));

  const merged = [];
  const seen = new Set();
  for (const c of [
    ...regulation,
    ...structured.graduation,
    ...structured.history,
    ...structured.curriculum,
    ...structured.requirement,
    ...structured.offering,
    ...structured.linkedMajor,
    ...structured.microDegree,
    ...previous,
    ...fresh,
  ]) {
    if (seen.has(c.chunkId)) continue;
    seen.add(c.chunkId);
    merged.push(c);
  }
  return merged;
}

module.exports = { assembleStructuredChunks, mergeChunks };
