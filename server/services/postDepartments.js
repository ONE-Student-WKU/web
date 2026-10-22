const pool = require('../db');

/**
 * server/services/postDepartments.js
 * 커뮤니티 글의 모집 학과(community_post_departments)와 "내 학과" 판정(2026-10-22 피드백).
 * 제목만 보고는 자기 학과를 찾는 글인지 알 수 없어, 글마다 모집 학과(최대 3개, 없으면 "학과 상관없음")를 받고
 * 목록에 "내 학과" 표시를 붙인다.
 *
 * "내 학과"는 학생 학과와, 학교 문서로 확인된 개편 관계(department_lineage.source가 DOC·MANUAL)로 이어진 학과들을 같은 학과로 본다
 * — 컴퓨터·소프트웨어공학과 2022학번 학생에게 공학3계열 모집 글도 내 학과다. 이름이 비슷해서 이은 추정(NAME_MATCH)은 잘못 묶을 수 있어 뺀다.
 */

const MAX_TARGET_DEPARTMENTS = 3;

/**
 * 요청 값 → 학과 id 목록. 없으면(undefined) undefined(바꾸지 않음), null·[]는 [](학과 상관없음).
 * 정수가 아니거나 3개를 넘으면 null(잘못된 값). 같은 학과를 두 번 넣으면 한 번만 남긴다.
 */
function normalizeDepartmentIds(value) {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) return null;
  const ids = [];
  for (const v of value) {
    const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
    if (!Number.isInteger(n) || n <= 0) return null;
    if (!ids.includes(n)) ids.push(n);
  }
  return ids.length > MAX_TARGET_DEPARTMENTS ? null : ids;
}

/** 모든 id가 실제 학과인가. */
async function departmentsExist(ids) {
  if (ids.length === 0) return true;
  const [rows] = await pool.query('SELECT id FROM departments WHERE id IN (?)', [ids]);
  return rows.length === ids.length;
}

/** 글의 모집 학과를 통째로 바꾼다. 글 작성·수정 트랜잭션의 커넥션(conn)으로 실행한다. */
async function replacePostDepartments(conn, postId, ids) {
  await conn.query('DELETE FROM community_post_departments WHERE post_id = ?', [postId]);
  if (ids.length === 0) return;
  await conn.query('INSERT INTO community_post_departments (post_id, department_id, position) VALUES ?', [ids.map((id, i) => [postId, id, i])]);
}

/** 학생 학과와 확인된 개편 관계로 이어진 학과 id 묶음(앞뒤로 끝까지 따라간다). 학과가 없으면 빈 묶음. */
async function departmentFamily(departmentId) {
  const family = new Set();
  if (!departmentId) return family;
  const [edges] = await pool.query(
    `SELECT from_department_id AS a, to_department_id AS b FROM department_lineage
     WHERE source <> 'NAME_MATCH' AND from_department_id IS NOT NULL AND to_department_id IS NOT NULL`
  );
  const neighbors = new Map();
  for (const { a, b } of edges) {
    if (!neighbors.has(a)) neighbors.set(a, []);
    if (!neighbors.has(b)) neighbors.set(b, []);
    neighbors.get(a).push(b);
    neighbors.get(b).push(a);
  }
  const queue = [Number(departmentId)];
  while (queue.length) {
    const id = queue.shift();
    if (family.has(id)) continue;
    family.add(id);
    for (const next of neighbors.get(id) || []) if (!family.has(next)) queue.push(next);
  }
  return family;
}

/**
 * 글 목록에 모집 학과(targetDepartments: [{ id, name }], 고른 순서)를 붙이고, viewerDepartmentId를 주면 isMyDepartment도 붙인다.
 * 학과 상관없는 글은 targetDepartments가 []이고 isMyDepartment는 false다(화면이 "모든 학과"로 보여 주고 "내 학과 글만 보기"에도 남긴다).
 */
async function attachTargetDepartments(posts, { viewerDepartmentId = null } = {}) {
  if (posts.length === 0) return posts;
  const [rows] = await pool.query(
    `SELECT pd.post_id, d.id, d.name FROM community_post_departments pd
     JOIN departments d ON d.id = pd.department_id
     WHERE pd.post_id IN (?) ORDER BY pd.post_id, pd.position`,
    [posts.map((p) => p.id)]
  );
  const byPost = new Map();
  for (const r of rows) {
    if (!byPost.has(r.post_id)) byPost.set(r.post_id, []);
    byPost.get(r.post_id).push({ id: r.id, name: r.name });
  }
  const family = viewerDepartmentId ? await departmentFamily(viewerDepartmentId) : null;
  return posts.map((p) => {
    const targetDepartments = byPost.get(p.id) || [];
    return {
      ...p,
      targetDepartments,
      ...(family ? { isMyDepartment: targetDepartments.some((d) => family.has(d.id)) } : {}),
    };
  });
}

module.exports = {
  MAX_TARGET_DEPARTMENTS,
  normalizeDepartmentIds,
  departmentsExist,
  replacePostDepartments,
  departmentFamily,
  attachTargetDepartments,
};
