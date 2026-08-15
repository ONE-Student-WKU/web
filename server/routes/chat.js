const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const embeddingClient = require('../services/embeddingClient');
const aiClient = require('../services/aiClient');
const regulationService = require('../services/regulationService');
const curriculumService = require('../services/curriculumService');
const studentService = require('../services/studentService');
const graduationService = require('../services/graduationService');

/**
 * Routes for Chat and AI Interactions (/api/chat)
 * 근거: 위키 API-설계 3장 - https://github.com/ONE-Student-wku/web/wiki/API-설계
 */

const NOT_FOUND_MESSAGE = '관련 규정을 찾지 못했어요. 학사지원과에 직접 확인해주세요.';
// AI 호출에 실어 보낼 최근 대화 이력 개수(비용/토큰 상한 목적). 대화가 길어질수록 이보다
// 오래된 turn은 컨텍스트에서 자연히 빠짐.
const HISTORY_LIMIT = 10;

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
    const [freshChunks, previousCitedChunks, student, graduationStatus] = await Promise.all([
      regulationService.findRelevantChunks(queryEmbedding),
      regulationService.findChunksByIds(lastAssistantMessage?.citedChunkIds),
      studentService.findById(req.session.userId),
      graduationService.getGraduationStatus(req.session.userId).catch(() => null),
    ]);

    // 교육과정(학년/학기별 과목 편성)은 RAG 유사도 검색이 아니라 curriculum_courses 조건
    // 조회로 처리한다 — "1학년 2학기에 뭐 있어?" 같은 나열형 질문은 top-K 유사도로는 일부
    // 과목이 누락되는 문제가 반복 확인되어서다. 원문 메시지(재작성 전)로 감지해야
    // 여러 턴에 걸친 검색어 재작성 과정에서 학년/학기가 뒤섞이는 문제를 피할 수 있다.
    const curriculumChunks = await curriculumService.lookupFromMessage(message, student);

    // 졸업인증제(기업연계프로젝트1/2 중 1과목 등)처럼 "N개 중 M개만 이수하면 충족"인 요건도
    // curriculum_courses와 같은 이유로 구조화 조회한다 — 정규화된 검색어(normalizedSearchQuery)를
    // 같이 넘겨서 "기연프" 같은 줄임말도 매칭되게 한다.
    const requirementChunks = await curriculumService.lookupRequirementsFromMessage(
      `${message} ${normalizedSearchQuery}`,
      student
    );

    // "2022년에 들을 수 있었던 과목" 같은 특정 연도 개설과목 질문도 curriculum_courses(편성
    // 계획)와 별개로 course_offerings(실제 개설 이력)를 구조화 조회해야 한다 — RAG 임베딩에는
    // 애초에 이 테이블이 들어가 있지 않아 그런 질문에 챗봇이 회피 답변하는 문제가 있었다.
    const offeringChunks = await curriculumService.lookupOfferingsFromMessage(message, student);

    // 직전 turn이 인용했던 근거를 이번 turn에도 유지 — "방금 답변 출처 알려줘" 같은 후속
    // 질문은 검색 쿼리가 미묘하게 달라져 다른(약한) 청크가 뽑히는 경우가 있는데, 그러면
    // 모델이 방금 그 근거를 못 찾겠다며 스스로 답을 부정하는 부작용이 생긴다.
    const relevantChunks = [...curriculumChunks, ...requirementChunks, ...offeringChunks, ...previousCitedChunks];
    for (const c of freshChunks) {
      if (!relevantChunks.some((m) => m.chunkId === c.chunkId)) relevantChunks.push(c);
    }

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

    const answer = await aiClient.getAIChatResponse(message, relevantChunks, history, student, graduationStatus);
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
