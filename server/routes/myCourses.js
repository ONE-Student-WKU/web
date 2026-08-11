const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const courseService = require('../services/courseService');

/**
 * Routes for my registered courses (/api/my-courses)
 * 근거: 위키 API-설계 3.2, 3.3, 3.4 - https://github.com/wku-ai-chat/web/wiki/API-설계
 */

router.use(requireAuth);

// GET /api/my-courses/timetable?year=&semester=
router.get('/timetable', async (req, res, next) => {
  try {
    const { year, semester } = req.query;
    if (!year) return res.status(400).json({ status: 400, code: 'REQUIRED_YEAR', message: null, data: null });
    if (!semester) return res.status(400).json({ status: 400, code: 'REQUIRED_SEMESTER', message: null, data: null });

    const data = await courseService.getTimetable(req.session.userId, { year, semester });
    res.status(200).json({ status: 200, code: 'TIMETABLE_SUCCESS', message: null, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/my-courses/summary
router.get('/summary', async (req, res, next) => {
  try {
    const data = await courseService.getSummary(req.session.userId);
    res.status(200).json({ status: 200, code: 'GRADE_SUMMARY_SUCCESS', message: null, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/my-courses?year=&semester=
router.get('/', async (req, res, next) => {
  try {
    const { year, semester } = req.query;
    const data = await courseService.listMyCourses(req.session.userId, { year, semester });
    res.status(200).json({ status: 200, code: 'MY_COURSES_SUCCESS', message: null, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/my-courses
// 전공: { courseId, year, semester } - 카탈로그에서 검색·선택
// 교양/카탈로그에 없는 과목: { name, credits, category, year, semester } - 직접 입력
router.post('/', async (req, res, next) => {
  try {
    const { courseId, name, credits, category, year, semester } = req.body;

    if (!year) return res.status(400).json({ status: 400, code: 'REQUIRED_YEAR', message: null, data: null });
    if (!semester) return res.status(400).json({ status: 400, code: 'REQUIRED_SEMESTER', message: null, data: null });

    if (courseId) {
      const course = await courseService.findCourseById(courseId);
      if (!course) {
        return res.status(404).json({ status: 404, code: 'COURSE_NOT_FOUND', message: null, data: null });
      }
    } else {
      if (!name) return res.status(400).json({ status: 400, code: 'REQUIRED_NAME', message: null, data: null });
      if (!credits) return res.status(400).json({ status: 400, code: 'REQUIRED_CREDITS', message: null, data: null });
      if (!category) return res.status(400).json({ status: 400, code: 'REQUIRED_CATEGORY', message: null, data: null });
    }

    const id = await courseService.addMyCourse(req.session.userId, { courseId, name, credits, category, year, semester });
    return res.status(201).json({ status: 201, code: 'MY_COURSE_ADD_SUCCESS', message: null, data: { id } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ status: 409, code: 'COURSE_ALREADY_ADDED', message: null, data: null });
    }
    next(err);
  }
});

// PATCH /api/my-courses/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { letterGrade } = req.body;
    if (letterGrade !== undefined && !(letterGrade in courseService.GRADE_POINT_MAP)) {
      return res.status(400).json({ status: 400, code: 'INVALID_LETTER_GRADE', message: null, data: null });
    }

    const existing = await courseService.findMyCourseById(req.session.userId, req.params.id);
    if (!existing) {
      return res.status(404).json({ status: 404, code: 'MY_COURSE_NOT_FOUND', message: null, data: null });
    }

    await courseService.updateMyCourse(req.params.id, req.body);

    return res.status(200).json({
      status: 200,
      code: 'MY_COURSE_UPDATE_SUCCESS',
      message: null,
      data: { id: Number(req.params.id) },
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/my-courses/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await courseService.findMyCourseById(req.session.userId, req.params.id);
    if (!existing) {
      return res.status(404).json({ status: 404, code: 'MY_COURSE_NOT_FOUND', message: null, data: null });
    }

    await courseService.deleteMyCourse(req.params.id);
    return res.status(200).json({ status: 200, code: 'MY_COURSE_DELETE_SUCCESS', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
