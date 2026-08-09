/**
 * server/middleware/auth.js
 * Express route interceptor to authenticate incoming sessions.
 */

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }

  return res.status(401).json({ status: 401, code: 'UNAUTHORIZED', message: null, data: null });
}

module.exports = {
  requireAuth,
};
