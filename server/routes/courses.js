const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const courseService = require('../services/courseService');

/**
 * Routes for course catalog (/api/courses)
 * 근거: 위키 API-설계 3.1 - https://github.com/ONE-Student-wku/web/wiki/API-설계
 */

// GET /api/courses/catalog?keyword=&year=&semester=
// year/semester로 그 학기에 실제 개설됐던 분반만 좁혀서 반환한다 — 카탈로그가 학기별
// 실제 개설 정보(course_offerings)라 과거 학기 검색도 지원됨(courseService.searchCatalog 참고).
router.get('/catalog', requireAuth, async (req, res, next) => {
  try {
    const { keyword, year, semester } = req.query;
    if (!year) return res.status(400).json({ status: 400, code: 'REQUIRED_YEAR', message: null, data: null });
    if (!semester) return res.status(400).json({ status: 400, code: 'REQUIRED_SEMESTER', message: null, data: null });

    const data = await courseService.searchCatalog(keyword, year, semester);
    res.status(200).json({ status: 200, code: 'CATALOG_SEARCH_SUCCESS', message: null, data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
