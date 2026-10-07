const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const communityService = require('../services/communityService');
const communityRouter = require('../routes/community');

/**
 * server/test/community.recruitPeriod.test.js
 * 모집 마감일(선택, 오늘부터 1년 이내): 입력 검증, 상태 판정(open/ended/closed), 마감일 지난 글의 신청 제한,
 * 마감일 수정 시 재승인. 임시 학생·글·신청을 만들고 끝나면 지운다. 로컬 DB 전용.
 */

const run = Date.now();
let authorId;
let applicantId;
let server;
let baseUrl;
let sessionUserId;

const dayOffset = (days) => communityService.addDaysToDate(communityService.todayKst(), days);

async function makeStudent(tag) {
  const [r] = await pool.query('INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())', [`rc-${tag}-${run}@example.test`, `rc${tag}${run}`]);
  return r.insertId;
}

// 마감일 검증은 "오늘 이후"만 받으므로, 지난 마감일이 필요한 테스트는 글을 만든 뒤 DB 값을 직접 과거로 돌린다.
async function makeApprovedPost(recruitEndDate = null) {
  const id = await communityService.createPost(authorId, { title: '모집글', body: '본문', category: 'study', capacity: null, recruitEndDate });
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [id]);
  return id;
}

const api = async (method, path, body) => {
  const res = await fetch(`${baseUrl}/api/community${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};

before(async () => {
  authorId = await makeStudent('author');
  applicantId = await makeStudent('applicant');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: sessionUserId };
    next();
  });
  app.use('/api/community', communityRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const id of [authorId, applicantId]) if (id) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  } finally {
    await pool.end();
  }
});

test('상태 판정: 마감일 없음·마감일 당일까지 모집·마감일 지남·직접 마감(직접 마감이 우선)', () => {
  const today = '2026-10-10';
  const state = (o) => communityService.recruitStateOf(o, today);
  assert.equal(state({ closedAt: null, recruitEndDate: null }), 'open');
  assert.equal(state({ closedAt: null, recruitEndDate: '2026-10-10' }), 'open'); // 마감일 당일까지 모집
  assert.equal(state({ closedAt: null, recruitEndDate: '2026-10-09' }), 'ended');
  assert.equal(state({ closedAt: new Date(), recruitEndDate: '2026-10-20' }), 'closed');
});

test('오늘 날짜는 한국 시간 기준이다(UTC 15시 이후는 한국 기준 다음 날), 날짜 더하기는 시간대 영향이 없다', () => {
  assert.equal(communityService.todayKst(Date.parse('2026-10-10T14:59:59Z')), '2026-10-10');
  assert.equal(communityService.todayKst(Date.parse('2026-10-10T15:00:00Z')), '2026-10-11');
  assert.equal(communityService.addDaysToDate('2026-12-31', 1), '2027-01-01');
  assert.equal(communityService.addDaysToDate('2026-10-10', 365), '2027-10-10');
});

test('글 작성: 마감일을 저장하고 목록·상세·내 글에 날짜와 상태가 내려온다(시작일 필드는 없다)', async () => {
  sessionUserId = authorId;
  const created = await api('POST', '/', { title: '기한 글', body: '본문', category: 'study', capacity: 3, recruitEndDate: dayOffset(5) });
  assert.equal(created.status, 201);
  const id = created.json.data.id;
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [id]);

  const mine = (await api('GET', '/mine')).json.data.find((p) => p.id === id);
  assert.equal(mine.recruitEndDate, dayOffset(5));
  assert.equal(mine.recruitState, 'open');
  assert.equal('recruitStartDate' in mine, false);
  const list = (await api('GET', '/')).json.data.find((p) => p.id === id);
  assert.equal(list.recruitEndDate, dayOffset(5));
  assert.equal(list.recruitState, 'open');
  const detail = (await api('GET', `/${id}`)).json.data;
  assert.equal(detail.recruitState, 'open');
});

test('입력 검증: 형식 오류·없는 날짜·지난 날짜·1년 초과는 400, 오늘·정확히 1년 뒤·비움은 허용', async () => {
  sessionUserId = authorId;
  const base = { title: '검증', body: '본문', category: 'study', capacity: null };
  for (const bad of [
    { recruitEndDate: '2026/10/01' },
    { recruitEndDate: '2026-02-30' },
    { recruitEndDate: 20261010 },
    { recruitEndDate: dayOffset(-1) },
    { recruitEndDate: dayOffset(366) },
  ]) {
    const res = await api('POST', '/', { ...base, ...bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.json.code, 'INVALID_RECRUIT_END');
  }
  for (const ok of [dayOffset(0), dayOffset(365), '', null]) {
    const res = await api('POST', '/', { ...base, recruitEndDate: ok });
    assert.equal(res.status, 201, String(ok));
  }
  const [[row]] = await pool.query('SELECT recruit_end_date FROM community_posts WHERE author_id = ? ORDER BY id DESC LIMIT 1', [authorId]);
  assert.equal(row.recruit_end_date, null);
});

test('글 수정: 마감일을 바꾸면 재승인 대기(pending)로 돌아가 목록에서 사라진다, 지우면 마감일 없음', async () => {
  sessionUserId = authorId;
  const id = await makeApprovedPost(dayOffset(3));
  const edit = await api('PATCH', `/${id}`, { title: '수정', body: '본문', category: 'study', capacity: null, recruitEndDate: dayOffset(10) });
  assert.equal(edit.status, 200);
  const [[row]] = await pool.query("SELECT status, DATE_FORMAT(recruit_end_date, '%Y-%m-%d') e FROM community_posts WHERE id = ?", [id]);
  assert.deepEqual([row.status, row.e], ['pending', dayOffset(10)]);
  assert.equal((await api('GET', '/')).json.data.some((p) => p.id === id), false); // 승인 전엔 공개 목록에 없음

  const cleared = await api('PATCH', `/${id}`, { title: '수정', body: '본문', category: 'study', capacity: null, recruitEndDate: null });
  assert.equal(cleared.status, 200);
  const [[row2]] = await pool.query('SELECT recruit_end_date FROM community_posts WHERE id = ?', [id]);
  assert.equal(row2.recruit_end_date, null);

  const bad = await api('PATCH', `/${id}`, { title: '수정', body: '본문', category: 'study', capacity: null, recruitEndDate: dayOffset(400) });
  assert.equal(bad.status, 400);
});

test('신청: 마감일이 지난 글은 RECRUIT_ENDED로 거부되고 신청이 만들어지지 않는다, 마감일 당일·마감일 없음은 가능', async () => {
  const ended = await makeApprovedPost(dayOffset(5));
  await pool.query('UPDATE community_posts SET recruit_end_date = ? WHERE id = ?', [dayOffset(-1), ended]);
  const lastDay = await makeApprovedPost(dayOffset(0));
  const noDeadline = await makeApprovedPost();

  sessionUserId = applicantId;
  const r = await api('POST', `/${ended}/apply`, { message: '신청' });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'RECRUIT_ENDED');
  assert.equal((await api('POST', `/${lastDay}/apply`, { message: '신청' })).status, 201);
  assert.equal((await api('POST', `/${noDeadline}/apply`, { message: '신청' })).status, 201);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM community_applications WHERE post_id = ?', [ended]);
  assert.equal(n, 0);
});

test('마감일만 지난 글: 직접 마감(closed_at)은 건드리지 않고, 이미 달린 대기 신청은 그대로 검토할 수 있다', async () => {
  const id = await makeApprovedPost(dayOffset(5));
  const applied = await communityService.applyToPost(id, applicantId, '일찍 낸 신청');
  assert.equal(applied.ok, true);
  await pool.query('UPDATE community_posts SET recruit_end_date = ? WHERE id = ?', [dayOffset(-1), id]);

  sessionUserId = authorId;
  const detail = (await api('GET', `/${id}`)).json.data;
  assert.equal(detail.recruitState, 'ended');
  assert.equal(detail.closedAt, null);

  // 수락은 이메일 프록시(EMAIL_PROXY_DOMAIN)가 필요해 테스트 환경에서는 반려로 "아직 검토할 수 있다"를 확인한다.
  const rejected = await api('POST', `/applications/${applied.id}/reject`, { reason: '기간이 끝났어요' });
  assert.equal(rejected.status, 200);
  const [[row]] = await pool.query('SELECT status FROM community_applications WHERE id = ?', [applied.id]);
  assert.equal(row.status, 'rejected');
});

test('내 신청 목록에 글의 모집 상태(postRecruitState)가 같이 내려온다', async () => {
  const id = await makeApprovedPost(dayOffset(4));
  await communityService.applyToPost(id, applicantId, '신청');
  sessionUserId = applicantId;
  const open = (await api('GET', '/applications/mine')).json.data.find((a) => a.postId === id);
  assert.equal(open.postRecruitState, 'open');
  await pool.query('UPDATE community_posts SET recruit_end_date = ? WHERE id = ?', [dayOffset(-1), id]);
  const ended = (await api('GET', '/applications/mine')).json.data.find((a) => a.postId === id);
  assert.equal(ended.postRecruitState, 'ended');
});
