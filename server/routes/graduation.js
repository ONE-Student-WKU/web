const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const graduationService = require('../services/graduationService');

/**
 * Routes for graduation requirement diagnosis (/api/graduation)
 */

router.use(requireAuth);

// GET /api/graduation/status
router.get('/status', async (req, res, next) => {
  try {
    const data = await graduationService.getGraduationStatus(req.session.userId);
    res.status(200).json({ status: 200, code: 'GRADUATION_STATUS_SUCCESS', message: null, data });
  } catch (err) {
    if (err.code === 'ONBOARDING_REQUIRED') {
      return res.status(400).json({ status: 400, code: 'ONBOARDING_REQUIRED', message: null, data: null });
    }
    next(err);
  }
});

module.exports = router;
