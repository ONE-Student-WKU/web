const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveRegulation, inputFromStudentRow } = require('../services/regulationEngine');
const { academicTermOf, isValidIsoDate, normalizeInput } = require('../services/regulationEngine/context');
const { confidenceFromFlags, makeFlag } = require('../services/regulationEngine/flags');
const { isBeforeLiberalArtsCutoff } = require('../services/regulationEngine/decisions');

/**
 * server/test/regulationEngine.rules.test.js
 * 규정 판단 엔진의 판정 논리를 DB 없이 검증한다(가짜 data 주입). 숫자는 docs/regulations/졸업/이수학점_총괄표.md 9절에
 * 이미 검증돼 적힌 사례(2019학번 2021-2학기 전과 → 일반선택 59, 2022학번 컷오프 이후 전과 → 49, 총 136)를 기준점으로 쓴다.
 */

const DEPT = { id: 1, name: '테스트공학과' };
const row = (category, requiredCredits, extra = {}) => ({
  id: null, category, requiredCredits, description: null, enrollmentType: null, minCourseCount: null,
  minAdmissionYear: null, maxAdmissionYear: null, requiredCourses: [], ...extra,
});

// 컴소공 2017~2021학번을 본뜬 표: 교양 5+18, 전공 19+56, 일반선택 38 → 136. 전과/편입 완화 행(전공 48).
const ROWS = [
  row('교양필수', 5, { minAdmissionYear: 2017, maxAdmissionYear: 2021 }),
  row('교양선택', 18, { minAdmissionYear: 2017, maxAdmissionYear: 2021 }),
  row('전공필수', 19, { minAdmissionYear: 2017, maxAdmissionYear: 2025 }),
  row('전공선택', 56, { minAdmissionYear: 2017, maxAdmissionYear: 2025 }),
  row('일반선택', 38, { minAdmissionYear: 2017, maxAdmissionYear: 2021 }),
  row('교양필수', 5, { minAdmissionYear: 2022, maxAdmissionYear: 2024 }),
  row('교양선택', 34, { minAdmissionYear: 2022, maxAdmissionYear: 2024 }),
  row('일반선택', 22, { minAdmissionYear: 2022, maxAdmissionYear: 2024 }),
  row('전공', 48, { enrollmentType: 'MAJOR_CHANGE' }),
  row('전공', 48, { enrollmentType: 'TRANSFER_ADMISSION' }),
  row('졸업논문', 0, { minCourseCount: 1, requiredCourses: ['졸업논문'] }),
];

const load = (overrides = {}) => async () => ({ department: DEPT, rows: ROWS, candidates: [], history: null, ...overrides });
const TODAY = '2026-10-05';
const resolve = (input, overrides) => resolveRegulation({ departmentId: 1, asOfDate: TODAY, ...input }, { loadData: load(overrides) });
const rule = (r, id) => r.rules.find((x) => x.id === id);
const credits = (r) => Object.fromEntries(rule(r, 'REQUIREMENTS').value.categories.map((c) => [c.category, c.requiredCredits]));
const codes = (r, id) => rule(r, id).flags.map((f) => f.code);

