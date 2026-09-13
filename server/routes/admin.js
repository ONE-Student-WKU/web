const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const communityService = require('../services/communityService');
const pool = require('../db');

/**
 * server/routes/admin.js
 * 관리자 전용 API — 이번 단계는 커뮤니티 게시글 승인/반려/삭제와 활성 세션 수 통계만.
 * 화면(관리자 페이지)은 이 API 위에 나중에 얹는다(이슈 #164 4단계).
 */

router.use(requireAuth, requireAdmin);

// GET /api/admin/community/posts?status=pending
router.get('/community/posts', async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const posts = await communityService.listPostsForAdmin(status);
    res.status(200).json({ status: 200, code: 'ADMIN_POSTS_LIST', message: null, data: posts });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/community/posts/:id/approve
router.post('/community/posts/:id/approve', async (req, res, next) => {
  try {
    const decided = await communityService.decidePost(req.params.id, 'approved');
    if (!decided) {
      return res.status(404).json({ status: 404, code: 'POST_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'POST_APPROVED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/community/posts/:id/reject — reason은 선택.
router.post('/community/posts/:id/reject', async (req, res, next) => {
  try {
    const reason = typeof req.body.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : null;
    const decided = await communityService.decidePost(req.params.id, 'rejected', reason);
    if (!decided) {
      return res.status(404).json({ status: 404, code: 'POST_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'POST_REJECTED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/community/posts/:id — 대기/승인/반려 상태 무관하게 완전 삭제.
// 신청(community_applications)은 FK ON DELETE CASCADE로 같이 정리된다.
router.delete('/community/posts/:id', async (req, res, next) => {
  try {
    const deleted = await communityService.deletePost(req.params.id);
    if (!deleted) {
      return res.status(404).json({ status: 404, code: 'POST_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'POST_DELETED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/community/applications/:id — 신고된 신청 삭제(#187, 소유권 무관).
// FK ON DELETE CASCADE로 연결된 이메일 프록시(#182)도 같이 정리된다.
router.delete('/community/applications/:id', async (req, res, next) => {
  try {
    const deleted = await communityService.deleteApplication(req.params.id);
    if (!deleted) {
      return res.status(404).json({ status: 404, code: 'APPLICATION_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'APPLICATION_DELETED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/community/reports?status=pending
router.get('/community/reports', async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const reports = await communityService.listReportsForAdmin(status);
    res.status(200).json({ status: 200, code: 'ADMIN_REPORTS_LIST', message: null, data: reports });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/community/reports/:id/resolve — "처리완료" 표시(신고 자체를 지우진 않음).
router.post('/community/reports/:id/resolve', async (req, res, next) => {
  try {
    const resolved = await communityService.resolveReport(req.params.id);
    if (!resolved) {
      return res.status(404).json({ status: 404, code: 'REPORT_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'REPORT_RESOLVED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats — 현재 활성 세션 수(로그인 상태 유지 중인 사용자 수 근사치).
// sessions 테이블(express-mysql-session, PR #162)의 만료 안 된 행 개수를 그대로 셈 —
// 별도 계측 없이 기존 세션 저장소만 조회.
router.get('/stats', async (req, res, next) => {
  try {
    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) AS count FROM sessions WHERE expires > UNIX_TIMESTAMP()'
    );
    res.status(200).json({ status: 200, code: 'ADMIN_STATS', message: null, data: { activeSessions: count } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
