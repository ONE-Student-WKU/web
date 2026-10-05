const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { extractSchedule4, extractSchedule1Colleges, COLLEGES_OUT_PATH, OUT_PATH, parseTables, cohortRangeFromTitle, entriesFromCell } = require('../../scripts/audit/hwpxTables');
const { findSchedule4Entry, generalTotalCredits, checkSchedule4Credits, loadSchedule4, loadSchedule1Colleges, collegeOf } = require('../services/regulationEngine/schedule4');
const { resolveApplicableRules } = require('../services/regulationEngine/applicability');
const { getGraduationStatus } = require('../services/graduationService');
const { assembleStructuredChunks, mergeChunks } = require('../services/chatContextService');
const { resolveYearContext } = require('../services/yearContext');
const { buildRegulationSeed } = require('../services/regulationEngine/regulationSeed');

/**
 * server/test/schedule4.test.js
 * 학칙 [별표 4] 졸업학점표 ↔ 책자 졸업학점 대조(FINAL_REVIEW F-1, 보정 라운드 A 2-1, DECISIONS D-34).
 * 원본 HWPX를 직접 읽은 결과(변환본 txt 판독이 아님)를 고정하고, 불일치가 "추정 + 두 값 표시"로만 나오며 숫자는 안 바뀌는지 본다.
 * 앞쪽은 DB 없음, 뒤쪽(DB)은 로컬 시드 전제.
 */

after(async () => { await pool.end(); });

const tierOf = (table, credits) => table.tiers.find((t) => t.credits === credits);
const names = (tier) => tier.entries.map((e) => e.name);
const ROOT = path.resolve(__dirname, '..', '..');

function loadSeed() {
  const manual = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'regulation-engine', 'applicability.json'), 'utf8'));
  const texts = Object.fromEntries(manual.documents.map((d) => [d.docCode, fs.readFileSync(path.join(ROOT, d.file), 'utf8')]));
  return buildRegulationSeed({ texts, manual });
}

test('HWPX 원본 직접 파싱: [별표 4] 표 4개, 학번 구간·제목이 맞다', () => {
  const s = extractSchedule4();
  assert.deepEqual(s.tables.map((t) => t.cohort), [{ min: 2026, max: null }, { min: 2025, max: 2025 }, { min: 2013, max: 2024 }, { min: null, max: 2012 }]);
  assert.match(s.tables[2].title, /2013학년도 ~ 2024학년도 입학생.*개정 2026\. 4\. 10\., 2026\. 6\. 26\./);
});

test('HWPX 원본 직접 파싱: ③(2013~2024학번) 130학점 칸에 간호·응급구조·국방기술·작업치료학과가 학과명으로 적혀 있다 — 변환본 오판독이 아니다', () => {
  const t3 = extractSchedule4().tables[2];
  const t130 = names(tierOf(t3, 130));
  for (const n of ['간호학과', '응급구조학과', '국방기술학과', '작업치료학과']) assert.ok(t130.includes(n), n);
  assert.deepEqual(names(tierOf(t3, 136)), ['창의공과대학']);
  assert.deepEqual(names(tierOf(t3, 140)), ['사범대학']);
  assert.ok(names(tierOf(t3, 160)).includes('건축학과'));
  assert.deepEqual(names(tierOf(t3, 232)), ['약학과']);
  // 예과는 80학점 항목으로 따로 읽힌다
  assert.deepEqual(tierOf(t3, 160).entries.filter((e) => e.kind === 'PRECOURSE').map((e) => [e.name, e.credits]), [['한의예과', 80], ['치의예과', 80], ['의예과', 80]]);
});

test('HWPX 원본: ④(~2012학번)에서 간호학과는 140학점 칸 — 학번 구간마다 소속 칸이 다르다', () => {
  const t4 = extractSchedule4().tables[3];
  assert.ok(names(tierOf(t4, 140)).includes('간호학과'));
  assert.deepEqual(names(tierOf(t4, 130)), ['미술대학']);
});

test('커밋된 schedule4_credits.json이 원본 HWPX 추출 결과와 같다(원천이 바뀌면 hwpxTables.js --write로 갱신)', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')), JSON.parse(JSON.stringify(extractSchedule4())));
});

test('커밋된 schedule1_colleges.json이 원본 HWPX 추출 결과와 같다(병합 칸 구조로 읽은 대학→학과 소속)', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(COLLEGES_OUT_PATH, 'utf8')), JSON.parse(JSON.stringify(extractSchedule1Colleges())));
});

