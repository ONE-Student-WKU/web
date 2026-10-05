const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const embeddingClient = require('../services/embeddingClient');
const aiClient = require('../services/aiClient');
const regulationService = require('../services/regulationService');
const curriculumService = require('../services/curriculumService');
const studentService = require('../services/studentService');
const graduationService = require('../services/graduationService');
const { resolveYearContext } = require('../services/yearContext');
const { assembleStructuredChunks, mergeChunks } = require('../services/chatContextService');
const { lookupRegulationJudgment } = require('../services/regulationContextService');

/**
 * Routes for Chat and AI Interactions (/api/chat)
 * 근거: 위키 API-설계 3장 - https://github.com/ONE-Student-wku/web/wiki/API-설계
 */

const NOT_FOUND_MESSAGE = '관련 규정을 찾지 못했어요. 질문을 다르게 표현해보시거나, 관련 부서에 직접 확인해주세요.';
// AI 호출에 실어 보낼 최근 대화 이력 개수(비용/토큰 상한 목적). 대화가 길어질수록 이보다
// 오래된 turn은 컨텍스트에서 자연히 빠짐.
const HISTORY_LIMIT = 10;
// 사용자당 1일 채팅 한도(임베딩+Claude 호출 비용 상한 목적). 자정(서버 시각) 리셋.
const DAILY_MESSAGE_LIMIT = 20;

// "비공식 참고용" 문구는 화면에 고정으로 표시하기로 하고 시스템 프롬프트에서도 넣지 말라고
// 지시했는데, 예전 대화(이 문구가 이미 여러 번 등장한 이력)를 history로 넘기면 모델이 지시보다
// 자기 과거 답변 패턴을 더 강하게 따라가서 계속 반복하는 문제가 있었다. history에 넣기 전에
// DB에는 그대로 두고(과거 메시지 원본은 안 건드림) AI에 보내는 사본에서만 문구를 제거한다.
function stripDisclaimer(content) {
  return content
    .replace(/\n*[-—]{2,}\n*\*[^*\n]*비공식[^*\n]*\*\s*$/i, '')
    .replace(/\n*\*[^*\n]*비공식[^*\n]*\*\s*$/i, '')
    .trim();
}

router.use(requireAuth);

