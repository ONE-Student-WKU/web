const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const router = express.Router();
const studentService = require('../services/studentService');
const emailAuthService = require('../services/emailAuthService');
const mailer = require('../services/mailer');
const { requireAuth } = require('../middleware/auth');

/**
 * Routes for Authentication (/api/auth)
 * 로그인은 Google OAuth만 지원한다(이메일/비밀번호 로그인 폐지 — 2026-09 전환).
 * 근거: 위키 API-설계 1장 - https://github.com/ONE-Student-wku/web/wiki/API-설계
 * (※ 이 문서는 옛 signup/login 엔드포인트 기준으로 작성돼 있음 — OAuth 전환 반영해서 갱신 필요)
 */

const OAUTH_PROVIDER = 'google';

// 콜백 URL은 반드시 "브라우저가 실제로 보는" 프론트 도메인 기준이어야 한다 — 운영은 Vercel이
// /api/*를 Railway 백엔드로 rewrite prox하고, 로컬은 Vite가 동일하게 프록시하므로, 여기서
// Google에 등록하는 리디렉션 URI도 이 프록시 경유 경로여야 콜백 응답의 세션 쿠키가 프론트와
// 같은 도메인에 스코프된다(Railway 원본 도메인으로 등록하면 쿠키 도메인이 어긋나 로그인 직후
// 세션이 안 보이는 문제가 생김 — .env.example 및 이슈 #137 논의 참고).
const CALLBACK_BASE_URL = process.env.OAUTH_CALLBACK_BASE_URL;
const CALLBACK_PATH = '/api/auth/google/callback';

// 로그인(/google)과 계정 삭제 전 재인증(/google/reauth)이 콜백 라우트 하나(CALLBACK_PATH)를
// 공유한다 — 콜백 주소를 용도별로 나누면 Google Cloud Console에 리디렉션 URI를 그만큼 더
// 등록해야 하고(로컬/운영 각각), 실제로 재인증용 등록을 빠뜨려 "OAuth 2.0 정책을 준수하지
// 않습니다" 에러가 나는 걸 확인했다 — 그래서 state 값 앞에 용도 접두사(login:/reauth:)를 붙여
// 같은 콜백 라우트 안에서 분기하는 방식으로 통합했다. 등록해야 하는 리디렉션 URI는 로그인용
// 하나(로컬/운영 각 1개)로 고정된다.
const STATE_PURPOSE = { LOGIN: 'login', REAUTH: 'reauth' };