test('[별표 1] 교차 확인: 대학 이름과 소속 학과 이름이 학칙 전문 txt의 [별표 1] 본문에 있다(추출이 엉뚱한 칸을 읽지 않았는지)', () => {
  const txt = fs.readFileSync(path.resolve(__dirname, '..', '..', 'db', 'regulations', '_source', '원광대학교_학칙_전문.txt'), 'utf8').replace(/\s+/g, '');
  const checkable = (n) => !/[<>*]/.test(n);
  for (const t of loadSchedule1Colleges().tables) {
    for (const c of t.colleges) {
      assert.ok(c.units.length > 0, `${t.source}: ${c.college} 소속 없음`);
      for (const n of [c.college, ...c.units].filter(checkable)) assert.ok(txt.includes(n.replace(/\s+/g, '')), `${t.source}: "${n}"이(가) 학칙 전문에 없음`);
    }
  }
});

test('[별표 1] 읽기 구조 확인: 2026 표에서 공학3계열은 공과대학, 컴소공(2024·2025)은 창의공과대학, 2023 이하는 자료 없음', () => {
  const colleges = loadSchedule1Colleges();
  assert.equal(collegeOf(colleges, '공학3계열', 2026).college, '공과대학');
  assert.equal(collegeOf(colleges, '컴퓨터·소프트웨어공학과', 2024).college, '창의공과대학');
  assert.equal(collegeOf(colleges, '컴퓨터·소프트웨어공학과', 2025).college, '창의공과대학');
  assert.equal(collegeOf(colleges, '컴퓨터·소프트웨어공학과', 2023), null, '2023학번 이하는 [별표 1]에 대학 열이 없다');
  const dup = { tables: [{ cohort: { min: 2024, max: 2024 }, source: 'x', colleges: [{ college: 'A대학', units: ['가학과'] }, { college: 'B대학', units: ['가학과'] }] }] };
  assert.equal(collegeOf(dup, '가학과', 2024), null, '두 대학에 같은 이름이면 어느 쪽인지 알 수 없다');
});

test('대학 단위 대조(D-44): [별표 1]로 소속 대학이 확인되는 학번만, 그 밖은 null(추측 금지)', () => {
  const s = loadSchedule4();
  const colleges = loadSchedule1Colleges();
  const e = findSchedule4Entry(s, '컴퓨터·소프트웨어공학과', 2024, colleges);
  assert.deepEqual([e.credits, e.kind], [136, 'UNIT_VIA_SCHEDULE1']);
  assert.match(e.entryName, /창의공과대학.*컴퓨터·소프트웨어공학과/);
  assert.equal(findSchedule4Entry(s, '국어교육과', 2026, colleges).credits, 140, '사범대학');
  assert.equal(findSchedule4Entry(s, '국어교육과', 2023, colleges), null, '2023학번 이하는 대학 소속을 알 수 없어 대조 불가');
  assert.equal(findSchedule4Entry(s, '컴퓨터·소프트웨어공학과', 2024, null), null, '[별표 1] 자료가 없으면 대학 단위 대조는 빠진다');
  assert.equal(findSchedule4Entry(s, '동물보건학과', 2024, colleges), null, '보건과학대학은 2024학번 [별표 4] 표에 항목이 없어 대조 불가');
  // 학과가 직접 적힌 항목은 그대로(대학 경로를 타지 않는다)
  assert.equal(findSchedule4Entry(s, '간호학과', 2024, colleges).kind, 'DEPARTMENT');
  const same = checkSchedule4Credits({ departmentName: '컴퓨터·소프트웨어공학과', admissionYear: 2024, rows: [row('전공', 136)], schedule: s });
  assert.equal(same.match, true);
  const diff = checkSchedule4Credits({ departmentName: '컴퓨터·소프트웨어공학과', admissionYear: 2024, rows: [row('전공', 130)], schedule: s });
  assert.deepEqual([diff.match, diff.schedule4Credits, diff.bookCredits], [false, 136, 130]);
});

