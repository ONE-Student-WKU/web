const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireNotFullySanctioned, requireNotWritingSanctioned } = require('../middleware/sanction');
const communityService = require('../services/communityService');
const sanctionService = require('../services/sanctionService');

/**
 * server/routes/community.js
 * 커뮤니티(스터디/프로젝트 모집) 게시판 — 학생용 글쓰기/목록/상세(2단계) +
 * 신청/수락·반려/모집마감/수정·삭제(3단계).
 * 관리자 승인/반려/삭제는 server/routes/admin.js에 있음(1단계, 이 파일과 분리).
 */

router.use(requireAuth);
// 전면 정지(scope='full')면 이 라우터 전체(조회 포함)를 차단한다(#201). 통과 시
// req.activeSanction에 담겨서, 글쓰기/신청 라우트의 requireNotWritingSanctioned가
// 다시 조회하지 않고 재사용한다.
router.use(requireNotFullySanctioned);

const TITLE_MAX_LENGTH = 20;
const BODY_MAX_LENGTH = 1000;
const REPORT_REASON_MAX_LENGTH = 500;
const VALID_CATEGORIES = ['study', 'project'];

function isValidTitle(title) {
  return typeof title === 'string' && title.trim().length > 0 && title.trim().length <= TITLE_MAX_LENGTH;
}

function isValidBody(body) {
  return typeof body === 'string' && body.trim().length > 0 && body.trim().length <= BODY_MAX_LENGTH;
}

function isValidCategory(category) {
  return VALID_CATEGORIES.includes(category);
}

function isValidReportReason(reason) {
  return typeof reason === 'string' && reason.trim().length > 0 && reason.trim().length <= REPORT_REASON_MAX_LENGTH;
}

// 신고 생성 라우트 2개(글/신청)가 target_type만 다르고 나머지 로직이 동일해서 공유한다.
async function handleReport(req, res, next, targetType) {
  try {
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : req.body.reason;
    if (!isValidReportReason(reason)) {
      return res.status(400).json({ status: 400, code: 'INVALID_REASON', message: null, data: null });
    }

    const result = await communityService.createReport(req.session.userId, targetType, req.params.id, reason);
    if (!result.ok) {
      const status = result.reason === 'DUPLICATE_REPORT' ? 409 : 404;
      return res.status(status).json({ status, code: result.reason, message: null, data: null });
    }
    res.status(201).json({ status: 201, code: 'COMMUNITY_REPORT_CREATED', message: null, data: { id: result.id } });
  } catch (err) {
    next(err);
  }
}

// capacity(모집 인원)는 선택 — 안 적으면 null로 저장(정보 표시용일 뿐 신청 수를
// 강제로 제한하지 않음). 적었다면 1~999 사이 정수여야 한다.
function normalizeCapacity(capacity) {
  if (capacity === undefined || capacity === null || capacity === '') return { ok: true, value: null };
  const n = Number(capacity);
  if (!Number.isInteger(n) || n < 1 || n > 999) return { ok: false, value: null };
  return { ok: true, value: n };
}

