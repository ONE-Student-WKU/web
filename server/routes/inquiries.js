const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const inquiryService = require('../services/inquiryService');

/**
 * server/routes/inquiries.js
 * 문의하기(#166) — 버그/문제 제보, 커뮤니티와 무관한 범용 채널.
 * 관리자 조회/처리완료는 server/routes/admin.js에 있음(다른 admin 라우트와 동일 위치).
 */

router.use(requireAuth);

const TITLE_MAX_LENGTH = 50;
const CONTENT_MAX_LENGTH = 2000;

function isValidTitle(title) {
  return typeof title === 'string' && title.trim().length > 0 && title.trim().length <= TITLE_MAX_LENGTH;
}

function isValidContent(content) {
  return typeof content === 'string' && content.trim().length > 0 && content.trim().length <= CONTENT_MAX_LENGTH;
}

// POST /api/inquiries — 문의 작성.
router.post('/', async (req, res, next) => {
  try {
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : req.body.title;
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : req.body.content;
    if (!isValidTitle(title)) {
      return res.status(400).json({ status: 400, code: 'INVALID_TITLE', message: null, data: null });
    }
    if (!isValidContent(content)) {
      return res.status(400).json({ status: 400, code: 'INVALID_CONTENT', message: null, data: null });
    }

    const id = await inquiryService.createInquiry(req.session.userId, title, content);
    res.status(201).json({ status: 201, code: 'INQUIRY_CREATED', message: null, data: { id } });
  } catch (err) {
    next(err);
  }
});

// GET /api/inquiries/mine — 내가 쓴 문의 전체.
router.get('/mine', async (req, res, next) => {
  try {
    const inquiries = await inquiryService.listMyInquiries(req.session.userId);
    res.status(200).json({ status: 200, code: 'MY_INQUIRIES_LIST', message: null, data: inquiries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
