const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const courseService = require('../services/courseService');
const studentService = require('../services/studentService');

/**
 * Routes for course catalog (/api/courses)
 * 근거: 위키 API-설계 3.1 - https://github.com/ONE-Student-wku/web/wiki/API-설계
 */

// GET /api/courses/catalog?keyword=&year=&semester=
// year/semester로 그 학기에 실제 개설됐던 분반만 좁혀서 반환한다(내 학과 과목 먼저) — 카탈로그가 학기별
// 실제 개설 정보(course_offerings)라 과거 학기 검색도 지원됨(courseService.searchCatalog 참고).
router.get('/catalog', requireAuth, async (req, res, next) => {
  try {
    const { keyword, year, semester } = req.query;
    if (!year) return res.status(400).json({ status: 400, code: 'REQUIRED_YEAR', message: null, data: null });
    if (!semester) return res.status(400).json({ status: 400, code: 'REQUIRED_SEMESTER', message: null, data: null });

    // 내 학과(세부전공·통폐합 전후 학과)·제2전공 과목을 같은 일치 정도 안에서 앞에 둔다. 학생 정보를 못 읽으면 기존 순서 그대로.
    const student = await studentService.findById(req.session.userId).catch(() => null);
    const scope = await courseService.catalogScopeFor(student).catch(() => null);
    const data = await courseService.searchCatalog(keyword, year, semester, scope);
    res.status(200).json({ status: 200, code: 'CATALOG_SEARCH_SUCCESS', message: null, data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