// GET /api/community/my-sanction — 지금 내게 적용 중인 제재(경고성/전면) 조회. 전면
// 정지는 위 requireNotFullySanctioned가 이미 걸러내므로, 이 라우트가 실제로 응답하는
// 건 경고성 정지 여부 확인용(커뮤니티 화면 상단 안내 배너 표시)이다.
router.get('/my-sanction', async (req, res, next) => {
  try {
    const sanction = await sanctionService.getActiveSanction(req.session.userId);
    res.status(200).json({
      status: 200,
      code: 'MY_SANCTION',
      message: null,
      data: sanction ? { scope: sanction.scope, reason: sanction.reason, endsAt: sanction.ends_at } : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/community — 글 작성. 항상 status='pending'으로 시작(관리자 승인 전엔 비공개).
router.post('/', requireNotWritingSanctioned, async (req, res, next) => {
  try {
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : req.body.title;
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : req.body.body;
    if (!isValidTitle(title)) {
      return res.status(400).json({ status: 400, code: 'INVALID_TITLE', message: null, data: null });
    }
    if (!isValidBody(body)) {
      return res.status(400).json({ status: 400, code: 'INVALID_BODY', message: null, data: null });
    }
    if (!isValidCategory(req.body.category)) {
      return res.status(400).json({ status: 400, code: 'INVALID_CATEGORY', message: null, data: null });
    }
    const capacityResult = normalizeCapacity(req.body.capacity);
    if (!capacityResult.ok) {
      return res.status(400).json({ status: 400, code: 'INVALID_CAPACITY', message: null, data: null });
    }

    const id = await communityService.createPost(req.session.userId, {
      title,
      body,
      category: req.body.category,
      capacity: capacityResult.value,
    });
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

// PATCH /api/community/:id — 글 수정(작성자 전용). 재승인 대상이라 저장하면 status가
// pending으로 돌아간다(editPost 참고) — 그동안 공개 목록에서 사라짐.
router.patch('/:id', requireNotWritingSanctioned, async (req, res, next) => {
  try {
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : req.body.title;
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : req.body.body;
    if (!isValidTitle(title)) {
      return res.status(400).json({ status: 400, code: 'INVALID_TITLE', message: null, data: null });
    }
    if (!isValidBody(body)) {
      return res.status(400).json({ status: 400, code: 'INVALID_BODY', message: null, data: null });
    }
    if (!isValidCategory(req.body.category)) {
      return res.status(400).json({ status: 400, code: 'INVALID_CATEGORY', message: null, data: null });
    }
    const capacityResult = normalizeCapacity(req.body.capacity);
    if (!capacityResult.ok) {
      return res.status(400).json({ status: 400, code: 'INVALID_CAPACITY', message: null, data: null });
    }

    const edited = await communityService.editPost(req.params.id, req.session.userId, {
      title,
      body,
      category: req.body.category,
      capacity: capacityResult.value,
    });
    if (!edited) {
      return res.status(404).json({ status: 404, code: 'POST_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'COMMUNITY_POST_UPDATED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/community/:id — 글 삭제(작성자 전용, 승인 상태 무관 항상 허용).
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await communityService.deletePostByAuthor(req.params.id, req.session.userId);
    if (!deleted) {
      return res.status(404).json({ status: 404, code: 'POST_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'COMMUNITY_POST_DELETED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// POST /api/community/:id/close — 모집 마감(작성자 전용). 대기 중이던 신청은
// closePost 내부에서 자동 반려된다.
router.post('/:id/close', async (req, res, next) => {
  try {
    const closed = await communityService.closePost(req.params.id, req.session.userId);
    if (!closed) {
      return res.status(404).json({ status: 404, code: 'POST_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'COMMUNITY_POST_CLOSED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// POST /api/community/:id/report — 글 신고(#187).
router.post('/:id/report', (req, res, next) => handleReport(req, res, next, 'post'));

// POST /api/community/:id/apply — 신청. getPostById를 그대로 재사용해 "신청 가능한
// 글인지"(승인됨 + 본인 글 아님 + 마감 안 됨)를 판정한다 — 목록/상세 노출 규칙과 신청
// 가능 여부가 항상 같은 기준을 쓰게 하기 위함.
router.post('/:id/apply', requireNotWritingSanctioned, async (req, res, next) => {
  try {
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : req.body.message;
    if (!message) {
      return res.status(400).json({ status: 400, code: 'INVALID_MESSAGE', message: null, data: null });
    }

    const post = await communityService.getPostById(req.params.id, { studentId: req.session.userId });
    if (!post) {
      return res.status(404).json({ status: 404, code: 'POST_NOT_FOUND', message: null, data: null });
    }
    if (post.isMine) {
      return res.status(400).json({ status: 400, code: 'CANNOT_APPLY_OWN_POST', message: null, data: null });
    }
    if (post.closedAt) {
      return res.status(400).json({ status: 400, code: 'POST_CLOSED', message: null, data: null });
    }

    const result = await communityService.applyToPost(req.params.id, req.session.userId, message);
    if (!result.ok) {
      return res.status(409).json({ status: 409, code: result.reason, message: null, data: null });
    }
    res.status(201).json({ status: 201, code: 'COMMUNITY_APPLICATION_CREATED', message: null, data: { id: result.id } });
  } catch (err) {
    next(err);
  }
});

// GET /api/community/applications/mine — 내가 낸 신청 전체.
router.get('/applications/mine', async (req, res, next) => {
  try {
    const applications = await communityService.getMyApplications(req.session.userId);
    res.status(200).json({ status: 200, code: 'COMMUNITY_MY_APPLICATIONS', message: null, data: applications });
  } catch (err) {
    next(err);
  }
});

// GET /api/community/:id/applications — 이 글에 달린 신청자 목록(작성자 전용).
router.get('/:id/applications', async (req, res, next) => {
  try {
    const post = await communityService.getPostById(req.params.id, { studentId: req.session.userId });
    if (!post) {
      return res.status(404).json({ status: 404, code: 'POST_NOT_FOUND', message: null, data: null });
    }
    if (!post.isMine) {
      return res.status(403).json({ status: 403, code: 'FORBIDDEN', message: null, data: null });
    }

    const applicants = await communityService.getApplicantsForPost(req.params.id);
    res.status(200).json({ status: 200, code: 'COMMUNITY_APPLICANTS_LIST', message: null, data: applicants });
  } catch (err) {
    next(err);
  }
});

// POST /api/community/applications/:id/accept, /reject — 신청 수락/반려(글쓴이 전용).
router.post('/applications/:id/accept', async (req, res, next) => {
  try {
    const decided = await communityService.decideApplication(req.params.id, req.session.userId, 'accepted');
    if (!decided) {
      return res.status(404).json({ status: 404, code: 'APPLICATION_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'APPLICATION_ACCEPTED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// POST /api/community/applications/:id/report — 신청 메시지 신고(#187). 신청 메시지는
// 글쓴이만 볼 수 있으므로(getApplicantsForPost) 신고도 글쓴이만 가능하도록 소유권을 먼저
// 확인한다 — handleReport의 대상 존재 확인만으로는 "아무 신청 id나 신고 가능"해지는
// 허점이 생기기 때문.
router.post('/applications/:id/report', async (req, res, next) => {
  try {
    const isAuthor = await communityService.isApplicationOwnedByPostAuthor(req.params.id, req.session.userId);
    if (!isAuthor) {
      return res.status(403).json({ status: 403, code: 'FORBIDDEN', message: null, data: null });
    }
  } catch (err) {
    return next(err);
  }
  return handleReport(req, res, next, 'application');
});

// reason은 선택 — 글쓴이가 신청자에게 남기는 거부 메시지.
router.post('/applications/:id/reject', async (req, res, next) => {
  try {
    const reason = typeof req.body.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : null;
    const decided = await communityService.decideApplication(req.params.id, req.session.userId, 'rejected', reason);
    if (!decided) {
      return res.status(404).json({ status: 404, code: 'APPLICATION_NOT_FOUND', message: null, data: null });
    }
    res.status(200).json({ status: 200, code: 'APPLICATION_REJECTED', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