// ---------------------------------------------------------------- 일반 재학생
test('일반 재학생 2019학번: 136학점, 신뢰도 확정(INFO 플래그는 신뢰도를 낮추지 않는다)', async () => {
  const r = await resolve({ admissionYear: 2019, enrollmentType: 'GENERAL' });
  assert.equal(rule(r, 'REQUIREMENTS').value.totalRequiredCredits, 136);
  assert.deepEqual(credits(r), { 교양필수: 5, 교양선택: 18, 전공필수: 19, 전공선택: 56, 일반선택: 38 });
  assert.equal(rule(r, 'REQUIREMENTS').value.certifications[0].category, '졸업논문');
  assert.equal(rule(r, 'MAJOR_MINIMUM').value.mode, 'FULL');
  assert.equal(rule(r, 'REQUIREMENTS').confidence, 'CONFIRMED');
  assert.ok(codes(r, 'REQUIREMENTS').includes('COHORT_TRANSITION_ADDENDUM_NOT_HELD'), '2026학번 미만은 종전 부칙 미보유를 알린다');
  // 교양 상한: 2021학번까지는 학교 홈페이지·책자가 "상한 없음" → 확정(조문 문언과의 차이는 INFO 플래그로만 남김, D-51)
  assert.equal(rule(r, 'LIBERAL_ARTS_CAP').value.cap, null);
  assert.equal(rule(r, 'LIBERAL_ARTS_CAP').confidence, 'CONFIRMED');
  assert.deepEqual(rule(r, 'LIBERAL_ARTS_CAP').alternatives, []);
  assert.ok(codes(r, 'LIBERAL_ARTS_CAP').includes('LIBERAL_CAP_PRE_2022_ARTICLE_SILENT'));
  assert.equal(r.confidence, 'CONFIRMED');
});

test('일반 재학생 2023학번: 교양 인정 상한 52는 확정', async () => {
  const r = await resolve({ admissionYear: 2023, enrollmentType: 'GENERAL' });
  assert.equal(rule(r, 'LIBERAL_ARTS_CAP').value.cap, 52);
  assert.equal(r.confidence, 'CONFIRMED');
  assert.equal(rule(r, 'REQUIREMENTS').value.totalRequiredCredits, 136);
});

// ---------------------------------------------------------------- 전과생
test('3학년 전과, 컷오프(2022-2) 이전: 교양 29 고정 + 전공 48 + 일반선택 재배분 → 총 136, 컷오프는 전과 시점 기준으로 확정(학교 전과 안내, D-52)', async () => {
  const r = await resolve({ admissionYear: 2019, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 3, year: 2021, semester: 2 } });
  assert.deepEqual(credits(r), { 교양필수: 5, 교양선택: 24, 전공: 48, 일반선택: 59 }); // 이수학점_총괄표 9절의 59
  assert.equal(rule(r, 'REQUIREMENTS').value.totalRequiredCredits, 136);
  assert.deepEqual(rule(r, 'REQUIREMENTS').value.adjustments, ['MAJOR_RELAXATION', 'LIBERAL_FIXED_29', 'GENERAL_ELECTIVE_REBALANCE']);
  assert.equal(rule(r, 'LIBERAL_ARTS_BASIS').value.mode, 'FIXED_29');
  assert.equal(rule(r, 'LIBERAL_ARTS_BASIS').confidence, 'CONFIRMED');
  assert.ok(!codes(r, 'LIBERAL_ARTS_BASIS').includes('LIBERAL_CUTOFF_TRIGGER_AMBIGUOUS'));
  assert.ok(rule(r, 'LIBERAL_ARTS_BASIS').basis.some((b) => b.key === 'SITE_MAJOR_CHANGE_LIBERAL_CUTOFF'));
  assert.equal(rule(r, 'MAJOR_MINIMUM').value.mode, 'RELAXED');
  assert.equal(rule(r, 'MAJOR_MINIMUM').confidence, 'CONFIRMED');
});

test('3학년 전과, 컷오프 이후: 교양은 학번표 그대로, 일반선택 49, 총 136, 확정(사례 근거)', async () => {
  // 2022학번이 2024-1학기(= 3학년 5학기초)에 전과
  const r = await resolve({ admissionYear: 2022, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 3, year: 2024, semester: 1 } });
  assert.deepEqual(credits(r), { 교양필수: 5, 교양선택: 34, 전공: 48, 일반선택: 49 }); // 이수학점_총괄표 9절의 49
  assert.equal(rule(r, 'REQUIREMENTS').value.totalRequiredCredits, 136);
  assert.equal(rule(r, 'LIBERAL_ARTS_BASIS').value.mode, 'COHORT_TABLE');
  assert.equal(rule(r, 'LIBERAL_ARTS_BASIS').confidence, 'CONFIRMED');
  assert.ok(rule(r, 'LIBERAL_ARTS_BASIS').basis.some((b) => b.key === 'CASE_MAJOR_CHANGE_AFTER_CUTOFF'));
  assert.equal(r.confidence, 'CONFIRMED');
});

