const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const studentService = require('../services/studentService');

/**
 * Routes for Authentication (/api/auth)
 * 근거: 위키 API-설계 1장 - https://github.com/ONE-Student-wku/web/wiki/API-설계
 */

const BCRYPT_ROUNDS = 10;

// POST /api/auth/signup
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (!email) return res.status(400).json({ status: 400, code: 'REQUIRED_EMAIL', message: null, data: null });
    if (!password) return res.status(400).json({ status: 400, code: 'REQUIRED_PASSWORD', message: null, data: null });
    if (!name) return res.status(400).json({ status: 400, code: 'REQUIRED_NAME', message: null, data: null });

    const existing = await studentService.findByEmail(email);
    if (existing) {
      return res.status(409).json({ status: 409, code: 'EMAIL_ALREADY_EXISTS', message: null, data: null });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const id = await studentService.createStudent({ email, passwordHash, name });

    return res.status(201).json({
      status: 201,
      code: 'SIGNUP_SUCCESS',
      message: null,
      data: { id, email, name, onboardingCompleted: false },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const student = await studentService.findByEmail(email);
    const passwordMatches = student ? await bcrypt.compare(password || '', student.password) : false;

    if (!student || !passwordMatches) {
      return res.status(401).json({ status: 401, code: 'INVALID_CREDENTIALS', message: null, data: null });
    }

    req.session.userId = student.id;

    return res.status(200).json({
      status: 200,
      code: 'LOGIN_SUCCESS',
      message: null,
      data: {
        id: student.id,
        email: student.email,
        name: student.name,
        onboardingCompleted: !!student.onboarding_completed_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.status(200).json({ status: 200, code: 'LOGOUT_SUCCESS', message: null, data: null });
  });
});

module.exports = router;
