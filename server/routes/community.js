const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const communityService = require('../services/communityService');

/**
 * server/routes/community.js
 * 커뮤니티(스터디/프로젝트 모집) 게시판 — 학생용 글쓰기/목록/상세 (2단계).
 * 관리자 승인/반려/삭제는 server/routes/admin.js에 있음(1단계, 이 파일과 분리).
 */

router.use(requireAuth);

const TITLE_MAX_LENGTH = 100;

function isValidTitle(title) {
  return typeof title === 'string' && title.trim().length > 0 && title.trim().length <= TITLE_MAX_LENGTH;
}

function isValidBody(body) {
  return typeof body === 'string' && body.trim().length > 0;
}

// POST /api/community — 글 작성. 항상 status='pending'으로 시작(관리자 승인 전엔 비공개).
router.post('/', async (req, res, next) => {
  try {
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : req.body.title;
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : req.body.body;
    if (!isValidTitle(title)) {
      return res.status(400).json({ status: 400, code: 'INVALID_TITLE', message: null, data: null });
    }
    if (!isValidBody(body)) {
      return res.status(400).json({ status: 400, code: 'INVALID_BODY', message: null, data: null });
    }

    const id = await communityService.createPost(req.session.userId, { title, body });
    res.status(201).json({ status: 201, code: 'COMMUNITY_POST_CREATED', message: null, data: { id } });
  } catch (err) {
    next(err);
  }
});

// GET /api/community/mine — 내가 쓴 글 전부(상태 무관). "/:id"보다 먼저 등록해야
// "mine"이 :id 파라미터로 잘못 매칭되지 않는다.
router.get('/mine', async (req, res, next) => {
  try {
    const posts = await communityService.listMyPosts(req.session.userId);
    res.status(200).json({ status: 200, code: 'COMMUNITY_MY_POSTS', message: null, data: posts });
  } catch (err) {
    next(err);
  }
});

// GET /api/community — 승인된 글 목록(전체 공개).
router.get('/', async (req, res, next) => {
  try {
    const posts = await communityService.listApprovedPosts();
    res.status(200).json({ status: 200, code: 'COMMUNITY_POSTS_LIST', message: null, data: posts });
  } catch (err) {
    next(err);
  }
});

// GET /api/community/:id — 글 상세. 승인된 글이거나 본인 글이어야 조회 가능.
router.get('/:id', async (req, res, next) => {
  try {
    const post = await communityService.getPostById(req.params.id, { studentId: req.session.userId });
    if (!post) {
      return res.status(404).json({ status: 404, code: 'POST_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'COMMUNITY_POST_DETAIL', message: null, data: post });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
