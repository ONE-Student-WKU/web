/**
 * server/middleware/auth.js
 * Express route interceptor to authenticate incoming sessions.
 */

const studentService = require('../services/studentService');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }

  return res.status(401).json({ status: 401, code: 'UNAUTHORIZED', message: null, data: null });
}

// requireAuth 뒤에 붙여 쓴다 — 세션엔 role을 안 들고 있어 매 요청 DB 조회가 필요하지만,
// 관리자 전용 라우트라 트래픽이 적어 문제없다.
async function requireAdmin(req, res, next) {
  try {
    const student = await studentService.findById(req.session.userId);
    if (!student || student.role !== 'admin') {
      return res.status(403).json({ status: 403, code: 'FORBIDDEN', message: null, data: null });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  requireAuth,
  requireAdmin,
};
