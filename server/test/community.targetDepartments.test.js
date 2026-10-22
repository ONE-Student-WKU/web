const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../db');
const communityRouter = require('../routes/community');
const { normalizeDepartmentIds } = require('../services/postDepartments');

/**
 * server/test/community.targetDepartments.test.js
 * 커뮤니티 글의 모집 학과(최대 3개, 비우면 학과 상관없음)와 "내 학과" 판정.
 * "내 학과"는 학교 문서로 확인된 개편 관계(department_lineage)로 이어진 학과까지 포함한다 —
 * 로컬 DB의 컴퓨터·소프트웨어공학과(1) → 공학3계열(2) DOC 관계를 쓴다. 임시 학생·글을 만들고 끝나면 지운다. 로컬 DB 전용.
 */

const run = Date.now();
const OLD_DEPT = 1; // 컴퓨터·소프트웨어공학과
const NEW_DEPT = 2; // 공학3계열(개편 후)
let otherDept;
let authorId;
let oldViewerId;
let newViewerId;
let otherViewerId;
let server;
let baseUrl;
let sessionUserId;

async function makeStudent(tag, departmentId) {
  const [r] = await pool.query('INSERT INTO students (email, name, department_id, onboarding_completed_at) VALUES (?, ?, ?, NOW())', [`td-${tag}-${run}@example.test`, `td${tag}${run}`, departmentId]);
  return r.insertId;
}

const api = async (method, path, body, userId = authorId) => {
  sessionUserId = userId;
  const res = await fetch(`${baseUrl}/api/community${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};

const post = (departmentIds) => ({ title: '모집글', body: '본문', category: 'study', departmentIds });

async function createApproved(departmentIds) {
  const { json } = await api('POST', '/', post(departmentIds));
  await pool.query("UPDATE community_posts SET status = 'approved' WHERE id = ?", [json.data.id]);
  return json.data.id;
}

const listedPost = async (id, viewerId) => (await api('GET', '/', null, viewerId)).json.data.find((p) => p.id === id);

before(async () => {
  const [[row]] = await pool.query('SELECT id FROM departments WHERE id NOT IN (?) AND id NOT IN (SELECT from_department_id FROM department_lineage WHERE to_department_id IN (?)) ORDER BY id LIMIT 1', [[OLD_DEPT, NEW_DEPT], [OLD_DEPT, NEW_DEPT]]);
  otherDept = row.id;
  authorId = await makeStudent('author', OLD_DEPT);
  oldViewerId = await makeStudent('old', OLD_DEPT);
  newViewerId = await makeStudent('new', NEW_DEPT);
  otherViewerId = await makeStudent('other', otherDept);
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
    for (const id of [authorId, oldViewerId, newViewerId, otherViewerId]) if (id) await pool.query('DELETE FROM students WHERE id = ?', [id]);
  } finally {
    await pool.end();
  }
});

test('입력 정리: 없으면 undefined(그대로 둠), null·[]는 학과 상관없음, 중복은 한 번만, 정수가 아니거나 3개 넘으면 null', () => {
  assert.equal(normalizeDepartmentIds(undefined), undefined);
  assert.deepEqual(normalizeDepartmentIds(null), []);
  assert.deepEqual(normalizeDepartmentIds([]), []);
  assert.deepEqual(normalizeDepartmentIds([3, '5', 3]), [3, 5]);
  assert.equal(normalizeDepartmentIds([1, 2, 3, 4]), null);
  assert.equal(normalizeDepartmentIds(['abc']), null);
  assert.equal(normalizeDepartmentIds([0]), null);
  assert.equal(normalizeDepartmentIds('1'), null);
});

test('글 작성: 고른 순서대로 모집 학과가 상세·목록·내 글에 내려온다', async () => {
  const id = await createApproved([otherDept, OLD_DEPT]);
  const detail = (await api('GET', `/${id}`)).json.data;
  assert.deepEqual(detail.targetDepartments.map((d) => d.id), [otherDept, OLD_DEPT]);
  assert.ok(detail.targetDepartments.every((d) => typeof d.name === 'string' && d.name));
  assert.deepEqual((await listedPost(id, oldViewerId)).targetDepartments.map((d) => d.id), [otherDept, OLD_DEPT]);
  const mine = (await api('GET', '/mine')).json.data.find((p) => p.id === id);
  assert.deepEqual(mine.targetDepartments.map((d) => d.id), [otherDept, OLD_DEPT]);
});

test('입력 검증: 3개 초과·없는 학과·숫자가 아닌 값은 400 INVALID_DEPARTMENTS, 비우거나 안 보내면 학과 상관없음', async () => {
  for (const bad of [[OLD_DEPT, NEW_DEPT, otherDept, 999999], [99999999], ['abc'], 'x']) {
    const res = await api('POST', '/', post(bad));
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.json.code, 'INVALID_DEPARTMENTS');
  }
  for (const empty of [[], undefined]) {
    const res = await api('POST', '/', post(empty));
    assert.equal(res.status, 201);
    assert.deepEqual((await api('GET', `/${res.json.data.id}`)).json.data.targetDepartments, []);
  }
});

test('내 학과: 같은 학과와 확인된 개편 전후 학과는 내 학과, 다른 학과는 아니고, 학과 상관없는 글도 아니다', async () => {
  const oldOnly = await createApproved([OLD_DEPT]);
  const newOnly = await createApproved([NEW_DEPT]);
  const anyDept = await createApproved([]);
  assert.equal((await listedPost(oldOnly, oldViewerId)).isMyDepartment, true);
  assert.equal((await listedPost(oldOnly, newViewerId)).isMyDepartment, true); // 개편 후 학생이 보는 개편 전 학과 글
  assert.equal((await listedPost(newOnly, oldViewerId)).isMyDepartment, true); // 개편 전 학생이 보는 개편 후 학과 글
  assert.equal((await listedPost(oldOnly, otherViewerId)).isMyDepartment, false);
  assert.equal((await listedPost(anyDept, oldViewerId)).isMyDepartment, false);
  assert.equal((await api('GET', `/${newOnly}`, null, oldViewerId)).json.data.isMyDepartment, true);
});

test('글 수정: 모집 학과를 보내지 않으면 그대로, 보내면 통째로 바뀌고 []면 학과 상관없음', async () => {
  const id = await createApproved([OLD_DEPT, NEW_DEPT]);
  const edit = (departmentIds) => api('PATCH', `/${id}`, post(departmentIds));
  const targets = async () => (await api('GET', `/${id}`)).json.data.targetDepartments.map((d) => d.id);

  assert.equal((await edit(undefined)).status, 200);
  assert.deepEqual(await targets(), [OLD_DEPT, NEW_DEPT]);
  assert.equal((await edit([otherDept])).status, 200);
  assert.deepEqual(await targets(), [otherDept]);
  assert.equal((await edit([])).status, 200);
  assert.deepEqual(await targets(), []);
  assert.equal((await edit([99999999])).json.code, 'INVALID_DEPARTMENTS');
});
