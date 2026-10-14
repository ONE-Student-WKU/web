const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

/**
 * server/middleware/security.js
 * 라우트마다 따로 쓰기엔 겹치는 보안 장치 모음 — 응답 보안 헤더, 쿼리스트링 형태 검사, 로그인한 사용자 단위 호출 제한.
 */

// API 응답에 붙이는 보안 헤더. 이 서버는 JSON만 내려주므로(화면 HTML은 Vercel이 서빙) 가장 좁은 CSP를 쓴다.
//  - nosniff: 브라우저가 JSON을 HTML/스크립트로 추측해 실행하지 못하게 한다.
//  - frame-ancestors/X-Frame-Options: 다른 사이트가 API 응답이나 OAuth 콜백을 iframe에 넣어 클릭을 가로채는 것을 막는다.
//  - Cache-Control: no-store: 학사 정보·대화 기록이 브라우저/중간 프록시 캐시에 남지 않게 한다.
//  - HSTS: 운영(HTTPS)에서만. 로컬 http 개발 환경에는 붙이지 않는다.
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

// 쿼리스트링 값은 항상 문자열 하나여야 한다. `?year=a&year=b`(배열)나 `?year[x]=1`(객체)이 그대로 SQL 파라미터로 넘어가면
// mysql2가 목록/`col = 값` 꼴로 펼쳐서 의도하지 않은 SQL이 만들어지고(최소한 500 오류) 라우트마다 일일이 막기 어렵다.
// 이 서비스의 어떤 API도 배열/객체 쿼리를 쓰지 않으므로 한 곳에서 거절한다.
function requireStringQuery(req, res, next) {
  for (const value of Object.values(req.query)) {
    if (typeof value !== 'string') {
      return res.status(400).json({ status: 400, code: 'INVALID_QUERY', message: null, data: null });
    }
  }
  next();
}

const TOO_MANY = { status: 429, code: 'TOO_MANY_REQUESTS', message: null, data: null };

// 로그인한 사용자 단위 호출 제한. IP로 세면 학교·기숙사처럼 한 IP를 여럿이 쓰거나 프록시 뒤에서 IP가 뭉개질 때
// 정상 사용자끼리 서로 막히므로, requireAuth 뒤에 붙여 세션의 userId로 센다(세션이 없으면 IP로 대신한다).
function perUserLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: TOO_MANY,
    keyGenerator: (req) => (req.session && req.session.userId ? `u${req.session.userId}` : ipKeyGenerator(req.ip)),
  });
}

// 같은 사용자의 요청을 한 번에 하나씩만 받는다(답을 기다리는 중에 온 요청은 429). AI 호출 라우트의 횟수 상한은
// "세고 → 저장"이 따로라서, 동시에 여러 개를 보내면 전부 상한 전 숫자를 읽고 통과한다 — 한 사람의 요청을 줄 세워 막는다.
// 서버 프로세스 하나 안에서만 유효하다(서버를 여러 대로 늘리면 공용 저장소가 필요). 라우트 묶음마다 따로 만들어 쓴다.
function oneRequestPerUser() {
  const inFlight = new Set();
  return (req, res, next) => {
    const userId = req.session && req.session.userId;
    if (inFlight.has(userId)) {
      return res.status(429).json({ status: 429, code: 'REQUEST_IN_PROGRESS', message: null, data: null });
    }
    inFlight.add(userId);
    res.on('close', () => inFlight.delete(userId));
    next();
  };
}

module.exports = { securityHeaders, requireStringQuery, perUserLimiter, oneRequestPerUser };
