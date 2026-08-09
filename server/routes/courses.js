const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const courseService = require('../services/courseService');

/**
 * Routes for course catalog (/api/courses)
 * 근거: docs/API-설계.md 3.1
 */

// GET /api/courses/catalog?keyword=
router.get('/catalog', requireAuth, async (req, res, next) => {
  try {
    const { keyword } = req.query;
    const data = await courseService.searchCatalog(keyword);
    res.status(200).json({ status: 200, code: 'CATALOG_SEARCH_SUCCESS', message: null, data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
