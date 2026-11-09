const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const reviewService = require('../services/reviewService');
const { perUserLimiter } = require('../middleware/security');

/**
 * server/routes/reviews.js
 * 앱 안 후기 창 — 띄울지 묻기, 띄웠다고 기록하기, 후기 보내기. 띄우는 기준과 익명 저장은 services/reviewService.js.
 * 관리자 목록은 routes/admin.js의 GET /api/admin/reviews.
 */

router.use(requireAuth);

// GET /api/reviews/prompt — 지금 후기 창을 띄워도 되는가.
router.get('/prompt', async (req, res, next) => {
  try {
    const due = await reviewService.isPromptDue(req.session.userId);
    res.status(200).json({ status: 200, code: 'REVIEW_PROMPT', message: null, data: { due } });
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews/prompt/shown — 창을 띄웠다(띄울 때가 아니면 아무것도 바꾸지 않는다).
router.post('/prompt/shown', async (req, res, next) => {
  try {
    if (await reviewService.isPromptDue(req.session.userId)) await reviewService.markPromptShown(req.session.userId);
    res.status(200).json({ status: 200, code: 'REVIEW_PROMPT_SHOWN', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews — 후기 보내기. 같은 로그인에서 두 번은 받지 않는다(계정에는 보냈다는 기록을 따로 두지 않는다).
const reviewWriteLimiter = perUserLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

router.post('/', reviewWriteLimiter, async (req, res, next) => {
  try {
    const review = reviewService.parseReview(req.body);
    if (!review) {
      return res.status(400).json({ status: 400, code: 'INVALID_REVIEW', message: null, data: null });
    }
    if (req.session.reviewSubmitted) {
      return res.status(409).json({ status: 409, code: 'REVIEW_ALREADY_SENT', message: null, data: null });
    }
    const saved = await reviewService.submitReview(req.session.userId, review);
    if (!saved) {
      return res.status(409).json({ status: 409, code: 'REVIEW_NOT_PROMPTED', message: null, data: null });
    }
    req.session.reviewSubmitted = true;
    res.status(201).json({ status: 201, code: 'REVIEW_CREATED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
