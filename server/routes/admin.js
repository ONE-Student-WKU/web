const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const communityService = require('../services/communityService');
const inquiryService = require('../services/inquiryService');
const studentService = require('../services/studentService');
const sanctionService = require('../services/sanctionService');
const reportedStudentService = require('../services/reportedStudentService');
const adminStatsService = require('../services/adminStatsService');
const uiEventService = require('../services/uiEventService');
const noticeService = require('../services/noticeService');

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

// 커뮤니티 공지(services/noticeService.js) — 관리자가 바로 게시한다(승인 절차 없음). 목록은 학생과 같은 GET /api/community/notices.
// POST /api/admin/community/notices — { title, body }
router.post('/community/notices', async (req, res, next) => {
  try {
    const input = noticeService.normalizeNoticeInput(req.body);
    if (!input) return res.status(400).json({ status: 400, code: 'INVALID_NOTICE', message: null, data: null });
    const id = await noticeService.createNotice(req.session.userId, input);
    res.status(201).json({ status: 201, code: 'NOTICE_CREATED', message: null, data: { id } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/community/notices/:id — { title, body }
router.put('/community/notices/:id', async (req, res, next) => {
  try {
    const input = noticeService.normalizeNoticeInput(req.body);
    if (!input) return res.status(400).json({ status: 400, code: 'INVALID_NOTICE', message: null, data: null });
    const updated = await noticeService.updateNotice(req.params.id, input);
    if (!updated) return res.status(404).json({ status: 404, code: 'NOTICE_NOT_FOUND', message: null, data: null });
    res.status(200).json({ status: 200, code: 'NOTICE_UPDATED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/community/notices/:id
router.delete('/community/notices/:id', async (req, res, next) => {
  try {
    const deleted = await noticeService.deleteNotice(req.params.id);
    if (!deleted) return res.status(404).json({ status: 404, code: 'NOTICE_NOT_FOUND', message: null, data: null });
    res.status(200).json({ status: 200, code: 'NOTICE_DELETED', message: null, data: null });
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
    if (reason && reason.length > 500) {
      return res.status(400).json({ status: 400, code: 'INVALID_REASON', message: null, data: null });
    }
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

// 신고자·문의자에게 보여줄 처리 안내(선택) 최대 길이.
const RESOLUTION_NOTE_MAX_LENGTH = 500;

// 선택 입력 — 문자열이 아니면(undefined/null 포함) 없는 것으로 보고, 너무 길면 거부한다(ok:false).
function normalizeResolutionNote(note) {
  if (note === undefined || note === null) return { ok: true, value: null };
  if (typeof note !== 'string') return { ok: false, value: null };
  const trimmed = note.trim();
  if (trimmed.length > RESOLUTION_NOTE_MAX_LENGTH) return { ok: false, value: null };
  return { ok: true, value: trimmed || null };
}

// POST /api/admin/community/reports/:id/resolve — "조치 없이 처리"(신고만 처리완료). body.note(선택)는 신고자에게 보이는 처리 안내.
// 같은 글·신청에 들어온 다른 대기 신고도 함께 처리완료가 된다(관리자 신고함은 대상별로 묶어 한 번에 처리한다).
router.post('/community/reports/:id/resolve', async (req, res, next) => {
  try {
    const note = normalizeResolutionNote(req.body?.note);
    if (!note.ok) {
      return res.status(400).json({ status: 400, code: 'INVALID_RESOLUTION_NOTE', message: null, data: null });
    }
    const report = await communityService.getReportById(req.params.id);
    const resolved = report && (await communityService.resolveReport(report.id, note.value));
    if (!resolved) {
      return res.status(404).json({ status: 404, code: 'REPORT_NOT_FOUND', message: null, data: null });
    }
    const others = await communityService.resolvePendingReportsForTarget(report.targetType, report.targetId, note.value);
    res.status(200).json({ status: 200, code: 'REPORT_RESOLVED', message: null, data: { resolvedCount: 1 + others } });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/community/students/:id/summary — 신고함에서 신고 대상자를 눌렀을 때 보는 요약(읽기 전용).
// 실제 이메일·학번 전체 등은 내려주지 않는다(reportedStudentService 주석). requireAdmin은 위 router.use에서 이미 통과.
router.get('/community/students/:id/summary', async (req, res, next) => {
  try {
    const studentId = Number(req.params.id);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(404).json({ status: 404, code: 'STUDENT_NOT_FOUND', message: null, data: null });
    }
    const summary = await reportedStudentService.getReportedStudentSummary(studentId);
    if (!summary) {
      return res.status(404).json({ status: 404, code: 'STUDENT_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'ADMIN_REPORTED_STUDENT_SUMMARY', message: null, data: summary });
  } catch (err) {
    next(err);
  }
});

const SANCTION_SCOPES = ['post_apply', 'full'];
// null = 영구정지.
const SANCTION_DURATIONS = { '1d': 1, '3d': 3, '7d': 7, '30d': 30, permanent: null };

// 제재 요청 본문(범위·기간·사유) 검증 — 신고함 제재와 글에서 바로 거는 제재가 같은 규칙을 쓴다. 문제가 있으면 { error: 코드 }.
function parseSanctionInput(body) {
  const { scope, duration, reason } = body || {};
  if (!SANCTION_SCOPES.includes(scope)) return { error: 'INVALID_SCOPE' };
  if (!Object.prototype.hasOwnProperty.call(SANCTION_DURATIONS, duration)) return { error: 'INVALID_DURATION' };
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmedReason) return { error: 'REQUIRED_REASON' };
  return { scope, durationDays: SANCTION_DURATIONS[duration], reason: trimmedReason };
}

// POST /api/admin/community/reports/:id/sanction — "제재"(#201). 신고 대상 계정에 정지를
// 걸고, 신고된 글/신청을 실제로 삭제하고(이미 지워졌으면 조용히 건너뜀), 신고를
// 처리완료로 표시한다 — 세 가지가 한 번의 조치로 묶여야 신고함에 "제재는 걸었는데
// 글은 안 지워짐" 같은 어중간한 상태가 안 남는다.
router.post('/community/reports/:id/sanction', async (req, res, next) => {
  try {
    const input = parseSanctionInput(req.body);
    if (input.error) {
      return res.status(400).json({ status: 400, code: input.error, message: null, data: null });
    }
    // 신고자에게 보이는 처리 안내(선택). 제재 사유(제재받는 사용자에게 보임)와 별개의 값이다.
    const resolutionNote = normalizeResolutionNote(req.body.resolutionNote);
    if (!resolutionNote.ok) {
      return res.status(400).json({ status: 400, code: 'INVALID_RESOLUTION_NOTE', message: null, data: null });
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
      reason: input.reason,
      scope: input.scope,
      durationDays: input.durationDays,
      createdBy: req.session.userId,
      reportId: report.id,
    });

    if (report.targetType === 'post') await communityService.deletePost(report.targetId);
    else await communityService.deleteApplication(report.targetId);

    await communityService.resolveReport(report.id, resolutionNote.value);
    // 같은 대상의 다른 대기 신고도 같은 안내로 처리완료(대상 글·신청은 이미 지워졌다).
    const others = await communityService.resolvePendingReportsForTarget(report.targetType, report.targetId, resolutionNote.value);
    res.status(200).json({ status: 200, code: 'REPORT_SANCTIONED', message: null, data: { resolvedCount: 1 + others } });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/community/students/:id/sanction — 신고 없이 직접 거는 제재(커뮤니티 글에서 작성자를 눌러 바로 조치).
// 신고함 제재와 달리 글/신청을 지우거나 신고를 처리완료로 바꾸는 부수 효과는 없다 — 글은 승인·삭제 흐름으로 관리자가 따로 다룬다.
// 관리자 계정은 대상이 될 수 없다: 본인이나 다른 관리자를 실수로 눌러 커뮤니티에서 막히는 일을 서버에서 막는다.
router.post('/community/students/:id/sanction', async (req, res, next) => {
  try {
    const studentId = Number(req.params.id);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(404).json({ status: 404, code: 'STUDENT_NOT_FOUND', message: null, data: null });
    }
    const input = parseSanctionInput(req.body);
    if (input.error) {
      return res.status(400).json({ status: 400, code: input.error, message: null, data: null });
    }

    const target = await studentService.findById(studentId);
    if (!target) {
      return res.status(404).json({ status: 404, code: 'STUDENT_NOT_FOUND', message: null, data: null });
    }
    if (target.role === 'admin') {
      return res.status(400).json({ status: 400, code: 'CANNOT_SANCTION_ADMIN', message: null, data: null });
    }

    await sanctionService.createSanction({
      studentId,
      reason: input.reason,
      scope: input.scope,
      durationDays: input.durationDays,
      createdBy: req.session.userId,
    });
    res.status(200).json({ status: 200, code: 'STUDENT_SANCTIONED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/sanctions?status=active|past — active: 지금 유효한(해제 안 됐고 기간이 안 지난) 제재 전체,
// past: 해제됐거나 기간이 끝난 제재(최근 것부터 100건).
router.get('/sanctions', async (req, res, next) => {
  try {
    const status = req.query.status || 'active';
    if (status !== 'active' && status !== 'past') {
      return res.status(400).json({ status: 400, code: 'INVALID_STATUS', message: null, data: null });
    }
    const sanctions = status === 'past' ? await sanctionService.listPastSanctions() : await sanctionService.listActiveSanctions();
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

// POST /api/admin/inquiries/:id/resolve — body.note(선택)는 문의자에게 보이는 처리 답변(신고 처리 안내와 같은 검증).
router.post('/inquiries/:id/resolve', async (req, res, next) => {
  try {
    const note = normalizeResolutionNote(req.body?.note);
    if (!note.ok) {
      return res.status(400).json({ status: 400, code: 'INVALID_RESOLUTION_NOTE', message: null, data: null });
    }
    const resolved = await inquiryService.resolveInquiry(req.params.id, note.value);
    if (!resolved) {
      return res.status(404).json({ status: 404, code: 'INQUIRY_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'INQUIRY_RESOLVED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/pending — 처리할 일 건수만(계정 메뉴의 빨간 점). 대시보드 통계 전체를 부르지 않고 대기열 COUNT 세 개만 센다.
router.get('/pending', async (req, res, next) => {
  try {
    const pending = await adminStatsService.getPendingCounts();
    res.status(200).json({ status: 200, code: 'ADMIN_PENDING', message: null, data: pending });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats — 관리자 대시보드 통계(집계는 services/adminStatsService.js: 처리 대기 건수(뱃지)와 최근 24시간 운영 지표).
// activeSessions는 "현재 접속자"
// (최근 5분 내 요청이 있었던 계정 수 — student_activity, middleware/activityTracker.js).
// 원래 sessions 테이블(express-mysql-session)의 만료 안 된 행 개수를 그대로 셌는데, 로그인
// 유지 기간이 30일이라 실제 접속 여부와 무관하게 값이 크게 부풀려지는 문제가 있었다(실사용
// 확인 — 접속자가 1~3명뿐인데 8로 표시됨). totalStudents는 실제 가입 수(studentService.excludeLegacyTestAccounts(countAll()) —
// 옛 로그인 폼 시절의 테스트 계정 수를 뺀 값).
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await adminStatsService.getDashboardStats();
    const totalStudents = studentService.excludeLegacyTestAccounts(await studentService.countAll());
    res.status(200).json({ status: 200, code: 'ADMIN_STATS', message: null, data: { ...stats, totalStudents } });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats/trend?range=24h|7d|30d|1y|all — 대시보드 지표(방문자·신규 가입·챗봇 질문·근거 못 찾은 답변)의 추이(그래프 화면용).
// 24h는 1시간 단위, 나머지는 하루 단위(services/adminStatsService.js getTrend).
router.get('/stats/trend', async (req, res, next) => {
  try {
    const range = req.query.range || '24h';
    if (!adminStatsService.isTrendRange(range)) {
      return res.status(400).json({ status: 400, code: 'INVALID_RANGE', message: null, data: null });
    }
    const trend = await adminStatsService.getTrend(range);
    res.status(200).json({ status: 200, code: 'ADMIN_STATS_TREND', message: null, data: trend });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats/composition — 학과·학번별 가입자와 최근 7일 방문자(학교에 보여줄 이용 현황). 5명 미만 칸은 "기타"로 묶는다.
router.get('/stats/composition', async (req, res, next) => {
  try {
    const composition = await adminStatsService.getComposition();
    res.status(200).json({ status: 200, code: 'ADMIN_STATS_COMPOSITION', message: null, data: composition });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stats/features?range=7d|30d|all — 기능 사용 횟수(화면·버튼별 합계, 누가 썼는지는 없음 — services/uiEventService.js).
router.get('/stats/features', async (req, res, next) => {
  try {
    const range = req.query.range || '7d';
    if (!uiEventService.isUsageRange(range)) {
      return res.status(400).json({ status: 400, code: 'INVALID_RANGE', message: null, data: null });
    }
    const usage = await uiEventService.getUsage(range);
    res.status(200).json({ status: 200, code: 'ADMIN_STATS_FEATURES', message: null, data: usage });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
