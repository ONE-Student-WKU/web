const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const communityService = require('../services/communityService');
const communityRouter = require('../routes/community');

/**
 * server/test/community.search.test.js
 * 게시글 검색(MVP): GET /api/community?q= 가 승인된 글 중 제목이나 본문에 검색어가 들어간 글만 최신순으로 내려주는지.
 * 임시 학생·글을 만들고 끝나면 지운다(학생 삭제 시 CASCADE). 로컬 DB 전용.
 */

const run = Date.now();
const TAG = `검색테스트${run}`;
let authorId;
let server;
let baseUrl;

before(async () => {
  const [r] = await pool.query('INSERT INTO students (email, name, onboarding_completed_at) VALUES (?, ?, NOW())', [`cs-${run}@example.test`, `cs${run}`]);
  authorId = r.insertId;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: authorId };
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
  if (server) await new Promise((resolve) => server.close(resolve));
  if (authorId) await pool.query('DELETE FROM students WHERE id = ?', [authorId]);
  await pool.end();
});

async function makePost(title, body, status = 'approved', createdAt = null) {
  const id = await communityService.createPost(authorId, { title, body, category: 'study', capacity: null });
  await pool.query('UPDATE community_posts SET status = ? WHERE id = ?', [status, id]);
  if (createdAt) await pool.query('UPDATE community_posts SET created_at = ? WHERE id = ?', [createdAt, id]);
  return id;
}

async function search(q) {
  const res = await fetch(`${baseUrl}/api/community?q=${encodeURIComponent(q)}`);
  assert.equal(res.status, 200);
  return (await res.json()).data;
}

test('normalizeSearchQuery: 앞뒤 공백을 버리고 길이를 제한하며 문자열이 아니면 빈 문자열', () => {
  assert.equal(communityService.normalizeSearchQuery('  스터디  '), '스터디');
  assert.equal(communityService.normalizeSearchQuery('a'.repeat(80)).length, 50);
  assert.equal(communityService.normalizeSearchQuery(undefined), '');
  assert.equal(communityService.normalizeSearchQuery(['a', 'b']), '');
});

test('제목에 검색어가 있는 글과 본문에 검색어가 있는 글을 모두 찾고, 상관없는 글은 뺀다', async () => {
  const inTitle = await makePost(`${TAG} 제목`, '내용은 평범');
  const inBody = await makePost('다른 제목', `본문 안에 ${TAG} 포함`);
  const unrelated = await makePost('전혀 다른 글', '아무 관련 없음');

  const found = await search(TAG);
  const ids = found.map((p) => p.id);
  assert.ok(ids.includes(inTitle), '제목 일치');
  assert.ok(ids.includes(inBody), '본문 일치');
  assert.ok(!ids.includes(unrelated), '불일치 글은 제외');
});

test('승인되지 않은 글(대기·반려)은 검색에 나오지 않는다', async () => {
  const tag = `${TAG}비공개`;
  const pending = await makePost(`${tag} 대기`, '본문', 'pending');
  const rejected = await makePost(`${tag} 반려`, '본문', 'rejected');
  const approved = await makePost(`${tag} 승인`, '본문', 'approved');

  const ids = (await search(tag)).map((p) => p.id);
  assert.deepEqual(ids, [approved]);
  assert.ok(!ids.includes(pending) && !ids.includes(rejected));
});

test('결과는 최신순이다', async () => {
  const tag = `${TAG}순서`;
  const older = await makePost(`${tag} 오래된 글`, '본문', 'approved', '2026-01-01 10:00:00');
  const newer = await makePost(`${tag} 새 글`, '본문', 'approved', '2026-06-01 10:00:00');
  const ids = (await search(tag)).map((p) => p.id);
  assert.deepEqual(ids, [newer, older]);
});

test('검색어의 %와 _는 와일드카드가 아니다 — 문장부호는 무시하고, 문장부호뿐인 검색어는 아무것도 찾지 않는다', async () => {
  const id = await makePost(`${TAG} 문장부호 100% 완료`, '본문');
  const ids = (await search(`${TAG} 문장부호 100_ 완료`)).map((p) => p.id);
  assert.ok(ids.includes(id), '문장부호 차이는 무시');
  assert.deepEqual(await search('%'), []);
  assert.deepEqual(await search('_'), []);
});

test('띄어쓰기가 달라도 찾는다', async () => {
  const id = await makePost(`${TAG}알고리즘스터디`, '본문');
  const ids = (await search(`${TAG} 알고리즘 스터디`)).map((p) => p.id);
  assert.ok(ids.includes(id));
});

test('제목 일치가 본문 일치보다 앞에 오고, 같은 단계에서는 최신순이다', async () => {
  const tag = `${TAG}정렬`;
  const bodyNew = await makePost('아무 제목', `본문에 ${tag} 포함`, 'approved', '2026-07-01 10:00:00');
  const titleOld = await makePost(`${tag} 제목`, '본문', 'approved', '2026-01-01 10:00:00');
  const titleNew = await makePost(`${tag} 새 제목`, '본문', 'approved', '2026-05-01 10:00:00');
  const ids = (await search(tag)).map((p) => p.id);
  // 제목에서 시작하는 글(최신순) → 본문에만 있는 글
  assert.deepEqual(ids, [titleNew, titleOld, bodyNew]);
});

test('초성으로도 찾는다', async () => {
  const id = await makePost('초성검색용 알고리즘 스터디 모집', '본문');
  const ids = (await search('ㅇㄱㄹㅈ')).map((p) => p.id);
  assert.ok(ids.includes(id));
});

test('정확히 일치하는 글이 없을 때만 오타(자모 한 글자)를 허용해 찾는다', async () => {
  const id = await makePost('오타허용검증 자료구조 스터디', '본문');
  assert.ok((await search('오타허용검증 자료구죠')).map((p) => p.id).includes(id));
});

test('q가 없거나 공백뿐이면 검색하지 않고 승인된 전체 목록을 준다(기존 동작)', async () => {
  const id = await makePost(`${TAG} 전체목록용`, '본문');
  const all = (await (await fetch(`${baseUrl}/api/community`)).json()).data;
  assert.ok(all.some((p) => p.id === id));
  const blank = await search('   ');
  assert.ok(blank.some((p) => p.id === id));
});

test('결과 항목은 목록과 같은 필드를 가진다', async () => {
  await makePost(`${TAG} 필드확인`, '본문');
  const [first] = await search(`${TAG} 필드확인`);
  for (const k of ['id', 'title', 'body', 'category', 'capacity', 'closedAt', 'createdAt', 'author', 'recruitEndDate', 'recruitState']) {
    assert.ok(k in first, k);
  }
});