test('컷오프 경계: 2022-2학기 자체는 "이전"이 아니다(2022-1은 이전)', () => {
  assert.equal(isBeforeLiberalArtsCutoff({ year: 2022, semester: 1 }), true);
  assert.equal(isBeforeLiberalArtsCutoff({ year: 2022, semester: 2 }), false);
  assert.equal(isBeforeLiberalArtsCutoff({ year: 2021, semester: 2 }), true);
  assert.equal(isBeforeLiberalArtsCutoff({ year: 2023, semester: 1 }), false);
});

test('1·2학년 전과: 전공 완화 없음(제8조 제2항). 컷오프 이전이어도 총량 136은 유지된다', async () => {
  const after = await resolve({ admissionYear: 2022, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 2, year: 2023, semester: 1 } });
  assert.equal(rule(after, 'MAJOR_MINIMUM').value.mode, 'FULL');
  assert.deepEqual(credits(after), { 교양필수: 5, 교양선택: 34, 전공필수: 19, 전공선택: 56, 일반선택: 22 });

  const before = await resolve({ admissionYear: 2021, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 2, year: 2022, semester: 1 } });
  assert.equal(rule(before, 'MAJOR_MINIMUM').value.mode, 'FULL');
  assert.equal(rule(before, 'LIBERAL_ARTS_BASIS').value.mode, 'FIXED_29');
  assert.equal(rule(before, 'REQUIREMENTS').value.totalRequiredCredits, 136);
  assert.equal(credits(before).일반선택, 38 + 23 - 29);
});

test('전과 정보가 비어 있으면 가정을 플래그로 남기고 추정으로 낮춘다(조용히 넘어가지 않음)', async () => {
  const noGrade = await resolve({ admissionYear: 2022, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: null, year: 2024, semester: 1 } });
  assert.ok(codes(noGrade, 'MAJOR_MINIMUM').includes('MAJOR_CHANGE_GRADE_MISSING'));
  assert.equal(rule(noGrade, 'MAJOR_MINIMUM').confidence, 'ESTIMATED');

  const noDate = await resolve({ admissionYear: 2019, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 3, year: null, semester: null } });
  assert.ok(codes(noDate, 'LIBERAL_ARTS_BASIS').includes('MAJOR_CHANGE_DATE_MISSING'));
  assert.equal(rule(noDate, 'LIBERAL_ARTS_BASIS').confidence, 'ESTIMATED');
  assert.equal(rule(noDate, 'LIBERAL_ARTS_BASIS').value.mode, 'COHORT_TABLE');

  const noInfo = await resolve({ admissionYear: 2022, enrollmentType: 'MAJOR_CHANGE' });
  assert.equal(noInfo.confidence, 'ESTIMATED');
});

test('전과 학년이 학번·전과시점으로 계산한 학년과 다르면(휴학 등) 추정으로 낮춘다', async () => {
  // 2022학번이 2024-1에 전과하면 3학년(5학기초). 입력이 4학년이면 불일치.
  const r = await resolve({ admissionYear: 2022, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 4, year: 2024, semester: 1 } });
  const flag = rule(r, 'MAJOR_MINIMUM').flags.find((f) => f.code === 'MAJOR_CHANGE_GRADE_VS_COHORT_MISMATCH');
  assert.ok(flag);
  assert.deepEqual([flag.impliedGrade, flag.inputGrade], [3, 4]);
  assert.equal(rule(r, 'MAJOR_MINIMUM').confidence, 'ESTIMATED');
});

