const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const meRouter = require('../routes/me');
const onboardingRouter = require('../routes/onboarding');
const { isBroadSeriesStudent, validateMajorTrackType } = require('../services/majorTrackType');

/**
 * server/test/majorTrackType.test.js
 * 광역 계열전공 이수유형(students.major_track_type, #378 결정 3-1 A·3-4 A): 계열 학과의 2025학번 이후만 받고,
 * 온보딩 POST와 PATCH /api/me가 같은 규칙으로 검증·저장한다. 기존 계정은 trackTypeAnswerRequired로 한 번 묻는다.
 * DB에 임시 학생 1명을 만들고 끝나면 지운다.
 */

let server;
let baseUrl;
let studentId;
let series; // 계열 학과(2026 공학3계열 등)
let plain; // 계열이 아닌 학과

before(async () => {
  [[series]] = await pool.query("SELECT id, name FROM departments WHERE name = '공학1계열'");
  [[plain]] = await pool.query("SELECT id, name FROM departments WHERE name = '경영학과'");
  const [result] = await pool.query('INSERT INTO students (email, name) VALUES (?, ?)', [`track-type-${Date.now()}@example.test`, `trk${Date.now()}`]);
  studentId = result.insertId;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { userId: studentId }; next(); });
  app.use('/api/onboarding', onboardingRouter);
  app.use('/api', meRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (studentId) await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
  await pool.end();
});

const send = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const onboard = async (body) => {
  await pool.query('UPDATE students SET onboarding_completed_at = NULL WHERE id = ?', [studentId]);
  return send('POST', '/api/onboarding', { enrollmentType: 'GENERAL', ...body });
};
const stored = async () => (await pool.query('SELECT major_track_type FROM students WHERE id = ?', [studentId]))[0][0].major_track_type;

test('대상: 이름이 "계열"로 끝나는 학과의 2025학번 이후만', () => {
  assert.equal(isBroadSeriesStudent({ departmentName: '공학1계열', admissionYear: 2026 }), true);
  assert.equal(isBroadSeriesStudent({ departmentName: '창의문화융합계열', admissionYear: 2025 }), true);
  assert.equal(isBroadSeriesStudent({ departmentName: '창의문화융합계열', admissionYear: 2024 }), false);
  assert.equal(isBroadSeriesStudent({ departmentName: '경영학과', admissionYear: 2026 }), false);
  assert.equal(validateMajorTrackType('ADVANCED', { departmentName: '공학1계열', admissionYear: 2026 }), 'INVALID_MAJOR_TRACK_TYPE');
  assert.equal(validateMajorTrackType(undefined, { departmentName: '경영학과', admissionYear: 2026 }), null);
});

test('온보딩: 계열 학생은 이수유형을 저장하고("아직 안 정했어요" 포함), 계열이 아닌 학과는 거절한다', async () => {
  assert.equal((await onboard({ departmentId: series.id, admissionYear: 2026, majorTrackType: 'UNDECIDED' })).status, 200);
  assert.equal(await stored(), 'UNDECIDED');
  const bad = await onboard({ departmentId: plain.id, admissionYear: 2026, majorTrackType: 'INTENSIVE' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'MAJOR_TRACK_TYPE_NOT_ALLOWED');
});

test('기존 계열 계정이 이수유형에 답하지 않았으면 trackTypeAnswerRequired, 답하면 사라진다', async () => {
  await onboard({ departmentId: series.id, admissionYear: 2026 });
  let me = await send('GET', '/api/me');
  assert.equal(me.body.data.trackTypeAnswerRequired, true);
  assert.equal(me.body.data.majorTrackType, null);
  const saved = await send('PATCH', '/api/me', { majorTrackType: 'INTENSIVE' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.majorTrackType, 'INTENSIVE');
  assert.equal(saved.body.data.trackTypeAnswerRequired, false);
});

test('프로필: 학과를 바꾸면(이수유형을 같이 보내지 않았을 때) 이전 답을 지워 다시 묻고, 다른 항목만 바꾸면 그대로 둔다', async () => {
  await onboard({ departmentId: series.id, admissionYear: 2026, majorTrackType: 'DOUBLE_MAJOR' });
  await send('PATCH', '/api/me', { language: 'en' });
  assert.equal(await stored(), 'DOUBLE_MAJOR');
  await send('PATCH', '/api/me', { departmentId: plain.id });
  assert.equal(await stored(), null);
  const me = await send('GET', '/api/me');
  assert.equal(me.body.data.trackTypeAnswerRequired, false, '계열이 아니면 묻지 않는다');
});
