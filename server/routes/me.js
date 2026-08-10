const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const studentService = require('../services/studentService');

/**
 * Routes for the current logged-in student (/api/me)
 * 근거: 위키 API-설계 2.1 - https://github.com/wku-ai-chat/web/wiki/API-설계
 */

// GET /api/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const student = await studentService.findById(req.session.userId);
    if (!student) {
      return res.status(401).json({ status: 401, code: 'UNAUTHORIZED', message: null, data: null });
    }

    return res.status(200).json({
      status: 200,
      code: 'ME_SUCCESS',
      message: null,
      data: {
        id: student.id,
        name: student.name,
        department: student.department_name,
        onboardingCompleted: !!student.onboarding_completed_at,
        admissionYear: student.admission_year,
        enrollmentType: student.enrollment_type,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