test('원문 txt 교차 확인: JSON의 항목 이름이 파서가 만든 [별표 4-n] 조문 본문에 모두 있다', () => {
  const seed = loadSeed();
  const bodyOf = (key) => seed.articles.find((a) => a.docCode === 'ACADEMIC_REGULATIONS' && a.articleKey === key).body.replace(/\s+/g, '');
  loadSchedule4().tables.forEach((table, i) => {
    const body = bodyOf(`별표4-${i + 1}`);
    for (const tier of table.tiers) for (const e of tier.entries) assert.ok(body.includes(e.name.replace(/\s+/g, '')), `${table.title}: ${e.name}`);
  });
});

test('파서 단위: 제목→학번 구간, 칸 텍스트→항목(괄호 note·예과 분리), 칸 병합 읽기', () => {
  assert.deepEqual(cohortRangeFromTitle('졸업학점별 대학, 이수학점 및 수료인정학점(~2012학년도 입학생)'), { min: null, max: 2012 });
  assert.deepEqual(cohortRangeFromTitle('졸업학점별 대학, 이수학점 및 수료인정학점(2026학년도 입학생 이후)'), { min: 2026, max: null });
  assert.deepEqual(entriesFromCell(['건축학과(5년제)']), [{ name: '건축학과', kind: 'DEPARTMENT', note: '5년제' }]);
  assert.deepEqual(entriesFromCell(['교학대학, 간호학과']).map((e) => [e.name, e.kind]), [['교학대학', 'UNIT'], ['간호학과', 'DEPARTMENT']]);
  const xml = '<hp:tbl><hp:tr><hp:tc><hp:p><hp:run><hp:t>가</hp:t></hp:run></hp:p><hp:cellAddr colAddr="2" rowAddr="1"/><hp:cellSpan colSpan="3" rowSpan="1"/></hp:tc></hp:tr></hp:tbl>';
  assert.deepEqual(parseTables(xml).tables[0].rows[0][0], { col: 2, row: 1, colSpan: 3, rowSpan: 1, text: ['가'] });
});

const row = (category, credits, over = {}) => ({ category, requiredCredits: credits, enrollmentType: null, minCourseCount: null, minAdmissionYear: 2017, maxAdmissionYear: 2024, requiredCourses: [], ...over });
const ROWS_140 = [row('교양필수', 5), row('교양선택', 20), row('전공', 115), row('졸업논문', 0, { minCourseCount: 1 })];

test('대조: 학과가 표에 직접 적혀 있을 때만 — 같으면 match, 다르면 두 값, 대학 단위·표에 없는 학과는 null', () => {
  const s = loadSchedule4();
  assert.equal(generalTotalCredits(ROWS_140, 2023), 140, '졸업인증제 행은 총량에서 제외');
  const nurse = checkSchedule4Credits({ departmentName: '간호학과', admissionYear: 2023, rows: ROWS_140, schedule: s });
  assert.deepEqual([nurse.match, nurse.schedule4Credits, nurse.bookCredits], [false, 130, 140]);
  assert.equal(checkSchedule4Credits({ departmentName: '간호학과', admissionYear: 2024, rows: [row('전공', 130)], schedule: s }).match, true);
  assert.equal(checkSchedule4Credits({ departmentName: '국어교육과', admissionYear: 2023, rows: ROWS_140, schedule: s }), null, '사범대학은 대학 단위 항목이라 대조하지 않는다');
  assert.equal(checkSchedule4Credits({ departmentName: '간호학과', admissionYear: 2023, rows: [], schedule: s }), null, '책자 자료가 없으면 대조 불가');
  assert.equal(findSchedule4Entry(null, '간호학과', 2023), null);
  assert.equal(findSchedule4Entry(s, '간호학과', 2012).credits, 140, '~2012학번은 ④ 표(140)');
});