test('전과 완화 행이 자료에 없으면 일반 기준으로 계산하되 추정 플래그를 남긴다', async () => {
  const rowsWithoutRelaxation = ROWS.filter((x) => x.enrollmentType !== 'MAJOR_CHANGE');
  const r = await resolve({ admissionYear: 2022, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 3, year: 2024, semester: 1 } }, { rows: rowsWithoutRelaxation });
  assert.ok(codes(r, 'REQUIREMENTS').includes('MAJOR_RELAXATION_ROW_MISSING'));
  assert.ok(codes(r, 'MAJOR_MINIMUM').includes('MAJOR_RELAXATION_ROW_MISSING'));
  assert.equal(credits(r).전공필수, 19);
  assert.equal(r.confidence, 'ESTIMATED');
});

// ---------------------------------------------------------------- 편입생
test('편입생: 편입 학년을 모르면 3학년으로 가정(추정), 총 요구학점은 단정하지 않는다', async () => {
  const r = await resolve({ admissionYear: 2023, enrollmentType: 'TRANSFER_ADMISSION' });
  assert.equal(rule(r, 'REQUIREMENTS').value.totalRequiredCredits, null);
  assert.equal(credits(r).전공, 48);
  assert.equal(rule(r, 'MAJOR_MINIMUM').value.transferGrade, 3);
  for (const code of ['TRANSFER_GRADE_ASSUMED', 'TRANSFER_COHORT_YEAR_UNVERIFIED', 'TRANSFER_TOTAL_UNRESOLVED']) {
    assert.ok(codes(r, 'REQUIREMENTS').includes(code), code);
  }
  assert.ok(codes(r, 'LIBERAL_ARTS_BASIS').includes('TRANSFER_LIBERAL_DEEMED_MET'));
  assert.ok(codes(r, 'LIBERAL_ARTS_CAP').includes('LIBERAL_CAP_TRANSFER_EXEMPTION_UNVERIFIED'));
  assert.equal(r.confidence, 'ESTIMATED');
});

test('편입 학년별 전공: 2학년=완화 없음, 3학년=완화 행, 4학년=21학점(시행규칙 제6조 제3항)', async () => {
  const g2 = await resolve({ admissionYear: 2023, enrollmentType: 'TRANSFER_ADMISSION', transfer: { grade: 2 } });
  assert.equal(rule(g2, 'MAJOR_MINIMUM').value.mode, 'FULL');
  assert.equal(credits(g2).전공필수, 19);
  assert.ok(!codes(g2, 'REQUIREMENTS').includes('TRANSFER_GRADE_ASSUMED'), '학년을 줬으면 가정 플래그가 없어야 한다');

  const g3 = await resolve({ admissionYear: 2023, enrollmentType: 'TRANSFER_ADMISSION', transfer: { grade: 3 } });
  assert.equal(credits(g3).전공, 48);

  const g4 = await resolve({ admissionYear: 2023, enrollmentType: 'TRANSFER_ADMISSION', transfer: { grade: 4 } });
  assert.equal(rule(g4, 'MAJOR_MINIMUM').value.mode, 'TRANSFER_4TH');
  assert.equal(credits(g4).전공, 21);
  assert.ok(rule(g4, 'MAJOR_MINIMUM').basis.some((b) => b.key === 'ENF_ART6_3_TRANSFER_4TH'));
});

// ---------------------------------------------------------------- 자료 없음 / 기준일
test('학번 자료가 없으면 다른 해로 추정하지 않고 자료없음 + 후보만 안내', async () => {
  const candidates = [{ departmentName: '옛학과', relation: 'RENAME', lineageSource: 'NAME_MATCH' }];
  const r = await resolve({ admissionYear: 2026, enrollmentType: 'GENERAL' }, { candidates });
  assert.equal(r.confidence, 'NO_DATA');
  assert.equal(rule(r, 'REQUIREMENTS').value, null);
  assert.deepEqual(rule(r, 'REQUIREMENTS').flags.find((f) => f.code === 'NO_CURRICULUM_ROWS').candidates, candidates);
});

