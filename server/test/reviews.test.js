const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const reviewsRouter = require('../routes/reviews');
const reviewService = require('../services/reviewService');

/**
 * server/test/reviews.test.js
 * 앱 안 후기 창: 깊게 써 본 학생에게만 띄우고(과목 10개 / 챗봇 3번 + 진로), 최대 2번(7일 뒤 한 번 더), 보낸 후기는
 * 학생과 연결하지 않고 학과·날짜만 남기는지. DB에 임시 학생을 만들고 끝나면 지운다. 전제: db:migrate(service_reviews, students.review_prompt_*).
 */

const MARK = `리뷰테스트-${Date.now()}`;
const session = {};
let server;
let baseUrl;
let studentId;
let departmentName;

before(async () => {
  const [[dept]] = await pool.query('SELECT id, name FROM departments ORDER BY id LIMIT 1');
  departmentName = dept.name;
  const [result] = await pool.query(
    'INSERT INTO students (email, name, department_id, onboarding_completed_at) VALUES (?, ?, ?, NOW())',
    [`review-${Date.now()}@example.test`, `review${Date.now()}`, dept.id]
  );
  studentId = result.insertId;
  session.userId = studentId;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = session;
    next();
  });
  app.use('/api/reviews', reviewsRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.query('DELETE FROM service_reviews WHERE content LIKE ?', [`${MARK}%`]);
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

const due = async () => (await (await fetch(`${baseUrl}/api/reviews/prompt`)).json()).data.due;
const shown = () => fetch(`${baseUrl}/api/reviews/prompt/shown`, { method: 'POST' });
const send = async (body) => {
  const res = await fetch(`${baseUrl}/api/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const promptState = async () => {
  const [[row]] = await pool.query(
    'SELECT review_prompt_count AS count, review_prompt_next_at > NOW() AS later FROM students WHERE id = ?',
    [studentId]
  );
  return { count: row.count, later: row.later === null ? null : !!row.later };
};

test('깊게 써 본 기준: 과목 10개면 충분하고, 아니면 챗봇 3번과 진로 탐색이 둘 다 있어야 한다', () => {
  const { meetsUsageSignal } = reviewService;
  assert.equal(meetsUsageSignal({ courses: 10, chatAnswers: 0, careerAnswers: 0 }), true);
  assert.equal(meetsUsageSignal({ courses: 9, chatAnswers: 2, careerAnswers: 5 }), false);
  assert.equal(meetsUsageSignal({ courses: 0, chatAnswers: 3, careerAnswers: 0 }), false);
  assert.equal(meetsUsageSignal({ courses: 0, chatAnswers: 3, careerAnswers: 1 }), true);
});

test('별점은 1~5 정수, 후기는 500자 이하만 받고 빈 후기는 비운다', () => {
  const { parseReview } = reviewService;
  assert.deepEqual(parseReview({ rating: 4, content: '  좋아요  ' }), { rating: 4, content: '좋아요' });
  assert.deepEqual(parseReview({ rating: 5 }), { rating: 5, content: null });
  assert.equal(parseReview({ rating: 0 }), null);
  assert.equal(parseReview({ rating: 3.5 }), null);
  assert.equal(parseReview({ rating: '5' }), null);
  assert.equal(parseReview({ rating: 5, content: 'a'.repeat(501) }), null);
});

test('써 본 게 없으면 띄우지 않고, 띄운 적 없는 계정의 후기는 받지 않는다', async () => {
  assert.equal(await due(), false);
  const res = await send({ rating: 5, content: `${MARK} 미리` });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'REVIEW_NOT_PROMPTED');
  // 띄울 때가 아니면 "띄웠다"는 요청도 아무것도 바꾸지 않는다
  await shown();
  assert.deepEqual(await promptState(), { count: 0, later: null });
});

test('과목을 10개 넣으면 띄우고, 띄운 뒤에는 7일 동안 다시 띄우지 않는다', async () => {
  const values = Array.from({ length: 10 }, (_, i) => [studentId, `리뷰테스트과목${i}`, 3, '전공선택', 2025, 1]);
  await pool.query('INSERT INTO student_courses (student_id, name, credits, category, year, semester) VALUES ?', [values]);
  assert.equal(await due(), true);
  await shown();
  assert.deepEqual(await promptState(), { count: 1, later: true });
  assert.equal(await due(), false);
});

test('7일이 지나면 한 번 더 띄우고, 두 번째 뒤로는 다시 띄우지 않는다', async () => {
  await pool.query('UPDATE students SET review_prompt_next_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [studentId]);
  assert.equal(await due(), true);
  await shown();
  assert.deepEqual(await promptState(), { count: 2, later: null });
  assert.equal(await due(), false);
});

test('보낸 후기는 학생 없이 학과·날짜만 남고, 같은 로그인에서 두 번 받지 않는다', async () => {
  const res = await send({ rating: 4, content: `${MARK} 남은 학점이 한눈에 보여요` });
  assert.equal(res.status, 201);
  const [rows] = await pool.query('SELECT * FROM service_reviews WHERE content LIKE ?', [`${MARK}%`]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rating, 4);
  assert.equal(rows[0].department_name, departmentName);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['content', 'created_date', 'department_name', 'id', 'rating']);
  assert.deepEqual(await promptState(), { count: 2, later: null });

  const again = await send({ rating: 1, content: `${MARK} 또` });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'REVIEW_ALREADY_SENT');
});

test('관리자 목록은 최근 후기와 개수·평균을 돌려준다', async () => {
  const list = await reviewService.listReviews();
  assert.ok(list.count >= 1);
  const mine = list.reviews.find((r) => r.content && r.content.startsWith(MARK));
  assert.equal(mine.department, departmentName);
  assert.match(mine.date, /^\d{4}-\d{2}-\d{2}$/);
});
