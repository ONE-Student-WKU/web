const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { resolveYearContext } = require('../services/yearContext');
const { assembleStructuredChunks, mergeChunks } = require('../services/chatContextService');
const curriculumContext = require('../services/curriculumContextService');

/**
 * server/test/chatRequirementChunk.test.js
 * 챗봇 졸업요건 청크가 규정 판단 결과와 어긋나지 않는지(FINAL_REVIEW F-2·F-4, 보정 라운드 A 2-2, DECISIONS D-35).
 *  - 자료 범위 밖 학번(2027)·자료 없는 학과·학번(공학3계열 2018)에 다른 학번/학과 값을 "이 학생의 요건"으로 내지 않는다
 *  - 전과생·편입생 청크가 진단·판단과 같은 숫자(전과 전공 48·합계 136, 편입 합계 미확정)를 쓴다
 *  - 학년도 질문("2026학년도 졸업요건")처럼 특정 학생이 아닌 질문은 기존 동작 유지
 * AI 호출 없음. 로컬 시드 전제.
 */

const D = {};
before(async () => {
  const [depts] = await pool.query('SELECT id, name FROM departments');
  for (const d of depts) D[d.name] = d.id;
});
after(async () => { await pool.end(); });

const BOOKS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
async function ask(student, message, today = '2026-10-05') {
  const yearContext = resolveYearContext({ message, profileCohort: student.admission_year, availableBookYears: BOOKS, today });
  const structured = await assembleStructuredChunks({ message, searchText: message, student, yearContext });
  return { structured, merged: mergeChunks({ structured, yearContext }), yearContext };
}
const row = (dept, year, type = 'GENERAL', mc = {}) => ({
  department_id: D[dept], admission_year: year, enrollment_type: type,
  major_change_grade: mc.grade ?? null, major_change_year: mc.year ?? null, major_change_semester: mc.semester ?? null,
});
const gradChunk = (merged) => merged.find((c) => String(c.chunkId).startsWith('graduation-'));

test('2027학번(자료 범위 밖): 판단도 청크도 자료없음 — 2026 값(130학점)을 "2027학번 졸업요건"으로 내지 않는다 (F-2)', async () => {
  const { merged, structured } = await ask(row('공학3계열', 2027), '내 졸업요건이 뭐야?', '2027-04-01');
  assert.equal(structured.judgment.confidence, 'NO_DATA');
  const g = gradChunk(merged);
  assert.match(g.documentTitle, /2027학번 졸업요건 \(자료 없음\)/);
  assert.doesNotMatch(g.content, /130학점|교양필수 25/);
  assert.match(g.content, /학과·계열 개편이 예정되어 있어/);
  assert.match(g.content, /학사지원과\(063-850-5228\)/);
});

test('판단 없이 2027학년도를 직접 물어도(학년도 질문) 외삽하지 않는다', async () => {
  const chunk = (await curriculumContext.lookupGraduationRequirements({
    message: '2027학년도 졸업요건 알려줘', student: row('공학3계열', 2026),
    yearContext: resolveYearContext({ message: '2027학년도 졸업요건 알려줘', profileCohort: 2026, availableBookYears: BOOKS, today: '2026-10-05' }),
  }))[0];
  assert.match(chunk.documentTitle, /\(자료 없음\)/);
  assert.doesNotMatch(chunk.content, /130학점/);
});

test('공학3계열 2018학번(그 학번에 없던 학과): 컴소공 2018 값을 이 학생의 요건처럼 내지 않는다 (B-14)', async () => {
  const { merged, structured } = await ask(row('공학3계열', 2018), '졸업요건 알려줘');
  assert.equal(structured.judgment.confidence, 'NO_DATA');
  const g = gradChunk(merged);
  assert.match(g.documentTitle, /\(자료 없음\)/);
  assert.doesNotMatch(g.content, /136학점|전공필수\(기본전공\) 19학점/);
});

test('학년도 질문(특정 학생 아님)은 기존 동작: 개편으로 이어진 학과의 그 해 값을 개편 사실과 함께 보여 준다', async () => {
  const { merged } = await ask(row('컴퓨터·소프트웨어공학과', 2022), '2026학년도 졸업요건이 뭐야?');
  const g = merged.filter((c) => String(c.chunkId).startsWith('graduation-')).find((c) => /2026학번/.test(c.documentTitle));
  assert.ok(g, '2026학번 졸업요건 청크');
  assert.match(g.content, /130학점/);
  assert.match(g.content, /개편된 공학3계열로 편성/);
});