function buildOauthClient() {
  return new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${CALLBACK_BASE_URL}${CALLBACK_PATH}`,
  });
}

function makeState(purpose) {
  return `${purpose}:${crypto.randomBytes(16).toString('hex')}`;
}

// GET /api/auth/google — 로그인 시작. fetch가 아니라 실제 브라우저 네비게이션
// (window.location.href)으로 호출해야 함 — Google 로그인 자체가 풀 페이지 리다이렉트 플로우.
router.get('/google', (req, res) => {
  const state = makeState(STATE_PURPOSE.LOGIN);
  req.session.oauthState = state; // CSRF 방지 — 콜백에서 반드시 이 값과 비교
  const url = buildOauthClient().generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account',
  });
  res.redirect(url);
});

// GET /api/auth/google/reauth — 계정 삭제 등 민감한 작업 전 "다시 로그인해서 확인"용
// step-up 재인증. state 접두사로 로그인 플로우와 구분되고, prompt=consent로 매번 실제
// 동의 화면을 다시 띄워 조용한 SSO 재사용을 막는다.
router.get('/google/reauth', requireAuth, (req, res) => {
  const state = makeState(STATE_PURPOSE.REAUTH);
  req.session.oauthState = state;
  const url = buildOauthClient().generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'consent',
  });
  res.redirect(url);
});

// GET /api/auth/google/callback — 로그인/재인증 공통 콜백. 성공/실패 모두 SPA 루트로
// 리다이렉트하고, 실패 시에는 ?authError=CODE 쿼리로 이유를 실어 보낸다(App.jsx가 파싱해서
// Login/Profile에 표시).
router.get('/google/callback', async (req, res, next) => {
  const redirectToApp = (query = '') => res.redirect(`${CALLBACK_BASE_URL}/${query}`);

  try {
    const { code, state } = req.query;
    const expectedState = req.session.oauthState;
    delete req.session.oauthState;

    if (!state || !expectedState || state !== expectedState) {
      return redirectToApp('?authError=STATE_MISMATCH');
    }
    if (!code) {
      return redirectToApp('?authError=OAUTH_FAILED');
    }

    const purpose = expectedState.split(':')[0];

    const oauthClient = buildOauthClient();
    const { tokens } = await oauthClient.getToken(code);
    const ticket = await oauthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    // 이메일이 검증되지 않은 상태로는 신뢰하지 않는다 — 미검증 이메일을 그대로 믿고 기존
    // students 행에 연결(link)해버리면, 그 이메일의 진짜 소유자가 아닌 사람이 계정을
    // 가로챌 수 있는 경로가 생긴다.
    if (!payload.email_verified) {
      return redirectToApp('?authError=EMAIL_NOT_VERIFIED');
    }

    if (purpose === STATE_PURPOSE.REAUTH) {
      // 재인증은 이미 로그인된 세션이 있어야 의미가 있다 — /google/reauth 자체가
      // requireAuth로 막혀 있지만, 콜백 시점엔 세션이 만료됐을 수도 있으니 다시 확인한다.
      if (!req.session.userId) {
        return redirectToApp('?authError=UNAUTHORIZED');
      }
      const student = await studentService.findById(req.session.userId);
      if (!student || student.oauth_id !== payload.sub) {
        return redirectToApp('?authError=REAUTH_MISMATCH');
      }
      req.session.deleteReauthAt = Date.now();
      return redirectToApp('?reauth=1');
    }

    // purpose === LOGIN
    let student = await studentService.findByOauth(OAUTH_PROVIDER, payload.sub);

    if (!student) {
      const existingByEmail = await studentService.findByEmail(payload.email);

      if (existingByEmail && existingByEmail.oauth_id && existingByEmail.oauth_id !== payload.sub) {
        // 정상적으로는 발생하지 않아야 하는 케이스(단일 provider) — 안전하게 거부.
        return redirectToApp('?authError=INVALID_CREDENTIALS');
      }

      if (existingByEmail) {
        await studentService.linkOauthToStudent(existingByEmail.id, {
          provider: OAUTH_PROVIDER,
          oauthId: payload.sub,
        });
        student = existingByEmail;
      } else {
        // 닉네임은 가입 시 자동 배정(user{id}) — 구글 실명을 그대로 노출하지 않고, 동명이인
        // 중복도 기본키 기반이라 원천 차단된다. 원하면 나중에 Profile 화면에서 직접 변경 가능.
        const id = await studentService.createOauthStudent({
          email: payload.email,
          provider: OAUTH_PROVIDER,
          oauthId: payload.sub,
        });
        student = { id };
      }
    }

    req.session.userId = student.id;
    return redirectToApp();
  } catch (err) {
    next(err);
  }
});

// 초과 시 응답 포맷 — express-rate-limit 기본값(message가 문자열)은 res.send(message)로
// 순수 텍스트가 나가 클라이언트 apiRequest의 res.json() 파싱이 실패한다. message를 객체로
// 주면 Express의 res.send()가 자동으로 res.json()으로 처리해줘서, 핸들러를 직접 갈아끼우지
// 않고도 프로젝트 표준 JSON 포맷을 그대로 낼 수 있다.
const RATE_LIMIT_RESPONSE = { status: 429, code: 'TOO_MANY_REQUESTS', message: null, data: null };

// IP당 반복 요청 방지 — 스팸/어뷰징 방지 목적.
const requestCodeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10분
  max: 5,                    // IP당 10분에 5회
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMIT_RESPONSE,
});

// 이메일당 반복 요청 방지 — IP만 제한하면 IP를 바꿔가며 특정 이메일에 인증코드 메일을
// 계속 보내는 어뷰징(메일 폭탄)이 가능해서 별도로 둔다. express.json()이 라우터 마운트보다
// 먼저 전역 등록돼 있어(server/app.js) 이 시점엔 req.body.email이 이미 파싱돼 있다.
const requestCodeByEmailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10분
  max: 5,                    // 이메일당 10분에 5회
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMIT_RESPONSE,
  keyGenerator: (req) => (typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : 'unknown'),
});

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /api/auth/email/request — 이메일 입력 → 코드 생성 → 발송. 도메인 제한 없음(이슈 #137
// 결정: 학교 이메일 인증 기각 — naver.com 등 어떤 이메일이든 가능).
router.post('/email/request', requestCodeLimiter, requestCodeByEmailLimiter, async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : req.body.email;
    if (!isValidEmail(email)) {
      return res.status(400).json({ status: 400, code: 'INVALID_EMAIL', message: null, data: null });
    }

    const code = await emailAuthService.createLoginToken(email);
    await mailer.sendLoginCode(email, code);

    return res.status(200).json({ status: 200, code: 'EMAIL_CODE_SENT', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/email/verify — 코드 확인 → 세션 발급. 신규/기존 계정 매칭은 구글 콜백과
// 동일한 findByEmail 기반 — 이미 구글로 가입한 이메일이면 그 기존 행에 그대로 로그인된다
// (oauth_provider/oauth_id는 구글 전용으로 유지, 여기선 건드리지 않음).
router.post('/email/verify', async (req, res, next) => {
  try {
    // 이메일 앱에서 코드를 복사해 붙여넣을 때 앞뒤 공백/줄바꿈이 섞여 들어오는 경우가 있어
    // (눈으로는 똑같아 보여도 해시 비교가 실패함), 클라이언트 trim과 별개로 서버에서도
    // 한 번 더 trim한다 — API를 직접 호출하는 경우까지 포함해 계약을 명확히 하기 위함.
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : req.body.email;
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : req.body.code;
    if (!isValidEmail(email) || !code) {
      return res.status(400).json({ status: 400, code: 'INVALID_REQUEST', message: null, data: null });
    }

    const result = await emailAuthService.verifyLoginToken(email, code);
    if (!result.ok) {
      return res.status(401).json({ status: 401, code: result.reason, message: null, data: null });
    }

    let student = await studentService.findByEmail(email);
    if (!student) {
      // 닉네임은 구글 가입과 동일하게 자동 배정(user{id}) — 별도 가입 단계 없이 이 한 번의
      // INSERT로 끝난다.
      const id = await studentService.createEmailStudent({ email });
      student = { id };
    }

    // 세션 고정(Session Fixation) 방지 — 구글 콜백(/google/callback)과 동일하게 로그인 성공
    // 시 세션 ID를 재발급한다. regenerate 콜백에서 req.session이 새 객체로 교체되므로, 그
    // 이후 시점에 userId를 셋팅해야 한다.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = student.id;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        return res.status(200).json({ status: 200, code: 'EMAIL_LOGIN_SUCCESS', message: null, data: null });
      });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/email/delete-reauth/request — 이메일 전용 계정(oauth_id NULL)을 위한
// 계정 삭제 재인증 코드 발송. 구글 가입 계정은 기존 GET /google/reauth를 그대로 쓰므로
// 대상이 아니다(oauth_id로 로그인 방식 판별). 인증 대상 이메일은 요청 본문이 아니라 항상
// 세션의 본인 계정 이메일로 고정 — 다른 사람 이메일로 코드를 보내게 하는 경로를 만들지
// 않기 위함.
router.post('/email/delete-reauth/request', requireAuth, requestCodeLimiter, async (req, res, next) => {
  try {
    const student = await studentService.findById(req.session.userId);
    if (!student) {
      return res.status(401).json({ status: 401, code: 'UNAUTHORIZED', message: null, data: null });
    }
    if (student.oauth_id) {
      return res.status(400).json({ status: 400, code: 'NOT_EMAIL_ACCOUNT', message: null, data: null });
    }

    const code = await emailAuthService.createLoginToken(student.email, 'delete_reauth');
    await mailer.sendLoginCode(student.email, code);

    return res.status(200).json({ status: 200, code: 'EMAIL_CODE_SENT', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/email/delete-reauth/verify — 코드 확인 → deleteReauthAt 세팅. 이후
// server/routes/me.js의 DELETE /me가 이 값을 구글 재인증(/google/callback REAUTH 분기)과
// 동일한 계약(REAUTH_WINDOW_MS 이내)으로 검사한다.
router.post('/email/delete-reauth/verify', requireAuth, async (req, res, next) => {
  try {
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : req.body.code;
    if (!code) {
      return res.status(400).json({ status: 400, code: 'INVALID_REQUEST', message: null, data: null });
    }

    const student = await studentService.findById(req.session.userId);
    if (!student) {
      return res.status(401).json({ status: 401, code: 'UNAUTHORIZED', message: null, data: null });
    }
    if (student.oauth_id) {
      return res.status(400).json({ status: 400, code: 'NOT_EMAIL_ACCOUNT', message: null, data: null });
    }

    const result = await emailAuthService.verifyLoginToken(student.email, code, 'delete_reauth');
    if (!result.ok) {
      return res.status(401).json({ status: 401, code: result.reason, message: null, data: null });
    }

    req.session.deleteReauthAt = Date.now();
    return res.status(200).json({ status: 200, code: 'REAUTH_SUCCESS', message: null, data: null });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout — 로그인 방식과 무관(세션 파기만 하면 됨), 변경 없음.
router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.status(200).json({ status: 200, code: 'LOGOUT_SUCCESS', message: null, data: null });
  });
});

module.exports = router;
