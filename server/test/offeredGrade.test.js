const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { resolveOfferedGrade, lineageCandidateKeys } = require('../services/regulationEngine/offeredGrade');
const { attachOfferedGrades } = require('../services/regulationEngine/dbProvider');

/**
 * server/test/offeredGrade.test.js
 * 제13조③ 개설 학년 조회(보정 라운드 B, D-45): 학수번호가 바뀐 과목은 course_lineage로 이어서 정확히 찾고, 계보도 없을 때만 근사 + 표시.
 */

after(async () => { await pool.end(); });

const course = (key, grade, min = null, max = null) => ({ course_key: key, grade, min_admission_year: min, max_admission_year: max });
const edge = (from, to, year, over = {}) => ({ from_course_key: from, to_course_key: to, relation: 'RENAME', effective_year: year, department_id: 1, ...over });
const change = (over = {}) => ({ subjectKey: 'C:OLD', toYear: 2024, ...over });

test('to_year 편성표에 그 학수번호가 있으면 계보 없이 EXACT', () => {
  const r = resolveOfferedGrade(change(), [course('C:OLD', 2, 2020, null)], [], [1]);
  assert.deepEqual([r.offeredGrade, r.offeredGradeSource], [2, 'EXACT']);
});

test('학수번호가 바뀐 과목: 계보(옛 → 새, 효력 ≤ to_year)로 이어 to_year 편성표에서 정확히 찾는다(LINEAGE, 근사 아님)', () => {
  // 옛 학수번호 편성표는 2019 이전뿐 — 예전 방식이면 가장 가까운 2019 편성표(4학년)를 빌렸을 것
  const rows = [course('C:OLD', 4, null, 2019), course('C:NEW', 2, 2020, null)];
  const r = resolveOfferedGrade(change(), rows, [edge('C:OLD', 'C:NEW', 2020)], [1]);
  assert.deepEqual([r.offeredGrade, r.offeredGradeSource, r.via], [2, 'LINEAGE', ['C:NEW']]);
});

test('계보가 두 번 이어져도(A→B→C) 따라간다', () => {
  const rows = [course('C:OLD', 4, null, 2018), course('C:C', 1, 2021, null)];
  const r = resolveOfferedGrade(change(), rows, [edge('C:OLD', 'C:B', 2019), edge('C:B', 'C:C', 2021)], [1]);
  assert.deepEqual([r.offeredGrade, r.offeredGradeSource], [1, 'LINEAGE']);
});

test('to_year보다 늦은 개명은 뒤로 따라간다(to_year 편성표에는 아직 옛 학수번호)', () => {
  const rows = [course('C:OLDER', 3, null, 2025), course('C:X', 1, 2026, null)];
  const r = resolveOfferedGrade(change({ subjectKey: 'C:X', toYear: 2024 }), rows, [edge('C:OLDER', 'C:X', 2026)], [1]);
  assert.deepEqual([r.offeredGrade, r.offeredGradeSource], [3, 'LINEAGE']);
});

test('앞으로 따라가는 간선은 효력 학년도가 to_year 이하일 때만(아직 일어나지 않은 개명은 쓰지 않는다)', () => {
  const keys = lineageCandidateKeys('C:OLD', 2024, [edge('C:OLD', 'C:NEW', 2026)], [1]);
  assert.equal(keys.has('C:NEW'), false);
});

test('MERGE·SPLIT·ABOLISH는 한 과목으로 이어지지 않아 따라가지 않는다 / 다른 학과의 계보도 제외', () => {
  const keys = lineageCandidateKeys('C:OLD', 2024, [edge('C:OLD', 'C:M', 2020, { relation: 'MERGE' }), edge('C:OLD', 'C:O', 2020, { department_id: 99 })], [1]);
  assert.equal(keys.size, 0);
});

test('계보가 없으면 예전 근사(NEAREST_SNAPSHOT)를 유지한다 — 표시(플래그)는 이 값으로 붙는다', () => {
  const r = resolveOfferedGrade(change(), [course('C:OLD', 4, null, 2019)], [], [1]);
  assert.deepEqual([r.offeredGrade, r.offeredGradeSource], [4, 'NEAREST_SNAPSHOT']);
});

test('옛 학수번호도 계보도 없으면 개설 학년을 모른다(null) — 추측하지 않는다', () => {
  const r = resolveOfferedGrade(change(), [], [], [1]);
  assert.deepEqual([r.offeredGrade, r.offeredGradeSource], [null, null]);
});

test('DB: 건축학과 BIM통합설계2(C:350066, 2025→2026)는 계보로 4학년(예전 근사는 3학년)', async () => {
  const [[dept]] = await pool.query("SELECT id FROM departments WHERE name = '건축학과' LIMIT 1");
  const ch = { subjectKey: 'C:350066', departmentId: dept.id, fromYear: 2025, toYear: 2026, field: 'category', oldValue: '전공선택', newValue: '전공필수', offeredGrade: null };
  const [out] = await attachOfferedGrades([ch], [dept.id]);
  assert.deepEqual([out.offeredGrade, out.offeredGradeSource], [4, 'LINEAGE']);
});

test('DB: 카테고리 이외의 변경은 건드리지 않는다', async () => {
  const ch = { subjectKey: 'C:350066', field: 'credits', toYear: 2026, offeredGrade: null };
  const [out] = await attachOfferedGrades([ch], [1]);
  assert.equal(out, ch);
});