test('판단: 불일치면 요건 규칙과 [별표 4]·제118조 규칙이 "추정"이 되고 두 값이 실린다, 일치면 영향 없음', () => {
  const seed = loadSeed();
  const byRef = new Map(seed.articles.map((a) => [`${a.docCode}:${a.articleKey}`, a]));
  const rules = seed.applicability.map((r) => {
    const a = byRef.get(r.articleRef);
    return { ...r, article: a ? { docCode: a.docCode, articleKey: a.articleKey, section: a.section, lastAmendedOn: a.lastAmendedOn, versionLabel: a.versionLabel } : null };
  });
  const dept = { id: 72, name: '간호학과' };
  const base = { department: dept, rules, latestDataYear: 2026, courseChanges: [], requirementChanges: [], lineage: [], equivalences: [], categoryOverrides: [] };
  const requirements = (rows) => ({ department: dept, rows, latestDataYear: 2026, candidates: [], history: null });
  const input = (y) => ({ admissionYear: y, enrollmentType: 'GENERAL', departmentId: 72, asOfDate: '2026-10-05' });

  const bad = resolveApplicableRules(input(2023), { ...base, requirements: requirements(ROWS_140) });
  const req = bad.requirements.rules.find((r) => r.id === 'REQUIREMENTS');
  assert.equal(req.confidence, 'ESTIMATED');
  assert.equal(req.value.totalRequiredCredits, 140, '숫자는 바꾸지 않는다(어느 쪽이 맞는지 판단하지 않음)');
  assert.deepEqual([req.value.schedule4.schedule4Credits, req.value.schedule4.bookCredits], [130, 140]);
  for (const code of ['ACAD_SCHED4_3_2013_2024', 'ENF118_GRAD_CREDITS_BY_COHORT']) {
    const r = bad.rules.find((x) => x.ruleCode === code);
    assert.equal(r.confidence, 'ESTIMATED', code);
    assert.ok(r.flags.some((f) => f.code === 'SCHEDULE4_CREDIT_MISMATCH'), code);
  }
  assert.equal(bad.rules.find((x) => x.ruleCode === 'ENF5_CURRICULUM_AT_ADMISSION').confidence, 'CONFIRMED', '제5조는 영향 없음');
  assert.ok(bad.flags.some((f) => f.code === 'SCHEDULE4_CREDIT_MISMATCH'));

  const ok = resolveApplicableRules(input(2024), { ...base, requirements: requirements([row('교양필수', 5), row('전공', 125)]) });
  assert.equal(ok.requirements.rules.find((r) => r.id === 'REQUIREMENTS').value.schedule4, null);
  assert.ok(!ok.flags.some((f) => f.code === 'SCHEDULE4_CREDIT_MISMATCH'));
});

// --- DB(로컬 시드) ---

test('DB: 간호학과 2023 진단 — 총학점 140은 그대로, 신뢰도 추정 + 두 값(학칙 130 / 책자 140), 2025는 확정', async () => {
  const [[d]] = await pool.query("SELECT id FROM departments WHERE name = '간호학과'");
  const [r] = await pool.query("INSERT INTO students (email, name, onboarding_completed_at, department_id, admission_year, enrollment_type) VALUES (?, ?, NOW(), ?, 2023, 'GENERAL')", [`sched4-${Date.now()}@example.test`, `sched4${Date.now()}`, d.id]);
  try {
    const s = await getGraduationStatus(r.insertId);
    assert.equal(s.totalRequiredCredits, 140);
    assert.equal(s.regulation.confidence, 'ESTIMATED');
    assert.deepEqual([s.regulation.schedule4.schedule4Credits, s.regulation.schedule4.bookCredits], [130, 140]);
    assert.ok(s.regulation.flags.some((f) => f.code === 'SCHEDULE4_CREDIT_MISMATCH'));
    await pool.query('UPDATE students SET admission_year = 2025 WHERE id = ?', [r.insertId]);
    const ok = await getGraduationStatus(r.insertId);
    assert.equal(ok.regulation.confidence, 'CONFIRMED');
    assert.equal(ok.regulation.schedule4, null);
  } finally { await pool.query('DELETE FROM students WHERE id = ?', [r.insertId]); }
});

test('DB 챗봇: 간호학과 2023 졸업학점 질문 — 판단 청크에 두 값과 "단정하지 말고 두 값을 모두 밝혀라"가 들어간다', async () => {
  const [[d]] = await pool.query("SELECT id FROM departments WHERE name = '간호학과'");
  const student = { department_id: d.id, admission_year: 2023, enrollment_type: 'GENERAL' };
  const message = '졸업하려면 몇 학점이야?';
  const yc = resolveYearContext({ message, profileCohort: 2023, availableBookYears: [2023, 2024, 2025, 2026], today: '2026-10-05' });
  const merged = mergeChunks({ structured: await assembleStructuredChunks({ message, searchText: message, student, yearContext: yc }), yearContext: yc });
  assert.match(merged[0].content, /학칙 \[별표 4\].*간호학과 130학점 이상, 교육과정 책자 기준은 140학점/);
  assert.match(merged[0].content, /한쪽이 맞다고 단정하지 말고 두 값을 모두 밝힌 뒤/);
  assert.match(merged[0].documentTitle, /신뢰도: 추정/);
});
