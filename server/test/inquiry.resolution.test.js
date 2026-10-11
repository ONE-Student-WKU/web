const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const inquiriesRouter = require('../routes/inquiries');
const adminRouter = require('../routes/admin');

/**
 * server/test/inquiry.resolution.test.js
 * 문의 처리 답변: 관리자가 남긴 답변이 문의자 본인 목록과 관리자 목록에만 실리고, 길이 검증·재처리 방지가 되는지.
 * 임시 학생·문의를 만들고 끝나면 지운다. 로컬 DB 전용.
 */

const run = Date.now();
let adminId;
let askerId;
let otherId;
let server;
let baseUrl;
let sessionUserId;

async function makeStudent(tag, role = 'student') {
  const [r] = await pool.query('INSERT INTO students (email, name, role, onboarding_completed_at) VALUES (?, ?, ?, NOW())', [`iq-${tag}-${run}@example.test`, `iq${tag}${run}`, role]);
  return r.insertId;
}

const call = async (prefix, method, path, body) => {
  const res = await fetch(`${baseUrl}${prefix}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};
const inquiries = (m, p, b) => call('/api/inquiries', m, p, b);
const admin = (m, p, b) => call('/api/admin', m, p, b);

async function newInquiry(tag) {
  sessionUserId = askerId;
  const res = await inquiries('POST', '/', { title: `문의${tag}`, content: '내용' });
  assert.equal(res.status, 201);
  return res.json.data.id;
}

before(async () => {
  adminId = await makeStudent('admin', 'admin');
  askerId = await makeStudent('asker');
  otherId = await makeStudent('other');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: sessionUserId };
    next();
  });
  app.use('/api/inquiries', inquiriesRouter);
  app.use('/api/admin', adminRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    // inquiries.student_id는 ON DELETE CASCADE라 학생을 지우면 문의도 함께 지워진다.
    for (const id of [adminId, askerId, otherId]) if (id) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  } finally {
    await pool.end();
  }
});

test('답변을 적어 처리완료하면 문의자 본인 목록에 답변이 실린다', async () => {
  const id = await newInquiry('a');
  sessionUserId = adminId;
  const res = await admin('POST', `/inquiries/${id}/resolve`, { note: '  수정해서 배포했어요.  ' });
  assert.equal(res.status, 200);

  sessionUserId = askerId;
  const mine = (await inquiries('GET', '/mine')).json.data.find((i) => i.id === id);
  assert.equal(mine.status, 'resolved');
  assert.equal(mine.resolutionNote, '수정해서 배포했어요.'); // 앞뒤 공백은 잘린다
});

test('답변 없이 처리완료하면 resolutionNote는 null이다(빈 문자열·공백도 없는 것으로 본다)', async () => {
  const none = await newInquiry('b');
  const blank = await newInquiry('c');
  sessionUserId = adminId;
  assert.equal((await admin('POST', `/inquiries/${none}/resolve`)).status, 200);
  assert.equal((await admin('POST', `/inquiries/${blank}/resolve`, { note: '   ' })).status, 200);

  sessionUserId = askerId;
  const list = (await inquiries('GET', '/mine')).json.data;
  assert.equal(list.find((i) => i.id === none).resolutionNote, null);
  assert.equal(list.find((i) => i.id === blank).resolutionNote, null);
});

test('답변은 문의자 본인에게만 보이고, 관리자 목록에도 실린다', async () => {
  const id = await newInquiry('d');
  sessionUserId = adminId;
  await admin('POST', `/inquiries/${id}/resolve`, { note: '비공개 답변' });

  const adminList = (await admin('GET', '/inquiries?status=resolved')).json.data;
  assert.equal(adminList.find((i) => i.id === id).resolutionNote, '비공개 답변');

  sessionUserId = otherId;
  const others = (await inquiries('GET', '/mine')).json.data;
  assert.equal(others.find((i) => i.id === id), undefined);
});

test('답변이 너무 길거나 문자열이 아니면 400이고 문의는 그대로 대기 상태다', async () => {
  const id = await newInquiry('e');
  sessionUserId = adminId;
  const tooLong = await admin('POST', `/inquiries/${id}/resolve`, { note: 'ㅇ'.repeat(501) });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.json.code, 'INVALID_RESOLUTION_NOTE');
  assert.equal((await admin('POST', `/inquiries/${id}/resolve`, { note: 123 })).status, 400);

  const open = (await admin('GET', '/inquiries?status=open')).json.data;
  assert.ok(open.some((i) => i.id === id));
});

test('이미 처리완료된 문의는 다시 처리할 수 없고 처음 답변이 유지된다', async () => {
  const id = await newInquiry('f');
  sessionUserId = adminId;
  assert.equal((await admin('POST', `/inquiries/${id}/resolve`, { note: '첫 답변' })).status, 200);
  const again = await admin('POST', `/inquiries/${id}/resolve`, { note: '덮어쓰기' });
  assert.equal(again.status, 404);

  const resolved = (await admin('GET', '/inquiries?status=resolved')).json.data;
  assert.equal(resolved.find((i) => i.id === id).resolutionNote, '첫 답변');
});
