const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { perUserLimiter } = require('../middleware/security');
const uiEventService = require('../services/uiEventService');

/**
 * server/routes/uiEvents.js
 * 기능 사용 횟수 받기(client/src/utils/track.js가 15초마다 모아 보낸다). 로그인한 요청만 받는 건 아무나 숫자를
 * 부풀리지 못하게 하려는 것이고, 학생 번호는 저장하지 않는다(services/uiEventService.js).
 */

router.use(requireAuth);

// 정상 사용이면 15초에 한 번 + 화면을 닫을 때 한 번이라 1분에 몇 번이면 된다.
const uiEventLimiter = perUserLimiter({ windowMs: 60 * 1000, max: 12 });

// POST /api/ui-events — { counts: { 'home.menu.courses': 2 }, devices: ['home.menu.courses'] }
router.post('/', uiEventLimiter, async (req, res, next) => {
  try {
    await uiEventService.recordEvents(uiEventService.normalizeEvents(req.body));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
