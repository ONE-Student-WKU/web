process.env.RESEND_API_KEY ||= 're_test_dummy';
process.env.GOOGLE_CLIENT_ID ||= 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET ||= 'test-client-secret';
process.env.OAUTH_CALLBACK_BASE_URL ||= 'http://localhost:5173';

const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const authRouter = require('../routes/auth');
const meRouter = require('../routes/me');
const chatRouter = require('../routes/chat');
const careerRouter = require('../routes/career');
const communityRouter = require('../routes/community');
const myCoursesRouter = require('../routes/myCourses');
const onboardingRouter = require('../routes/onboarding');
const { securityHeaders, requireStringQuery } = require('../middleware/security');
const { CURRENT_CONSENT_VERSION } = require('../services/consent');
const mailer = require('../services/mailer');

/**
 * server/test/security.hardening.test.js
 * 보안 점검(2026-10)에서 막은 입력·호출 문제들의 회귀 테스트. 세션은 가짜로 꽂고 DB에는 임시 학생만 만든다
 * (AI·메일·외부 API는 부르지 않는다 — 전부 그 앞단 검증에서 걸리는지만 본다).
 */

let server;
let baseUrl;
let studentId;
let postId;

before(async () => {
  // 검증이 뚫리면 실제 메일 발송까지 가므로, 어떤 경우에도 외부(Resend)로 나가지 않게 막아 둔다.
  mock.method(mailer, 'sendLoginCode', async () => {});
  const [r] = await pool.query('INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())', [
    `sec-${Date.now()}@example.test`,
    `sec${Date.now()}`,
  ]);
  studentId = r.insertId;
  const [p] = await pool.query(
    "INSERT INTO community_posts (author_id, title, body, category, status) VALUES (?, 't', 'b', 'study', 'approved')",
    [studentId]
  );
  postId = p.insertId;

  const app = express();
  app.use(securityHeaders);
  app.use(express.json());
  app.use(requireStringQuery);
  app.use((req, res, next) => {
    req.session = { userId: studentId };
    next();
  });
  app.use('/api/auth', authRouter);
  app.use('/api/onboarding', onboardingRouter);
  app.use('/api', meRouter);
  app.use('/api/my-courses', myCoursesRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/career', careerRouter);
  app.use('/api/community', communityRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (postId) await pool.query('DELETE FROM community_posts WHERE id = ?', [postId]);
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.query("DELETE FROM email_login_tokens WHERE email LIKE '%a@b.com%' OR email LIKE 'aaaa%@b.com'");
  await pool.end();
});

const call = async (method, path, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
};

test('응답에 보안 헤더가 붙고 API는 캐시되지 않는다', async () => {
  const res = await call('GET', '/api/me');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('쿼리스트링에 배열·객체가 오면 400 (SQL 조각으로 펼쳐지지 않는다)', async () => {
  for (const qs of ['year=2024&year=2025&semester=1', 'year[x]=1&semester=1', 'year=2024&semester[a]=1']) {
    const res = await call('GET', `/api/my-courses/timetable?${qs}`);
    assert.equal(res.status, 400, qs);
    assert.equal(res.body.code, 'INVALID_QUERY');
  }
  assert.equal((await call('GET', '/api/my-courses/timetable?year=2024&semester=1')).status, 200);
});

test('이메일 형식: 주소 목록/표시이름으로 해석될 수 있는 값은 거절한다', async () => {
  // 코드 발송 라우트는 이메일당 10분 5회 제한(requestCodeLimiter)이 있다 — 서로 다른 값 5개라 걸리지 않는다.
  for (const email of ['x<a@b.com>', 'a@b.com,c@d.com', '"a"@b.com', 'a@b.com\r\nBcc:x@y.z', `${'a'.repeat(250)}@b.com`]) {
    const res = await call('POST', '/api/auth/email/request', { email, consent: CURRENT_CONSENT_VERSION });
    assert.equal(res.status, 400, String(email));
    assert.equal(res.body.code, 'INVALID_EMAIL');
  }
});

test('프로필: 이름·학번·횟수의 타입과 범위를 검사한다(500이 아니라 400)', async () => {
  const cases = [
    [{ name: 123 }, 'REQUIRED_NAME'],
    [{ name: { a: 1 } }, 'REQUIRED_NAME'],
    [{ name: 'x'.repeat(51) }, 'NAME_TOO_LONG'],
    [{ name: 'ab​cd' }, 'INVALID_NAME'],
    [{ name: 'user​99' }, 'INVALID_NAME'],
    [{ name: '관리자' }, 'INVALID_NAME'],
    [{ name: ' Admin ' }, 'INVALID_NAME'],
    [{ name: 'ａｄｍｉｎ' }, 'INVALID_NAME'], // 전각 문자 — 정규화(NFKC) 전에는 예약어 검사를 통과했다
    [{ admissionYear: 1800 }, 'INVALID_ADMISSION_YEAR'],
    [{ admissionYear: [2022] }, 'INVALID_ADMISSION_YEAR'],
    [{ careerCounselingCount: -1 }, 'INVALID_CAREER_COUNSELING_COUNT'],
    [{ careerCounselingCount: { a: 1 } }, 'INVALID_CAREER_COUNSELING_COUNT'],
    [{ leaveSemesters: 9999 }, 'INVALID_LEAVE_SEMESTERS'],
  ];
  for (const [body, code] of cases) {
    const res = await call('PATCH', '/api/me', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.code, code, JSON.stringify(body));
  }
  const ok = await call('PATCH', '/api/me', { name: `정상닉${Date.now() % 100000}`, careerCounselingCount: 2, leaveSemesters: 1 });
  assert.equal(ok.status, 200);
});

test('온보딩: 없는 학과나 터무니없는 학번은 400', async () => {
  const base = { enrollmentType: 'GENERAL' };
  assert.equal((await call('POST', '/api/onboarding', { ...base, departmentId: 99999999, admissionYear: 2022 })).body.code, 'INVALID_DEPARTMENT_ID');
  assert.equal((await call('POST', '/api/onboarding', { ...base, departmentId: { a: 1 }, admissionYear: 2022 })).body.code, 'INVALID_DEPARTMENT_ID');
  const [[dept]] = await pool.query('SELECT id FROM departments LIMIT 1');
  assert.equal((await call('POST', '/api/onboarding', { ...base, departmentId: dept.id, admissionYear: 3000 })).body.code, 'INVALID_ADMISSION_YEAR');
});

test('챗봇: 너무 길거나 문자열이 아닌 질문은 AI를 부르기 전에 400', async () => {
  for (const message of ['가'.repeat(2001), { a: 1 }, ['x']]) {
    const res = await call('POST', '/api/chat/messages', { conversationId: 1, message });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INVALID_MESSAGE');
  }
});

test('진로 탐색: 너무 긴 입력/잘못된 형식은 400', async () => {
  assert.equal((await call('POST', '/api/career/sessions/1/messages', { content: 'x'.repeat(2001) })).body.code, 'INVALID_CONTENT');
  assert.equal((await call('POST', '/api/career/sessions/1/messages', { content: { a: 1 } })).body.code, 'INVALID_CONTENT');
  const tooMany = Array.from({ length: 11 }, () => ({ question: 'q', answer: 'a' }));
  assert.equal((await call('POST', '/api/career/sessions/1/fixed-answers', { fixedAnswers: tooMany })).body.code, 'REQUIRED_FIXED_ANSWERS');
  assert.equal((await call('POST', '/api/career/sessions/1/fixed-answers', { fixedAnswers: [{ question: 'q', answer: 'a'.repeat(1001) }] })).body.code, 'REQUIRED_FIXED_ANSWERS');
  assert.equal((await call('POST', '/api/career/sessions/1/fixed-answers', { fixedAnswers: [{ question: 5, answer: 'a' }] })).body.code, 'REQUIRED_FIXED_ANSWERS');
  assert.equal((await call('POST', '/api/career/sessions/1/confirm', { careerName: 'x'.repeat(201) })).body.code, 'INVALID_CAREER_NAME');
});

test('커뮤니티: 신청 메시지/거부 사유 길이 상한', async () => {
  const apply = await call('POST', `/api/community/${postId}/apply`, { message: 'x'.repeat(1001) });
  assert.equal(apply.status, 400);
  assert.equal(apply.body.code, 'INVALID_MESSAGE');
  const reject = await call('POST', '/api/community/applications/1/reject', { reason: 'x'.repeat(501) });
  assert.equal(reject.status, 400);
  assert.equal(reject.body.code, 'INVALID_REASON');
});

test('내 과목: 연도·학기·점수 타입 검사', async () => {
  const base = { name: '보안테스트과목', credits: 3, category: '교양선택' };
  assert.equal((await call('POST', '/api/my-courses', { ...base, year: 'abc', semester: 1 })).body.code, 'INVALID_YEAR');
  assert.equal((await call('POST', '/api/my-courses', { ...base, year: 2024, semester: 9 })).body.code, 'INVALID_SEMESTER');
  assert.equal((await call('POST', '/api/my-courses', { ...base, year: [2024], semester: 1 })).body.code, 'INVALID_YEAR');
  assert.equal((await call('POST', '/api/my-courses', { ...base, name: 'x'.repeat(101), year: 2024, semester: 1 })).body.code, 'ROW_NAME_TOO_LONG');
  assert.equal((await call('PATCH', '/api/my-courses/1', { midterm: { a: 1 } })).body.code, 'INVALID_SCORE');
  assert.equal((await call('PATCH', '/api/my-courses/1', { final: 100000 })).body.code, 'INVALID_SCORE');
  const confirm = await call('POST', '/api/my-courses/import/confirm', { rows: Array.from({ length: 501 }, () => ({})) });
  assert.equal(confirm.status, 400);
});
