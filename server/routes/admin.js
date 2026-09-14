const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const communityService = require('../services/communityService');
const inquiryService = require('../services/inquiryService');
const studentService = require('../services/studentService');
const sanctionService = require('../services/sanctionService');
const pool = require('../db');

/**
 * server/routes/admin.js
 * 관리자 전용 API — 커뮤니티 게시글/신고 승인·반려·삭제(#164, #187), 문의함(#166),
 * 대시보드 통계.
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

// POST /api/admin/community/reports/:id/resolve — "반려"(조치 없이 신고만 처리완료).
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

const SANCTION_SCOPES = ['post_apply', 'full'];
// null = 영구정지.
const SANCTION_DURATIONS = { '1d': 1, '3d': 3, '7d': 7, '30d': 30, permanent: null };

// POST /api/admin/community/reports/:id/sanction — "제재"(#201). 신고 대상 계정에 정지를
// 걸고, 신고된 글/신청을 실제로 삭제하고(이미 지워졌으면 조용히 건너뜀), 신고를
// 처리완료로 표시한다 — 세 가지가 한 번의 조치로 묶여야 신고함에 "제재는 걸었는데
// 글은 안 지워짐" 같은 어중간한 상태가 안 남는다.
router.post('/community/reports/:id/sanction', async (req, res, next) => {
  try {
    const { scope, duration, reason } = req.body;
    if (!SANCTION_SCOPES.includes(scope)) {
      return res.status(400).json({ status: 400, code: 'INVALID_SCOPE', message: null, data: null });
    }
    if (!Object.prototype.hasOwnProperty.call(SANCTION_DURATIONS, duration)) {
      return res.status(400).json({ status: 400, code: 'INVALID_DURATION', message: null, data: null });
    }
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmedReason) {
      return res.status(400).json({ status: 400, code: 'REQUIRED_REASON', message: null, data: null });
    }

    const report = await communityService.getReportById(req.params.id);
    if (!report) {
      return res.status(404).json({ status: 404, code: 'REPORT_NOT_FOUND', message: null, data: null });
    }
    // 스냅샷 컬럼 도입 전에 접수된 구버전 신고는 신고 대상 id가 없어서 제재할 계정을
    // 특정할 수 없다 — 이 경우 그냥 "반려" 경로를 쓰라고 안내.
    if (!report.reportedStudentId) {
      return res.status(400).json({ status: 400, code: 'NO_REPORTED_STUDENT', message: null, data: null });
    }

    await sanctionService.createSanction({
      studentId: report.reportedStudentId,
      reason: trimmedReason,
      scope,
      durationDays: SANCTION_DURATIONS[duration],
      createdBy: req.session.userId,
      reportId: report.id,
    });

    if (report.targetType === 'post') await communityService.deletePost(report.targetId);
    else await communityService.deleteApplication(report.targetId);

    await communityService.resolveReport(report.id);
    res.status(200).json({ status: 200, code: 'REPORT_SANCTIONED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/sanctions — 현재 유효한(해제 안 됐고 기간이 안 지난) 제재 전체.
router.get('/sanctions', async (req, res, next) => {
  try {
    const sanctions = await sanctionService.listActiveSanctions();
    res.status(200).json({ status: 200, code: 'ADMIN_SANCTIONS_LIST', message: null, data: sanctions });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/sanctions/:id/lift — 조기 해제.
router.post('/sanctions/:id/lift', async (req, res, next) => {
  try {
    const lifted = await sanctionService.liftSanction(req.params.id);
    if (!lifted) {
      return res.status(404).json({ status: 404, code: 'SANCTION_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'SANCTION_LIFTED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/inquiries?status=open
router.get('/inquiries', async (req, res, next) => {
  try {
    const status = req.query.status || 'open';
    const inquiries = await inquiryService.listInquiriesForAdmin(status);
    res.status(200).json({ status: 200, code: 'ADMIN_INQUIRIES_LIST', message: null, data: inquiries });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/inquiries/:id/resolve
router.post('/inquiries/:id/resolve', async (req, res, next) => {
  try {
    const resolved = await inquiryService.resolveInquiry(req.params.id);
    if (!resolved) {
      return res.status(404).json({ status: 404, code: 'INQUIRY_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'INQUIRY_RESOLVED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats — 관리자 대시보드 상단 통계. activeSessions는 "현재 접속자"
// (최근 5분 내 요청이 있었던 계정 수 — student_activity, middleware/activityTracker.js).
// 원래 sessions 테이블(express-mysql-session)의 만료 안 된 행 개수를 그대로 셌는데, 로그인
// 유지 기간이 30일이라 실제 접속 여부와 무관하게 값이 크게 부풀려지는 문제가 있었다(실사용
// 확인 — 접속자가 1~3명뿐인데 8로 표시됨). totalStudents는 가입 계정 수(studentService.countAll).
router.get('/stats', async (req, res, next) => {
  try {
    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) AS count FROM student_activity WHERE last_seen_at > NOW() - INTERVAL 5 MINUTE'
    );
    const totalStudents = await studentService.countAll();
    res.status(200).json({
      status: 200,
      code: 'ADMIN_STATS',
      message: null,
      data: { activeSessions: count, totalStudents },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