test('열린 범위 행(max=NULL)은 시스템이 아는 최신 학번 이후로 외삽하지 않는다', async () => {
  const openEnded = ROWS.map((r) => (r.maxAdmissionYear >= 2024 ? { ...r, maxAdmissionYear: null } : r));
  const within = await resolve({ admissionYear: 2026, enrollmentType: 'GENERAL' }, { rows: openEnded, latestDataYear: 2026 });
  assert.equal(rule(within, 'REQUIREMENTS').value.totalRequiredCredits, 136);
  const beyond = await resolve({ admissionYear: 2027, enrollmentType: 'GENERAL', asOfDate: '2027-04-01' }, { rows: openEnded, latestDataYear: 2026 });
  assert.equal(beyond.confidence, 'NO_DATA');
  assert.equal(rule(beyond, 'REQUIREMENTS').value, null);
  assert.ok(codes(beyond, 'REQUIREMENTS').includes('COHORT_BEYOND_LATEST_DATA'));
  assert.ok(rule(beyond, 'REQUIREMENTS').basis.some((b) => b.key === 'ACAD_ADDENDUM_2026_04_10_ART2_REORG_2027'));
});

test('학과를 못 찾으면 자료없음', async () => {
  const r = await resolve({ admissionYear: 2022, enrollmentType: 'GENERAL' }, { department: null });
  assert.equal(r.confidence, 'NO_DATA');
  assert.ok(codes(r, 'REQUIREMENTS').includes('DEPARTMENT_NOT_FOUND'));
});

test('학번 2017 미만은 지원 범위 밖 → 자료없음', async () => {
  const r = await resolve({ admissionYear: 2016, enrollmentType: 'GENERAL' });
  assert.equal(r.confidence, 'NO_DATA');
  assert.ok(r.flags.some((f) => f.code === 'ADMISSION_YEAR_UNSUPPORTED'));
});

test('기준일이 입학 이전이면 자료없음(입학 학기 1학기 3/1 기준)', async () => {
  assert.equal((await resolve({ admissionYear: 2022, enrollmentType: 'GENERAL', asOfDate: '2022-02-28' })).confidence, 'NO_DATA');
  assert.notEqual((await resolve({ admissionYear: 2022, enrollmentType: 'GENERAL', asOfDate: '2022-03-01' })).confidence, 'NO_DATA');
});

test('기준일이 전과 이전이면 그 시점엔 이전 학과 규정이라 자료없음', async () => {
  const r = await resolve({ admissionYear: 2022, enrollmentType: 'MAJOR_CHANGE', asOfDate: '2023-02-10', majorChange: { grade: 2, year: 2023, semester: 1 } });
  assert.equal(r.confidence, 'NO_DATA'); // 2023-02-10은 2022학년도 2학기 → 2023-1학기 전과 전
  assert.ok(r.flags.some((f) => f.code === 'ASOF_BEFORE_MAJOR_CHANGE'));
  const later = await resolve({ admissionYear: 2022, enrollmentType: 'MAJOR_CHANGE', asOfDate: '2023-03-01', majorChange: { grade: 2, year: 2023, semester: 1 } });
  assert.notEqual(later.confidence, 'NO_DATA');
});

test('전과 시점이 입학보다 이르면 입력 오류성 자료없음', async () => {
  const r = await resolve({ admissionYear: 2022, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 2, year: 2021, semester: 2 } });
  assert.equal(r.confidence, 'NO_DATA');
  assert.ok(r.flags.some((f) => f.code === 'MAJOR_CHANGE_BEFORE_ADMISSION'));
});

