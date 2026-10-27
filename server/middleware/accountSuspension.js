const sanctionService = require('../services/sanctionService');

/**
 * server/middleware/accountSuspension.js
 * 서비스 전체 이용 정지(#457) 가드. app.js가 /api 라우트 앞에 한 번 붙인다.
 *
 * 막을 라우트를 하나씩 고르는 대신 로그인한 정지 계정의 요청을 전부 막고 아래 허용 목록만 통과시킨다 —
 * 나중에 새 기능을 만들고 가드를 깜빡해도 정지 계정은 쓸 수 없다. 약관 6항이 정지 중에도 허용한
 * 정지 사유 확인(GET /me), 로그아웃, 계정 삭제(재인증 포함)만 연다. 로그인·재인증 라우트(/api/auth/*)는
 * 로그인 전에도 쓰고, 정지 계정도 로그인해야 정지 안내를 보고 계정을 지울 수 있어서 통째로 연다.
 *
 * 정지·해제가 바로 반영되도록 세션에 담아두지 않고 요청마다 조회한다.
 */

function isAllowed(req) {
  const path = req.originalUrl.split('?')[0];
  if (path.startsWith('/api/auth/')) return true;
  if (path === '/api/me') return req.method === 'GET' || req.method === 'DELETE';
  return false;
}

async function blockSuspendedAccount(req, res, next) {
  try {
    if (!req.session || !req.session.userId || isAllowed(req)) return next();
    const suspension = await sanctionService.getActiveAccountSuspension(req.session.userId);
    if (!suspension) return next();
    return res.status(403).json({
      status: 403,
      code: 'ACCOUNT_SUSPENDED',
      message: null,
      data: { reason: suspension.reason, endsAt: suspension.ends_at },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { blockSuspendedAccount };
