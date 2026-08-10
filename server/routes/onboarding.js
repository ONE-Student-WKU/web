const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const studentService = require('../services/studentService');

/**
 * Routes for Onboarding (/api/onboarding)
 * 근거: 위키 API-설계 1.3 - https://github.com/wku-ai-chat/web/wiki/API-설계
 */

const VALID_ENROLLMENT_TYPES = ['GENERAL', 'TRANSFER_ADMISSION', 'MAJOR_CHANGE'];

// GET /api/onboarding/departments
router.get('/departments', async (req, res, next) => {
  try {
    const departments = await studentService.listDepartments();
    res.status(200).json({ status: 200, code: 'DEPARTMENTS_SUCCESS', message: null, data: departments });
  } catch (err) {
    next(err);
  }
});

// POST /api/onboarding
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { departmentId, admissionYear, enrollmentType } = req.body;

    if (!departmentId) return res.status(400).json({ status: 400, code: 'REQUIRED_DEPARTMENT_ID', message: null, data: null });
    if (!admissionYear) return res.status(400).json({ status: 400, code: 'REQUIRED_ADMISSION_YEAR', message: null, data: null });
    if (!enrollmentType) return res.status(400).json({ status: 400, code: 'REQUIRED_ENROLLMENT_TYPE', message: null, data: null });
    if (!VALID_ENROLLMENT_TYPES.includes(enrollmentType)) {
      return res.status(400).json({ status: 400, code: 'INVALID_ENROLLMENT_TYPE', message: null, data: null });
    }

    const student = await studentService.findById(req.session.userId);
    if (student.onboarding_completed_at) {
      return res.status(409).json({ status: 409, code: 'ONBOARDING_ALREADY_COMPLETED', message: null, data: null });
    }

    await studentService.completeOnboarding(req.session.userId, { departmentId, admissionYear, enrollmentType });

    return res.status(200).json({
      status: 200,
      code: 'ONBOARDING_SUCCESS',
      message: null,
      data: { departmentId, admissionYear, enrollmentType },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