test('기준일별 규정 원문 보유 여부: 시행 전/중간 판본/최신본 이후', async () => {
  // 조문(ARTICLE)에 기대는 전공 최소학점 판단만 영향 — 책자 값만 쓰는 교양 갈래(일반 재학생)는 그대로.
  const old = await resolve({ admissionYear: 2022, enrollmentType: 'GENERAL', asOfDate: '2025-05-01' });
  assert.ok(codes(old, 'MAJOR_MINIMUM').includes('TEXT_VERSION_NOT_HELD'));
  assert.equal(rule(old, 'MAJOR_MINIMUM').confidence, 'ESTIMATED');
  assert.equal(rule(old, 'LIBERAL_ARTS_BASIS').confidence, 'CONFIRMED');
  assert.equal(rule(old, 'REQUIREMENTS').value.totalRequiredCredits, 136, '책자 기반 학점표는 기준일과 무관하게 같다');

  const mid = await resolve({ admissionYear: 2022, enrollmentType: 'GENERAL', asOfDate: '2026-05-01' });
  assert.ok(codes(mid, 'MAJOR_MINIMUM').includes('TEXT_INTERMEDIATE_VERSION'));

  const latest = await resolve({ admissionYear: 2022, enrollmentType: 'GENERAL', asOfDate: '2026-06-26' });
  assert.equal(rule(latest, 'MAJOR_MINIMUM').flags.length, 0);
  assert.equal(rule(latest, 'MAJOR_MINIMUM').confidence, 'CONFIRMED');

  const after = await resolve({ admissionYear: 2022, enrollmentType: 'GENERAL', asOfDate: '2027-01-01' });
  assert.deepEqual(codes(after, 'MAJOR_MINIMUM'), ['TEXT_SNAPSHOT_MAY_BE_OLDER']);
  assert.equal(rule(after, 'MAJOR_MINIMUM').confidence, 'CONFIRMED', '최신본 이후 알림은 INFO라 신뢰도를 낮추지 않는다');
});

// ---------------------------------------------------------------- 해석 선택
test('컷오프 해석 선택: 구조조정 시점 해석은 시점 입력이 없으면 자료없음, 있으면 두 해석의 결과를 대안으로 병기', async () => {
  const base = { admissionYear: 2022, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 3, year: 2024, semester: 1 } };
  const missing = await resolve({ ...base, policy: { liberalArtsCutoffTrigger: 'RESTRUCTURING_DATE' } });
  assert.equal(rule(missing, 'LIBERAL_ARTS_BASIS').confidence, 'NO_DATA');
  assert.equal(rule(missing, 'LIBERAL_ARTS_BASIS').value, null);

  const given = await resolve({ ...base, restructuring: { year: 2020, semester: 1 }, policy: { liberalArtsCutoffTrigger: 'RESTRUCTURING_DATE' } });
  assert.equal(rule(given, 'LIBERAL_ARTS_BASIS').value.mode, 'FIXED_29');
  assert.ok(codes(given, 'LIBERAL_ARTS_BASIS').includes('LIBERAL_CUTOFF_TRIGGER_AMBIGUOUS'), '구조조정 시점 해석은 학교 전과 안내와 달라질 수 있어 추정 플래그가 붙는다');
  assert.deepEqual(rule(given, 'LIBERAL_ARTS_BASIS').alternatives.map((a) => [a.id, a.mode]), [['MAJOR_CHANGE_DATE', 'COHORT_TABLE']]);
  assert.equal(credits(given).교양선택, 24);
  assert.equal(credits(given).일반선택, 136 - 48 - 29, '구조조정 시점 해석에서도 총량은 136(전공 48·교양 29 외 나머지를 일반선택이 흡수)');
  assert.equal(rule(given, 'REQUIREMENTS').value.totalRequiredCredits, 136);

  // 기본 해석에서도, 구조조정 시점을 알려주면 결과가 갈릴 때 대안으로 보여준다.
  const dflt = await resolve({ ...base, restructuring: { year: 2020, semester: 1 } });
  assert.equal(rule(dflt, 'LIBERAL_ARTS_BASIS').value.mode, 'COHORT_TABLE');
  assert.deepEqual(rule(dflt, 'LIBERAL_ARTS_BASIS').alternatives.map((a) => [a.id, a.mode]), [['RESTRUCTURING_DATE', 'FIXED_29']]);
});

