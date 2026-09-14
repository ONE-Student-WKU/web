const sanctionService = require('../services/sanctionService');

/**
 * server/middleware/sanction.js
 * 커뮤니티 사용자 제재(#201) 적용 가드. requireAuth 다음에 붙는다.
 */

function sanctionResponseData(sanction) {
  return { scope: sanction.scope, reason: sanction.reason, endsAt: sanction.ends_at };
}

// 커뮤니티 라우트 전체에 적용 — 전면 정지(scope='full')면 조회(GET)까지 포함해 전부 막는다.
// 통과하면 req.activeSanction에 담아둬서, 뒤따르는 requireNotWritingSanctioned가 다시
// 조회할 필요 없게 한다.
async function requireNotFullySanctioned(req, res, next) {
  try {
    const sanction = await sanctionService.getActiveSanction(req.session.userId);
    if (sanction && sanction.scope === 'full') {
      return res.status(403).json({ status: 403, code: 'SANCTIONED', message: null, data: sanctionResponseData(sanction) });
    }
    req.activeSanction = sanction;
    next();
  } catch (err) {
    next(err);
  }
}

// 글쓰기/신청처럼 "새로 만드는" 액션에만 추가로 붙인다 — 경고성(post_apply) 정지가 여기서
// 걸린다(전면 정지는 이미 requireNotFullySanctioned에서 걸러졌으므로 이 시점엔 없음).
function requireNotWritingSanctioned(req, res, next) {
  const sanction = req.activeSanction;
  if (sanction) {
    return res.status(403).json({ status: 403, code: 'SANCTIONED', message: null, data: sanctionResponseData(sanction) });
  }
  next();
}

module.exports = { requireNotFullySanctioned, requireNotWritingSanctioned };
