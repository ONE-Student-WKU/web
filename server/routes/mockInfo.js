const express = require('express');
const router = express.Router();

/**
 * Routes for Academic Mock Data Query (/api/mock-info)
 */

// GET /api/mock-info/notices
router.get('/notices', async (req, res) => {
  // TODO: Fetch and return school notice board records.
  res.json({ notices: [] });
});

// GET /api/mock-info/courses
router.get('/courses', async (req, res) => {
  // TODO: Fetch registered courses for the current logged-in user session.
  res.json({ courses: [] });
});

// GET /api/mock-info/grades
router.get('/grades', async (req, res) => {
  // TODO: Fetch grade records for the current logged-in user session.
  res.json({ grades: [] });
});

module.exports = router;
