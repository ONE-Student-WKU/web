const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const graduationService = require('../services/graduationService');
const changeNoticeService = require('../services/changeNoticeService');

/**
 * Routes for graduation requirement diagnosis (/api/graduation)
 */

router.use(requireAuth);

// GET /api/graduation/status
router.get('/status', async (req, res, next) => {
  try {
    const data = await graduationService.getGraduationStatus(req.session.userId);
    // 바뀐 자료 알림(changeNoticeService.js) — 비교가 실패해도 진단은 그대로 보여 준다.
    data.changeNotice = await changeNoticeService.observe(req.session.userId, data).catch((err) => {
      console.error('[changeNotice] 비교 실패:', err.message);
      return null;
    });
    res.status(200).json({ status: 200, code: 'GRADUATION_STATUS_SUCCESS', message: null, data });
  } catch (err) {
    if (err.code === 'ONBOARDING_REQUIRED') {
      return res.status(400).json({ status: 400, code: 'ONBOARDING_REQUIRED', message: null, data: null });
    }
    next(err);
  }
});

// POST /api/graduation/change-notice/acknowledge — 알림을 확인하면 지금 결과가 다음 비교의 기준이 된다.
router.post('/change-notice/acknowledge', async (req, res, next) => {
  try {
    const acknowledged = await changeNoticeService.acknowledge(req.session.userId);
    res.status(200).json({ status: 200, code: 'CHANGE_NOTICE_ACKNOWLEDGED', message: null, data: { acknowledged } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
