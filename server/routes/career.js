const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const careerService = require('../services/careerService');
const studentService = require('../services/studentService');

/**
 * Routes for 진로 탐색 (상담형) — /api/career
 * 고정 질문 → 자유 대화 → 진로 후보 → 확정/로드맵 흐름을 세션 단위로 다룬다.
 */

router.use(requireAuth);

// 학과 정보가 없으면 커리큘럼 기반 로드맵을 만들 수 없어 온보딩부터 요구한다
// (graduationService.getGraduationStatus의 ONBOARDING_REQUIRED와 동일한 패턴).
async function requireOnboardedStudent(req, res) {
  const student = await studentService.findById(req.session.userId);
  if (!student || !student.department_id) {
    res.status(400).json({ status: 400, code: 'ONBOARDING_REQUIRED', message: null, data: null });
    return null;
  }
  return student;
}

// GET /api/career/sessions/latest
router.get('/sessions/latest', async (req, res, next) => {
  try {
    const detail = await careerService.getLatestSessionDetail(req.session.userId);
    res.status(200).json({ status: 200, code: 'CAREER_SESSION_SUCCESS', message: null, data: detail });
  } catch (err) {
    next(err);
  }
});

// GET /api/career/roadmap/latest — "다시 진단하기"로 새 세션을 시작해도, 가장 최근에
// 확정했던 진로/로드맵을 세션 상태와 무관하게 다시 볼 수 있게 한다(Profile.jsx에서 사용).
router.get('/roadmap/latest', async (req, res, next) => {
  try {
    const result = await careerService.getLatestConfirmedRoadmap(req.session.userId);
    res.status(200).json({ status: 200, code: 'CAREER_ROADMAP_SUCCESS', message: null, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/career/sessions/:id
router.get('/sessions/:id', async (req, res, next) => {
  try {
    const detail = await careerService.getSessionDetail(req.session.userId, req.params.id);
    if (!detail) return res.status(404).json({ status: 404, code: 'CAREER_SESSION_NOT_FOUND', message: null, data: null });
    res.status(200).json({ status: 200, code: 'CAREER_SESSION_SUCCESS', message: null, data: detail });
  } catch (err) {
    next(err);
  }
});

// POST /api/career/sessions — 새 상담 세션 시작 (다시 진단하기 포함)
router.post('/sessions', async (req, res, next) => {
  try {
    const student = await requireOnboardedStudent(req, res);
    if (!student) return;

    const id = await careerService.createSession(req.session.userId);
    res.status(201).json({ status: 201, code: 'CAREER_SESSION_CREATED', message: null, data: { id } });
  } catch (err) {
    next(err);
  }
});

// POST /api/career/sessions/:id/fixed-answers
router.post('/sessions/:id/fixed-answers', async (req, res, next) => {
  try {
    const { fixedAnswers } = req.body;
    if (!Array.isArray(fixedAnswers) || fixedAnswers.length === 0) {
      return res.status(400).json({ status: 400, code: 'REQUIRED_FIXED_ANSWERS', message: null, data: null });
    }

    const student = await requireOnboardedStudent(req, res);
    if (!student) return;

    const messages = await careerService.submitFixedAnswers(req.session.userId, req.params.id, fixedAnswers, student);
    res.status(200).json({ status: 200, code: 'CAREER_FIXED_ANSWERS_SUCCESS', message: null, data: { messages } });
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({ status: 404, code: err.code, message: null, data: null });
    }
    next(err);
  }
});

// PATCH /api/career/sessions/:id/fixed-answers — 채팅 시작 후 처음 답변 수정 (AI 재호출 없음,
// 이미 나눈 대화는 그대로 두고 다음 대화부터 반영)
router.patch('/sessions/:id/fixed-answers', async (req, res, next) => {
  try {
    const { fixedAnswers } = req.body;
    if (!Array.isArray(fixedAnswers) || fixedAnswers.length === 0) {
      return res.status(400).json({ status: 400, code: 'REQUIRED_FIXED_ANSWERS', message: null, data: null });
    }

    const messages = await careerService.updateFixedAnswers(req.session.userId, req.params.id, fixedAnswers);
    res.status(200).json({ status: 200, code: 'CAREER_FIXED_ANSWERS_UPDATED', message: null, data: { messages } });
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND' || err.code === 'FIXED_ANSWERS_NOT_FOUND') {
      return res.status(404).json({ status: 404, code: err.code, message: null, data: null });
    }
    next(err);
  }
});

// POST /api/career/sessions/:id/messages — 자유 대화 한 턴
router.post('/sessions/:id/messages', async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ status: 400, code: 'REQUIRED_CONTENT', message: null, data: null });

    const student = await requireOnboardedStudent(req, res);
    if (!student) return;

    const messages = await careerService.postMessage(req.session.userId, req.params.id, content, student);
    res.status(200).json({ status: 200, code: 'CAREER_MESSAGE_SUCCESS', message: null, data: { messages } });
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({ status: 404, code: err.code, message: null, data: null });
    }
    next(err);
  }
});

// POST /api/career/sessions/:id/candidates — 대화 종합해 진로 후보 생성
router.post('/sessions/:id/candidates', async (req, res, next) => {
  try {
    const student = await requireOnboardedStudent(req, res);
    if (!student) return;

    const candidates = await careerService.generateCandidates(req.session.userId, req.params.id, student);
    res.status(200).json({ status: 200, code: 'CAREER_CANDIDATES_SUCCESS', message: null, data: { candidates } });
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({ status: 404, code: err.code, message: null, data: null });
    }
    if (err.code === 'CAREER_CANDIDATES_EMPTY') {
      return res.status(502).json({ status: 502, code: err.code, message: null, data: null });
    }
    next(err);
  }
});

// POST /api/career/sessions/:id/confirm — 진로 확정 + 로드맵 생성
router.post('/sessions/:id/confirm', async (req, res, next) => {
  try {
    const { careerName } = req.body;
    if (!careerName) return res.status(400).json({ status: 400, code: 'REQUIRED_CAREER_NAME', message: null, data: null });

    const student = await requireOnboardedStudent(req, res);
    if (!student) return;

    const roadmap = await careerService.confirmCareer(req.session.userId, req.params.id, careerName, student);
    res.status(200).json({ status: 200, code: 'CAREER_CONFIRM_SUCCESS', message: null, data: { roadmap, confirmedCareer: careerName } });
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND' || err.code === 'CAREER_CANDIDATE_NOT_FOUND') {
      return res.status(404).json({ status: 404, code: err.code, message: null, data: null });
    }
    next(err);
  }
});

module.exports = router;