// GET /api/chat/conversations/current
// 가장 최근 대화(last_active_at 기준)를 반환, 없으면 새로 생성. 화면 렌더링에 필요한
// 메시지 이력도 같이 내려준다.
router.get('/conversations/current', async (req, res, next) => {
  try {
    const conversationId = await regulationService.findOrCreateCurrentConversation(req.session.userId);
    const messages = await regulationService.listMessages(conversationId);

    res.status(200).json({
      status: 200,
      code: 'CONVERSATION_SUCCESS',
      message: null,
      data: { conversationId, messages },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/messages
// 질문 임베딩 → regulation_chunks 코사인 유사도 검색 → Claude Haiku 4.5로 답변 생성 → 출처 포함 응답.
// 관련 청크를 하나도 못 찾으면 AI 호출 없이 바로 안내 문구를 반환한다.
router.post('/messages', async (req, res, next) => {
  try {
    const { conversationId, message } = req.body;

    if (!conversationId) return res.status(400).json({ status: 400, code: 'REQUIRED_CONVERSATION_ID', message: null, data: null });
    if (!message) return res.status(400).json({ status: 400, code: 'REQUIRED_MESSAGE', message: null, data: null });

    const conversation = await regulationService.findConversationById(req.session.userId, conversationId);
    if (!conversation) {
      return res.status(404).json({ status: 404, code: 'CONVERSATION_NOT_FOUND', message: null, data: null });
    }

    const todayMessageCount = await regulationService.countTodayUserMessages(req.session.userId);
    if (todayMessageCount >= DAILY_MESSAGE_LIMIT) {
      return res.status(429).json({
        status: 429,
        code: 'CHAT_DAILY_LIMIT_EXCEEDED',
        message: null,
        data: { limit: DAILY_MESSAGE_LIMIT },
      });
    }

    // 이번 메시지를 저장하기 전에 이전 이력을 먼저 읽어둔다 — AI에 대화 맥락(history)으로
    // 넘기고, "왜 그래?" 같은 후속 질문의 검색 쿼리에도 직전 질문을 살짝 얹어 맥락을 유지한다.
    const priorMessages = await regulationService.listMessages(conversationId);
    const history = priorMessages.slice(-HISTORY_LIMIT).map((m) => ({
      role: m.role,
      content: m.role === 'assistant' ? stripDisclaimer(m.content) : m.content,
    }));
    const lastUserMessage = [...priorMessages].reverse().find((m) => m.role === 'user');
    const lastAssistantMessage = [...priorMessages].reverse().find((m) => m.role === 'assistant');
    const searchQuery = lastUserMessage ? `${lastUserMessage.content}\n${message}` : message;

    await regulationService.saveMessage(conversationId, { role: 'user', content: message });

    // 검색 직전에 캐주얼한 표현(줄임말/은어)을 정식 학사 용어로 정규화 — 원문 문서엔 "겜콘" 같은
    // 표현이 없어서 그대로 임베딩하면 검색이 실패한다. 사용자에게 보여줄 답변이 아니라
    // 검색어로만 쓰이므로 원본 message는 그대로 DB에 저장하고 화면에도 그대로 남는다.
    const normalizedSearchQuery = await aiClient.rewriteSearchQuery(searchQuery);

    const queryEmbedding = await embeddingClient.getEmbedding(normalizedSearchQuery, 'query');
    // 온보딩 전이거나 학과 정보가 없으면 getGraduationStatus가 ONBOARDING_REQUIRED로 던지는데,
    // 이건 챗봇 전체를 막을 이유가 아니라 "이수 현황을 아직 모른다"는 정보일 뿐이라 null로 흡수한다.
    const [previousCitedChunks, student, graduationStatus, availableBookYears] = await Promise.all([
      regulationService.findChunksByIds(lastAssistantMessage?.citedChunkIds),
      studentService.findById(req.session.userId),
      graduationService.getGraduationStatus(req.session.userId).catch(() => null),
      regulationService.getAvailableBookYears(),
    ]);

    // 질문의 연도 해석은 여기서 한 번만 정하고 아래 모든 검색/조회가 같은 결과를 쓴다. 예전에는 조회 함수마다
    // 연도를 따로 읽어서(첫 연도만 읽거나, 학번과 학년도를 구분 못 하거나, 메시지 학번을 무시하는 등) 같은
    // 질문에서도 서로 다른 해의 자료가 섞였다(server/services/yearContext.js 참고).
    // 원문 메시지(재작성 전)로 판단해야 여러 턴에 걸친 검색어 재작성에서 연도가 뒤섞이지 않는다.
    const yearContext = resolveYearContext({
      message,
      previousUserMessage: lastUserMessage?.content ?? null,
      profileCohort: student?.admission_year ?? null,
      availableBookYears,
    });

    // 규정 판단(이 학생에게 기준일에 적용되는 규정·신뢰도)은 RAG 검색보다 먼저 정한다 — 판단 결과가 최우선 근거이고,
    // RAG가 같은 조문 원문을 또 가져오면 mergeChunks가 빼야 하므로 판단이 먼저 있어야 한다(chatContextService 주석, DECISIONS D-31).
    // 실패하면 null(챗봇은 계속 동작, 판단 근거만 빠짐).
    const regulationJudgment = await lookupRegulationJudgment({ message, student, yearContext });

    // 교육과정 구조화 조회(과목/요건/연도별 졸업요건/변경 이력)는 RAG 유사도 검색이 아니라 조건 조회로 처리한다 —
    // "1학년 2학기에 뭐 있어?" 같은 나열형 질문은 top-K 유사도로는 일부가 누락되고, 연도별 값은 유사도로 구분할 수 없다.
    // RAG는 학칙 같은 비정형 문서만 대상이며, 교육과정 책자 문서는 질문에서 정한 책자 학년도(yearContext.bookYears)만 검색한다.
    const isCompare = yearContext.mode === 'COMPARE';
    const [freshChunks, structured] = await Promise.all([
      regulationService.findRelevantChunks(queryEmbedding, {
        bookYears: yearContext.bookYears,
        topK: isCompare ? 7 : undefined,
        perYearMin: isCompare ? 2 : 0,
      }),
      assembleStructuredChunks({
        message,
        searchText: `${message} ${normalizedSearchQuery}`,
        student,
        previousUserMessage: lastUserMessage?.content ?? null,
        yearContext,
        regulationJudgment,
      }),
    ]);

    // 직전 turn이 인용했던 근거를 이번 turn에도 유지 — "방금 답변 출처 알려줘" 같은 후속
    // 질문은 검색 쿼리가 미묘하게 달라져 다른(약한) 청크가 뽑히는 경우가 있는데, 그러면
    // 모델이 방금 그 근거를 못 찾겠다며 스스로 답을 부정하는 부작용이 생긴다.
    const relevantChunks = mergeChunks({ structured, previousCitedChunks, freshChunks, yearContext });

    if (relevantChunks.length === 0) {
      await regulationService.saveMessage(conversationId, { role: 'assistant', content: NOT_FOUND_MESSAGE });
      await regulationService.touchConversation(conversationId);

      return res.status(200).json({
        status: 200,
        code: 'CHAT_MESSAGE_SUCCESS',
        message: null,
        data: { role: 'assistant', content: NOT_FOUND_MESSAGE },
      });
    }

    const answer = await aiClient.getAIChatResponse(message, relevantChunks, history, student, graduationStatus, yearContext);
    const citedChunks = relevantChunks.map((c) => ({
      chunkId: c.chunkId,
      documentTitle: c.documentTitle,
      excerpt: c.content.length > 150 ? `${c.content.slice(0, 150)}...` : c.content,
    }));

    await regulationService.saveMessage(conversationId, {
      role: 'assistant',
      content: answer,
      citedChunkIds: relevantChunks.map((c) => c.chunkId),
    });
    await regulationService.touchConversation(conversationId);

    return res.status(200).json({
      status: 200,
      code: 'CHAT_MESSAGE_SUCCESS',
      message: null,
      data: { role: 'assistant', content: answer, citedChunks },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