test('3학년 전과생: 청크가 진단과 같은 숫자(전공 48, 합계 136)와 "전과생 기준" 표시 (F-4)', async () => {
  const { merged } = await ask(row('컴퓨터·소프트웨어공학과', 2022, 'MAJOR_CHANGE', { grade: 3, year: 2024, semester: 2 }), '전과생인데 졸업요건이 어떻게 돼?');
  const g = gradChunk(merged);
  assert.match(g.documentTitle, /\(전과생 기준\)/);
  assert.match(g.content, /\[2022학번 적용 요건 — 전과생 기준/);
  assert.match(g.content, /전공: 48학점/);
  assert.doesNotMatch(g.content, /전공필수\(기본전공\) 19학점/);
  assert.match(g.content, /졸업학점 합계\(교양\+전공\+일반선택\): 136학점/);
});

test('편입생: 카테고리별 기준은 참고값이고 합계는 확정할 수 없다고 적는다(예전 청크는 일반 재학생 136을 줬다)', async () => {
  const { merged } = await ask(row('컴퓨터·소프트웨어공학과', 2023, 'TRANSFER_ADMISSION'), '편입생인데 졸업하려면 몇 학점 들어야 해?');
  const g = gradChunk(merged);
  assert.match(g.documentTitle, /\(편입생 기준\)/);
  assert.doesNotMatch(g.content, /졸업학점 합계\(교양\+전공\+일반선택\)/);
  assert.match(g.content, /졸업학점 합계: 편입생은 전적대학 인정학점에 따라 달라 확정할 수 없다/);
  assert.match(g.content, /이 요건 값의 신뢰도: 추정/);
});

test('일반 재학생은 예전과 같은 숫자·형식(회귀)', async () => {
  const { merged } = await ask(row('컴퓨터·소프트웨어공학과', 2020), '20학번인데 졸업요건이 뭐야?');
  const g = gradChunk(merged);
  assert.match(g.content, /\[2020학번 적용 요건 — 일반 재학생 기준\]/);
  assert.match(g.content, /졸업학점 합계\(교양\+전공\+일반선택\): 136학점/);
  assert.equal(g.documentTitle, '컴퓨터·소프트웨어공학과 2020학번 졸업요건');
});

// --- 2-4: 본인 학번을 질문에서 말해도 입학유형을 유지(F-3, D-37) ---

test('전과생이 "22학번인데"라고 본인 학번을 말해도 프로필 취급 — 전과생 판단·가정 문구 없음', async () => {
  const student = row('컴퓨터·소프트웨어공학과', 2022, 'MAJOR_CHANGE', { grade: 3, year: 2024, semester: 2 });
  const { structured, merged } = await ask(student, '22학번인데 졸업요건이 뭐야?');
  assert.equal(structured.judgment.input.enrollmentType, 'MAJOR_CHANGE');
  assert.doesNotMatch(merged[0].content, /일반 재학생으로 가정/);
  assert.match(merged[0].content, /전과생 기준/);
  assert.match(gradChunk(merged).content, /전공: 48학점/);
});

test('프로필과 다른 학번을 말하면 일반 재학생 가정 + 가정임을 밝힌다(기존 동작)', async () => {
  const student = row('컴퓨터·소프트웨어공학과', 2022, 'MAJOR_CHANGE', { grade: 3, year: 2024, semester: 2 });
  const { structured, merged } = await ask(student, '21학번은 졸업요건이 뭐야?');
  assert.equal(structured.judgment.input.enrollmentType, 'GENERAL');
  assert.equal(structured.judgment.input.admissionYear, 2021);
  assert.match(merged[0].content, /일반 재학생으로 가정/);
});

test('프로필과 같은 학번이라도 다른 학과를 말하면 가정(그 학과 일반 재학생)', async () => {
  const student = row('컴퓨터·소프트웨어공학과', 2022, 'TRANSFER_ADMISSION');
  const { structured, merged } = await ask(student, '22학번 간호학과 졸업요건이 뭐야?');
  assert.equal(structured.judgment.department.name, '간호학과');
  assert.equal(structured.judgment.input.enrollmentType, 'GENERAL');
  assert.match(merged[0].content, /일반 재학생으로 가정/);
});

test('온보딩 전 학생(프로필 값 없음)은 가정으로 처리하되 학번·학과를 말하면 판단은 한다', async () => {
  const { structured, merged } = await ask({ department_id: null, admission_year: null, enrollment_type: null }, '20학번 컴퓨터·소프트웨어공학과 졸업요건이 뭐야?');
  assert.equal(structured.judgment.input.admissionYear, 2020);
  assert.match(merged[0].content, /일반 재학생으로 가정/);
});
