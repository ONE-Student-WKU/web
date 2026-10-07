const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { resolveRegulation } = require('../services/regulationEngine');

/**
 * server/test/regulationEngine.db.test.js
 * 규정 판단 엔진을 실제 시드 데이터로 끝까지(DB 조회 → 판정 → 변경 이력) 돌려본다.
 * 기준점은 chatContext/curriculumHistoryService 테스트와 총괄표 문서에 이미 검증돼 있는 값(컴소공 136, 공학3계열 130).
 * 전제: 시드 + seed:lineage + generate:curriculum-changes.
 */

after(async () => {
  await pool.end();
});

const ASOF = '2026-10-05';
const rule = (r, id) => r.rules.find((x) => x.id === id);

test('컴소공 2018학번 일반: 136학점 확정 + 이후 학번(2026 공학3계열 130)의 변경은 "이후 변경"으로만 나온다', async () => {
  const r = await resolveRegulation({ admissionYear: 2018, enrollmentType: 'GENERAL', departmentName: '컴퓨터·소프트웨어공학과', asOfDate: ASOF });
  const req = rule(r, 'REQUIREMENTS');
  assert.equal(req.value.totalRequiredCredits, 136);
  assert.equal(req.confidence, 'CONFIRMED');
  assert.equal(r.department.name, '컴퓨터·소프트웨어공학과');

  const rev = rule(r, 'CURRICULUM_REVISIONS');
  assert.equal(rev.critical, false);
  assert.ok(rev.value.GRAD_TOTAL.laterChanges.length > 0, '2018 이후 졸업학점 변경(2026 130 등)이 이력에 있어야 함');
  assert.ok(rev.value.GRAD_TOTAL.laterChanges.every((c) => c.toYear > 2018));
  assert.ok(req.value.totalRequiredCredits === 136, '이후 변경이 이 학번의 적용 규정을 바꾸지 않는다');
  assert.ok(rev.flags.some((f) => f.code === 'CURRICULUM_REVISION_AFTER_COHORT'));
});

test('공학3계열 2026학번 일반: 130학점', async () => {
  const r = await resolveRegulation({ admissionYear: 2026, enrollmentType: 'GENERAL', departmentName: '공학3계열', asOfDate: ASOF });
  assert.equal(rule(r, 'REQUIREMENTS').value.totalRequiredCredits, 130);
  assert.equal(rule(r, 'LIBERAL_ARTS_CAP').value.cap, 52);
});

test('경영학과 2020학번: 그 학과명으로는 자료가 없다 → 자료없음 + 개편 전 학과(경영학부, 이름 일치 추정)를 후보로만 안내', async () => {
  const r = await resolveRegulation({ admissionYear: 2020, enrollmentType: 'GENERAL', departmentName: '경영학과', asOfDate: ASOF });
  assert.equal(r.confidence, 'NO_DATA');
  assert.equal(rule(r, 'REQUIREMENTS').value, null);
  const flag = rule(r, 'REQUIREMENTS').flags.find((f) => f.code === 'NO_CURRICULUM_ROWS');
  const candidate = flag.candidates.find((c) => c.departmentName === '경영학부');
  assert.ok(candidate, '개편 관계 후보가 나와야 함');
  assert.equal(candidate.lineageSource, 'NAME_MATCH');
});

test('공학3계열 2027학번: 열린 범위 행이 있어도 2027 개편 전이라 자료없음(외삽 금지)', async () => {
  const r = await resolveRegulation({ admissionYear: 2027, enrollmentType: 'GENERAL', departmentName: '공학3계열', asOfDate: '2027-04-01' });
  assert.equal(r.confidence, 'NO_DATA');
  assert.ok(rule(r, 'REQUIREMENTS').flags.some((f) => f.code === 'COHORT_BEYOND_LATEST_DATA'));
  assert.equal(rule(r, 'REQUIREMENTS').value, null);
});

test('없는 학과명 / 학과 id', async () => {
  const byName = await resolveRegulation({ admissionYear: 2022, enrollmentType: 'GENERAL', departmentName: '없는학과', asOfDate: ASOF });
  assert.equal(byName.confidence, 'NO_DATA');
  assert.equal(byName.department, null);
  const byId = await resolveRegulation({ admissionYear: 2022, enrollmentType: 'GENERAL', departmentId: 99999999, asOfDate: ASOF });
  assert.equal(byId.confidence, 'NO_DATA');
});

test('DB를 쓰는 판정은 쓰기를 하지 않는다(요건 행 수가 호출 전후 동일)', async () => {
  const [[before]] = await pool.query('SELECT COUNT(*) AS c FROM curriculum_requirements');
  await resolveRegulation({ admissionYear: 2022, enrollmentType: 'MAJOR_CHANGE', departmentName: '컴퓨터·소프트웨어공학과', asOfDate: ASOF, majorChange: { grade: 3, year: 2024, semester: 1 } });
  const [[afterCount]] = await pool.query('SELECT COUNT(*) AS c FROM curriculum_requirements');
  assert.equal(afterCount.c, before.c);
});