test('교육과정 변경 이력: 이 학번 이후 변경이 있으면 INFO 안내와 시행규칙 제13조 근거가 붙지만 신뢰도는 낮추지 않는다', async () => {
  const history = { GRAD_TOTAL: { earlierChanges: [], laterChanges: [{ toYear: 2025 }] }, MAJOR_TOTAL: null, LIBERAL_TOTAL: null };
  const r = await resolve({ admissionYear: 2023, enrollmentType: 'GENERAL' }, { history });
  const rev = rule(r, 'CURRICULUM_REVISIONS');
  assert.equal(rev.critical, false);
  assert.deepEqual(rev.flags.map((f) => f.code), ['CURRICULUM_REVISION_AFTER_COHORT']);
  assert.ok(rev.basis.some((b) => b.key === 'ENF_ART13_TRANSITION'));
  assert.equal(r.confidence, 'CONFIRMED');
});

// ---------------------------------------------------------------- 입력/유틸
test('잘못된 입력은 예외 대신 자료없음 + INVALID_INPUT', async () => {
  for (const bad of [{}, { admissionYear: 2022 }, { admissionYear: 2022, enrollmentType: 'X', departmentId: 1 }, { admissionYear: 2022, enrollmentType: 'GENERAL', departmentId: 1, asOfDate: '2026-02-30' }]) {
    const r = await resolveRegulation(bad, { loadData: load() });
    assert.equal(r.confidence, 'NO_DATA');
    assert.equal(r.flags[0].code, 'INVALID_INPUT');
    assert.ok(r.flags[0].errors.length > 0);
  }
});

test('학기 계산(학칙 제22조): 3~8월=1학기, 9~2월=2학기, 1~2월은 전년도 2학기', () => {
  assert.deepEqual(academicTermOf('2026-03-01'), { year: 2026, semester: 1 });
  assert.deepEqual(academicTermOf('2026-08-31'), { year: 2026, semester: 1 });
  assert.deepEqual(academicTermOf('2026-09-01'), { year: 2026, semester: 2 });
  assert.deepEqual(academicTermOf('2026-12-31'), { year: 2026, semester: 2 });
  assert.deepEqual(academicTermOf('2026-02-28'), { year: 2025, semester: 2 });
  assert.deepEqual(academicTermOf('2026-01-15'), { year: 2025, semester: 2 });
});

test('날짜 검증과 기본 기준일', () => {
  assert.equal(isValidIsoDate('2026-02-28'), true);
  assert.equal(isValidIsoDate('2026-02-30'), false);
  assert.equal(isValidIsoDate('2026-2-3'), false);
  assert.equal(normalizeInput({ admissionYear: 2022, enrollmentType: 'GENERAL', departmentId: 1 }, { today: '2026-10-05' }).ctx.asOfDate, '2026-10-05');
});

test('신뢰도는 플래그에서만 도출된다: 없음/INFO=확정, ESTIMATED=추정, NO_DATA가 하나라도 있으면 자료없음', () => {
  assert.equal(confidenceFromFlags([]), 'CONFIRMED');
  assert.equal(confidenceFromFlags([makeFlag('TEXT_SNAPSHOT_MAY_BE_OLDER')]), 'CONFIRMED');
  assert.equal(confidenceFromFlags([makeFlag('TRANSFER_GRADE_ASSUMED')]), 'ESTIMATED');
  assert.equal(confidenceFromFlags([makeFlag('TRANSFER_GRADE_ASSUMED'), makeFlag('NO_CURRICULUM_ROWS')]), 'NO_DATA');
  assert.throws(() => makeFlag('NOT_A_REAL_CODE'));
});

test('inputFromStudentRow: students 행 → 엔진 입력 (전과 정보는 전과생만)', () => {
  const general = inputFromStudentRow({ admission_year: 2022, enrollment_type: 'GENERAL', department_id: 5, track_id: null, major_change_grade: 3, major_change_year: 2024, major_change_semester: 1 });
  assert.equal(general.majorChange, null);
  const mc = inputFromStudentRow({ admission_year: 2022, enrollment_type: 'MAJOR_CHANGE', department_id: 5, major_change_grade: 3, major_change_year: 2024, major_change_semester: 1 });
  assert.deepEqual(mc.majorChange, { grade: 3, year: 2024, semester: 1 });
  assert.equal(mc.departmentId, 5);
});
