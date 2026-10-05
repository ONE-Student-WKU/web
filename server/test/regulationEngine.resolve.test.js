const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { resolveApplicableRules, categoryAtRegistration, HANDLERS } = require('../services/regulationEngine/applicability');
const { buildRegulationSeed } = require('../services/regulationEngine/regulationSeed');
const dq = require('../services/regulationEngine/dataQuality');

/**
 * resolveApplicableRules(순수 함수) 단위 테스트 — DB 없음.
 * 적용범위 규칙은 실제 원천(db/regulation-engine/applicability.json + 원문 파서)에서 만들고, 학과·과목 변경 데이터만 가짜로 준다.
 * 고정하는 것: 제13조 ①~④, 학과 개편(제14조), 자료 없음, 데이터 등급(A/B/C)별 신뢰도, 부칙의 시점 판단.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const manual = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'db', 'regulation-engine', 'applicability.json'), 'utf8'));
const texts = Object.fromEntries(manual.documents.map((d) => [d.docCode, fs.readFileSync(path.join(REPO_ROOT, d.file), 'utf8')]));
const seed = buildRegulationSeed({ texts, manual });
const articleByRef = new Map(seed.articles.map((a) => [`${a.docCode}:${a.articleKey}`, a]));
const RULES = seed.applicability.map((r) => {
  const a = articleByRef.get(r.articleRef);
  return { ...r, article: a ? { docCode: a.docCode, articleKey: a.articleKey, section: a.section, lastAmendedOn: a.lastAmendedOn, versionLabel: a.versionLabel } : null };
});

const DEPT = { id: 10, name: '테스트학과' };
const base = (over = {}) => ({ department: DEPT, rules: RULES, latestDataYear: 2026, courseChanges: [], requirementChanges: [], lineage: [], equivalences: [], categoryOverrides: [], ...over });
const input = (over = {}) => ({ admissionYear: 2023, enrollmentType: 'GENERAL', departmentId: DEPT.id, asOfDate: '2026-10-05', ...over });
const change = (over) => ({ subjectKey: 'C:1', displayName: '과목', departmentId: DEPT.id, trackId: null, fromYear: 2023, toYear: 2024, note: null, offeredGrade: null, ...over });
const rule = (res, code) => res.rules.find((r) => r.ruleCode === code);
const codes = (r) => r.flags.map((f) => f.code);

test('적용범위 데이터의 모든 conditionCode에 해석기가 있다(없으면 판단이 조용히 빠진다)', () => {
  for (const r of RULES) assert.ok(HANDLERS[r.conditionCode], `${r.ruleCode}: ${r.conditionCode}`);
  assert.throws(() => resolveApplicableRules(input(), base({ rules: [{ ...RULES[0], conditionCode: 'NOPE' }] })), /구현되지 않은 적용 조건/);
});

test('제13조②: 필수→선택 변경 과목과 폐설된 필수과목은 이수하지 않아도 된다(A등급 구간 = 확정)', () => {
  const res = resolveApplicableRules(input(), base({
    courseChanges: [
      change({ subjectKey: 'C:1', displayName: '자료구조', field: 'category', changeType: 'CHANGED', oldValue: '전공필수', newValue: '전공선택' }),
      change({ subjectKey: 'C:2', displayName: '폐설과목', field: 'existence', changeType: 'REMOVED', oldValue: '전공필수 2학년 1학기', newValue: null }),
      change({ subjectKey: 'C:3', displayName: '선택과목폐설', field: 'existence', changeType: 'REMOVED', oldValue: '전공선택 3학년 1학기', newValue: null }),
    ],
  }));
  const r = rule(res, 'ENF13_2_REQUIRED_TO_ELECTIVE_OR_ABOLISHED');
  assert.equal(r.status, 'APPLIES');
  assert.deepEqual(r.details.exempt.map((x) => [x.courseName, x.kind, x.exempt]), [['자료구조', 'REQUIRED_TO_ELECTIVE', true], ['폐설과목', 'ABOLISHED', true]]);
  // 2023→2024 교육과정은 둘 다 등급 A → 과목 판단 확정
  assert.deepEqual(r.details.exempt.map((x) => x.confidence), ['CONFIRMED', 'CONFIRMED']);
  assert.equal(r.scope, 'TRANSITIONAL');
  assert.equal(r.basis.articleRef, 'ENFORCEMENT_RULES:제13조');
  assert.equal(r.basis.paragraph, '②');
});

test('제13조②: 필수→전공기초 등 필수/선택 정의가 없는 구분은 면제라고 단정하지 않는다', () => {
  const res = resolveApplicableRules(input(), base({
    courseChanges: [change({ field: 'category', changeType: 'CHANGED', oldValue: '전공필수', newValue: '전공기초' })],
  }));
  const r = rule(res, 'ENF13_2_REQUIRED_TO_ELECTIVE_OR_ABOLISHED');
  assert.equal(r.status, 'UNKNOWN');
  assert.equal(r.details.unclassified[0].exempt, null);
  assert.ok(codes(r).includes('CATEGORY_NATURE_UNKNOWN'));
  assert.equal(r.confidence, 'ESTIMATED');
});

test('제13조③: 선택→필수로 바뀐 과목은 재학 학년보다 저학년 개설이면 면제, 같거나 높으면 이수', () => {
  // 2023학번, 2025학년도 개편 → 개편 시점 3학년. 기준일 2025-10 → 기준일 학년도 3학년(두 해석이 같다).
  const res = resolveApplicableRules(input({ asOfDate: '2025-10-01' }), base({
    courseChanges: [
      change({ subjectKey: 'C:1', displayName: '저학년과목', field: 'category', changeType: 'CHANGED', oldValue: '전공선택', newValue: '전공필수', fromYear: 2024, toYear: 2025, offeredGrade: 2 }),
      change({ subjectKey: 'C:2', displayName: '같은학년과목', field: 'category', changeType: 'CHANGED', oldValue: '전공선택', newValue: '전공필수', fromYear: 2024, toYear: 2025, offeredGrade: 3 }),
    ],
  }));
  const r = rule(res, 'ENF13_3_ELECTIVE_TO_REQUIRED_LOWER_GRADE');
  assert.equal(r.status, 'APPLIES');
  assert.deepEqual(r.details.courses.map((c) => [c.courseName, c.gradeAtRevision, c.exempt]), [['같은학년과목', 3, false], ['저학년과목', 3, true]]);
  assert.equal(r.alternatives.length, 0);
  // 학년을 입학년도로 계산(휴학 미반영) + 조문 해석 재량 → 추정
  assert.equal(r.confidence, 'ESTIMATED');
  assert.ok(codes(r).includes('GRADE_FROM_ADMISSION_YEAR'));
});

test('제13조③: "재학 중인 학년" 해석(개편 시점 vs 기준일)에 따라 갈리면 두 결과를 모두 내고 플래그를 남긴다', () => {
  // 2023학번, 2024 개편(개편 시점 2학년), 기준일 2026(4학년). 3학년 개설 과목: 개편 시점 기준 이수, 기준일 기준 면제.
  const data = base({ courseChanges: [change({ field: 'category', changeType: 'CHANGED', oldValue: '전공선택', newValue: '전공필수', toYear: 2024, offeredGrade: 3 })] });
  const atRevision = rule(resolveApplicableRules(input(), data), 'ENF13_3_ELECTIVE_TO_REQUIRED_LOWER_GRADE');
  assert.equal(atRevision.details.courses[0].exempt, false);
  assert.deepEqual(atRevision.details.courses[0].alternatives, [{ gradeBasis: 'AT_AS_OF', exempt: true }]);
  assert.ok(codes(atRevision).includes('TRANSITION_GRADE_BASIS_AMBIGUOUS'));
  const atAsOf = rule(resolveApplicableRules(input({ policy: { transitionGradeBasis: 'AT_AS_OF' } }), data), 'ENF13_3_ELECTIVE_TO_REQUIRED_LOWER_GRADE');
  assert.equal(atAsOf.details.courses[0].exempt, true);
});

test('제13조③: 입학 후 새로 생긴 필수과목은 조문에 규정이 없어 판단하지 않는다(확인 필요)', () => {
  const res = resolveApplicableRules(input(), base({ courseChanges: [change({ field: 'existence', changeType: 'ADDED', oldValue: null, newValue: '전공필수 1학년 1학기', fromYear: null })] }));
  const r = rule(res, 'ENF13_3_ELECTIVE_TO_REQUIRED_LOWER_GRADE');
  assert.equal(r.status, 'UNKNOWN');
  assert.equal(r.details.newRequired[0].exempt, null);
  assert.ok(codes(r).includes('NEW_REQUIRED_COURSE_NOT_COVERED'));
});

test('제13조④: 이수구분 변경 — 수강한 학년도의 이수구분, 학교 공지 override가 우선', () => {
  const changes = [change({ subjectKey: 'C:9', field: 'category', changeType: 'CHANGED', oldValue: '전공선택', newValue: '전공필수', toYear: 2025 })];
  const res = resolveApplicableRules(input(), base({ courseChanges: changes }));
  const r = rule(res, 'ENF13_4_CATEGORY_AT_REGISTRATION');
  assert.equal(r.status, 'APPLIES');
  assert.match(r.details.courses[0].rule, /2024학년도까지 수강 → 전공선택, 2025학년도부터 수강 → 전공필수/);
  assert.ok(codes(r).includes('CATEGORY_YEAR_BOOK_ASSUMED'));

  assert.equal(categoryAtRegistration({ courseKey: 'C:9', year: 2024 }, changes).category, '전공선택');
  assert.equal(categoryAtRegistration({ courseKey: 'C:9', year: 2025 }, changes).category, '전공필수');
  const overrides = [{ courseKey: 'C:9', academicYear: 2025, semester: 2, category: '전공선택', basisArticleRef: 'ENFORCEMENT_RULES:제13조④' }];
  assert.deepEqual(categoryAtRegistration({ courseKey: 'C:9', year: 2025, semester: 2 }, changes, overrides).source, 'OVERRIDE');
  // 2학기 override는 1학기 수강에는 적용되지 않는다 → 그 학년도 책자 이수구분
  assert.equal(categoryAtRegistration({ courseKey: 'C:9', year: 2025, semester: 1 }, changes, overrides).category, '전공필수');
});

test('제13조①: 입학 후 변경이 없으면 해당 없음(A등급 구간 = 변경 없음 확정), 입학 전 변경은 무시', () => {
  const res = resolveApplicableRules(input(), base({
    courseChanges: [change({ field: 'category', changeType: 'CHANGED', oldValue: '전공필수', newValue: '전공선택', fromYear: 2022, toYear: 2023 })],
  }));
  assert.equal(rule(res, 'ENF13_1_NEW_CURRICULUM_ALL_GRADES').status, 'NOT_APPLICABLE');
  assert.equal(rule(res, 'ENF13_2_REQUIRED_TO_ELECTIVE_OR_ABOLISHED').status, 'NOT_APPLICABLE');
  // 2024·2025 = A, 2026 = B(부분 검증) → 셋 다 "변경 없음"(C가 아님)
  assert.deepEqual(res.history.years.map((y) => [y.year, y.courses.label]), [[2024, '변경 없음'], [2025, '변경 없음'], [2026, '변경 없음']]);
  assert.equal(res.confidence, 'CONFIRMED');
});

test('데이터 등급 C 구간: "변경 없음"이 아니라 "기록 없음(검증 안 됨)", 신뢰도 자료 불충분', () => {
  // 2017학번, 기준일 2019 — 전공과목 2017·2018 = C
  const res = resolveApplicableRules(input({ admissionYear: 2017, asOfDate: '2019-10-01' }), base());
  const r = rule(res, 'ENF13_2_REQUIRED_TO_ELECTIVE_OR_ABOLISHED');
  assert.equal(r.status, 'UNKNOWN');
  assert.match(r.reason, /기록 없음\(검증 안 됨\)/);
  assert.equal(r.confidence, 'INSUFFICIENT');
  assert.equal(r.confidenceLabel, '자료 불충분(확인 필요)');
  assert.equal(res.history.years.find((y) => y.year === 2018).courses.label, '기록 없음(검증 안 됨)');
  assert.equal(res.confidence, 'INSUFFICIENT');
});

test('데이터 등급 B: 2026 교육과정(등급 B)과 비교한 과목 판단은 추정', () => {
  const res = resolveApplicableRules(input(), base({
    courseChanges: [change({ field: 'category', changeType: 'CHANGED', oldValue: '전공필수', newValue: '전공선택', fromYear: 2025, toYear: 2026 })],
  }));
  const item = rule(res, 'ENF13_2_REQUIRED_TO_ELECTIVE_OR_ABOLISHED').details.exempt[0];
  assert.equal(item.confidence, 'ESTIMATED');
  assert.ok(item.flags.includes('COURSE_DATA_GRADE_B'));
});

test('데이터 등급: 컴소공은 전공과목 대신 컴소공 열을 쓰고, C 구간이 섞이면 찾은 과목 목록도 자료 불충분', () => {
  const cse = { id: 1, name: '컴퓨터·소프트웨어공학과' };
  const res = resolveApplicableRules(input({ admissionYear: 2022, departmentId: 1 }), base({
    department: cse,
    courseChanges: [change({ departmentId: 1, field: 'category', changeType: 'CHANGED', oldValue: '전공필수', newValue: '전공선택', fromYear: 2025, toYear: 2026 })],
  }));
  assert.deepEqual(res.dataQuality.majorCourses, { area: 'CSE_MAJOR_COURSES', grade: 'C' });
  assert.deepEqual(res.dataQuality.unverifiedCourseYears, [2023]);
  const r = rule(res, 'ENF13_2_REQUIRED_TO_ELECTIVE_OR_ABOLISHED');
  assert.equal(r.status, 'APPLIES');
  assert.ok(codes(r).includes('HISTORY_NOT_VERIFIED'));
  assert.equal(r.confidence, 'INSUFFICIENT');
});

test('학과 개편(제14조): 입학 후 개편이면 재량 규정 적용(추정), 이름 일치 계보는 별도 플래그, 개편 후 학과로 조회하면 경고', () => {
  const lineage = [{ fromDepartmentId: DEPT.id, fromDepartmentName: DEPT.name, toDepartmentId: 20, toDepartmentName: '테스트계열', relation: 'REORG', effectiveYear: 2025, source: 'NAME_MATCH' }];
  const res = resolveApplicableRules(input(), base({ lineage }));
  const r = rule(res, 'ENF14_1_REORG_EQUIVALENT_COURSES');
  assert.equal(r.status, 'APPLIES');
  assert.equal(r.confidence, 'ESTIMATED');
  assert.ok(codes(r).includes('LINEAGE_NAME_MATCH'));
  assert.ok(codes(r).includes('APPLICABILITY_ESTIMATED'));
  assert.equal(rule(res, 'ENF14_2_REORG_KEEP_OLD_CURRICULUM').status, 'APPLIES');
  // 동일과목 지정 목록이 없으면 확인 필요
  assert.ok(codes(rule(res, 'ENF15_EQUIVALENT_COURSE_DESIGNATION')).includes('EQUIVALENCE_LIST_NOT_HELD'));

  // 개편 전에 입학(2023)했는데 개편 후 학과(20)로 조회 → 입학 당시 학과 기준이라는 경고
  const successor = resolveApplicableRules(input({ departmentId: 20 }), base({ department: { id: 20, name: '테스트계열' }, lineage }));
  assert.ok(successor.flags.some((f) => f.code === 'DEPARTMENT_IS_SUCCESSOR_OF_COHORT'));
  // 개편 이후 입학(2025)이면 개편은 이 학생에게 경과조치 대상이 아니다
  const after = resolveApplicableRules(input({ admissionYear: 2025, departmentId: 20 }), base({ department: { id: 20, name: '테스트계열' }, lineage }));
  assert.equal(rule(after, 'ENF14_1_REORG_EQUIVALENT_COURSES').status, 'NOT_APPLICABLE');
  // 기준일이 개편 학년도 전이면 아직 해당 없음
  const before = resolveApplicableRules(input({ asOfDate: '2024-10-01' }), base({ lineage }));
  assert.equal(rule(before, 'ENF14_1_REORG_EQUIVALENT_COURSES').status, 'NOT_APPLICABLE');
});

test('자료 없음: 학과 없음 / 최신 자료 이후 학번 / 지원 범위 밖 학번 / 입학 전 기준일', () => {
  const noDept = resolveApplicableRules(input(), base({ department: null }));
  assert.equal(noDept.confidence, 'NO_DATA');
  assert.equal(noDept.confidenceLabel, '자료없음');
  assert.ok(noDept.flags.some((f) => f.code === 'DEPARTMENT_NOT_FOUND'));
  assert.equal(noDept.history, null);

  const beyond = resolveApplicableRules(input({ admissionYear: 2027, asOfDate: '2027-04-01' }), base());
  assert.equal(beyond.confidence, 'NO_DATA');
  assert.ok(beyond.flags.some((f) => f.code === 'COHORT_BEYOND_LATEST_DATA'));
  assert.equal(rule(beyond, 'ACAD_ADD_20260410_SCHED1_FROM_2027').status, 'APPLIES', '조문 적용범위는 데이터와 무관하게 판단');

  assert.equal(resolveApplicableRules(input({ admissionYear: 2015, asOfDate: '2016-04-01' }), base()).confidence, 'NO_DATA');
  assert.equal(resolveApplicableRules(input({ asOfDate: '2022-10-01' }), base()).confidence, 'NO_DATA');
});

test('잘못된 입력은 예외 대신 자료없음 결과', () => {
  const r = resolveApplicableRules({ admissionYear: 'x' }, base());
  assert.equal(r.confidence, 'NO_DATA');
  assert.equal(r.flags[0].code, 'INVALID_INPUT');
  const p = resolveApplicableRules(input({ policy: { transitionGradeBasis: 'WRONG' } }), base());
  assert.equal(p.flags[0].code, 'INVALID_INPUT');
});

test('학칙 [별표 4]: 학번별 표 선택, 2026.04.10. 부칙 ②는 기준일에 따라 미존재/조건부/적용', () => {
  const r2023 = resolveApplicableRules(input(), base());
  assert.equal(rule(r2023, 'ACAD_SCHED4_3_2013_2024').status, 'APPLIES');
  assert.equal(rule(r2023, 'ACAD_SCHED4_1_FROM_2026').status, 'NOT_APPLICABLE');
  assert.equal(rule(r2023, 'ENF118_GRAD_CREDITS_BY_COHORT').details.scheduleRule, 'ACAD_SCHED4_3_2013_2024');
  assert.equal(rule(r2023, 'ACAD_ADD_20260410_SCHED4_BY_GRADUATION').status, 'APPLIES');

  const mid = resolveApplicableRules(input({ asOfDate: '2026-05-01' }), base());
  const g = rule(mid, 'ACAD_ADD_20260410_SCHED4_BY_GRADUATION');
  assert.equal(g.status, 'CONDITIONAL');
  assert.ok(codes(g).includes('SCHEDULE4_PRE_AMENDMENT_NOT_HELD'));
  // [별표 4] ③은 2026-06-26에도 개정됐으므로 05-01 당시 문구는 현행과 다를 수 있다
  assert.ok(codes(rule(mid, 'ACAD_SCHED4_3_2013_2024')).includes('TEXT_INTERMEDIATE_VERSION'));

  const early = resolveApplicableRules(input({ asOfDate: '2026-03-15' }), base());
  assert.equal(rule(early, 'ACAD_ADD_20260410_SCHED4_BY_GRADUATION').status, 'NOT_APPLICABLE');
  assert.match(rule(early, 'ACAD_ADD_20260410_SCHED4_BY_GRADUATION').reason, /아직 없던 부칙/);

  const r2026 = resolveApplicableRules(input({ admissionYear: 2026 }), base());
  assert.equal(rule(r2026, 'ACAD_SCHED4_1_FROM_2026').status, 'APPLIES');
  assert.equal(rule(r2026, 'ACAD_ADD_20260205_PRIOR_ADDENDUM').status, 'NOT_APPLICABLE');
});

test('종전 부칙(원문 미보유)은 보여주되 전체 신뢰도를 깎지 않는다(critical=false)', () => {
  const res = resolveApplicableRules(input(), base());
  const r = rule(res, 'ACAD_ADD_20260205_PRIOR_ADDENDUM');
  assert.equal(r.status, 'APPLIES');
  assert.equal(r.confidence, 'NO_DATA');
  assert.equal(r.critical, false);
  assert.equal(res.confidence, 'CONFIRMED');
  // 기준일이 그 부칙(2026.02.05.) 전이면 부칙 자체가 없었다 → 해당 없음. 대신 시행규칙 보유 판본(2026-03-01) 전이라 조문 판본 미보유 추정.
  const old = resolveApplicableRules(input({ asOfDate: '2025-10-01' }), base());
  assert.equal(rule(old, 'ACAD_ADD_20260205_PRIOR_ADDENDUM').status, 'NOT_APPLICABLE');
  assert.ok(codes(rule(old, 'ENF5_CURRICULUM_AT_ADMISSION')).includes('TEXT_VERSION_NOT_HELD'));
  assert.equal(old.confidence, 'ESTIMATED');
});

test('개정 표시가 기준일 뒤에 없는 조문은 중간 판본 경고를 내지 않는다(조문 단위 판본 판단)', () => {
  const res = resolveApplicableRules(input({ asOfDate: '2026-05-01' }), base());
  // 시행규칙 제5조는 개정 표시가 없다 → 2026-05-01 당시 문구 = 현행
  assert.deepEqual(codes(rule(res, 'ENF5_CURRICULUM_AT_ADMISSION')), []);
  assert.equal(rule(res, 'ENF5_CURRICULUM_AT_ADMISSION').confidence, 'CONFIRMED');
});

test('작업치료·응급구조학과 전과는 2026 입학생부터(시행규칙 부칙) — 그 전 학번 조합은 확인 필요', () => {
  const ot = { id: 30, name: '작업치료학과' };
  const ok = resolveApplicableRules(input({ admissionYear: 2026, enrollmentType: 'MAJOR_CHANGE', departmentId: 30, majorChange: { grade: 2, year: 2027, semester: 1 }, asOfDate: '2027-04-01' }), base({ department: ot }));
  assert.equal(rule(ok, 'ENF_ADD_20260205_MAJOR_CHANGE_OT_EMT').status, 'APPLIES');
  const old = resolveApplicableRules(input({ admissionYear: 2024, enrollmentType: 'MAJOR_CHANGE', departmentId: 30, majorChange: { grade: 2, year: 2025, semester: 1 } }), base({ department: ot }));
  const r = rule(old, 'ENF_ADD_20260205_MAJOR_CHANGE_OT_EMT');
  assert.equal(r.status, 'NOT_APPLICABLE');
  assert.ok(old.flags.every((f) => f.code !== 'MAJOR_CHANGE_TARGET_NOT_ALLOWED_FOR_COHORT'), 'NOT_APPLICABLE 규칙 플래그는 전체 플래그에 올리지 않는다');
  assert.ok(codes(r).includes('MAJOR_CHANGE_TARGET_NOT_ALLOWED_FOR_COHORT'));
});

test('졸업요건(파트 1 evaluate) 결과에 데이터 등급을 칸별로 입힌다: 교양 분할은 추정, 판단 보류 학과는 추정', () => {
  const rows = [
    { id: 1, category: '교양필수', requiredCredits: 17, description: null, enrollmentType: null, minCourseCount: null, minAdmissionYear: 2024, maxAdmissionYear: 2024, requiredCourses: [] },
    { id: 2, category: '교양선택', requiredCredits: 20, description: null, enrollmentType: null, minCourseCount: null, minAdmissionYear: 2024, maxAdmissionYear: 2024, requiredCourses: [] },
    { id: 3, category: '전공필수', requiredCredits: 30, description: null, enrollmentType: null, minCourseCount: null, minAdmissionYear: 2024, maxAdmissionYear: 2024, requiredCourses: [] },
    { id: 4, category: '전공선택', requiredCredits: 39, description: null, enrollmentType: null, minCourseCount: null, minAdmissionYear: 2024, maxAdmissionYear: 2024, requiredCourses: [] },
    { id: 5, category: '일반선택', requiredCredits: 34, description: null, enrollmentType: null, minCourseCount: null, minAdmissionYear: 2024, maxAdmissionYear: 2024, requiredCourses: [] },
  ];
  const reqData = (dept) => ({ department: dept, rows, latestDataYear: 2026, candidates: [], history: null });
  const plain = { id: 11, name: '보통학과' };
  const ok = resolveApplicableRules(input({ admissionYear: 2024, departmentId: 11 }), base({ department: plain, requirements: reqData(plain) }));
  const req = ok.requirements.rules.find((r) => r.id === 'REQUIREMENTS');
  assert.equal(req.confidence, 'CONFIRMED');
  assert.equal(req.value.totalConfidence, 'CONFIRMED');
  assert.deepEqual(req.value.categories.map((c) => [c.category, c.confidence]), [['교양필수', 'ESTIMATED'], ['교양선택', 'ESTIMATED'], ['전공필수', 'CONFIRMED'], ['전공선택', 'CONFIRMED'], ['일반선택', 'CONFIRMED']]);

  const edu = { id: 12, name: '국어교육과' }; // 2024 사범대 자유선택 32 vs 34 판단 보류(#260)
  const held = resolveApplicableRules(input({ admissionYear: 2024, departmentId: 12 }), base({ department: edu, requirements: reqData(edu) }));
  const heldReq = held.requirements.rules.find((r) => r.id === 'REQUIREMENTS');
  assert.equal(heldReq.confidence, 'ESTIMATED');
  assert.ok(heldReq.flags.some((f) => f.code === 'DATA_PENDING_HOLD'));
  assert.equal(held.confidence, 'ESTIMATED');
});

test('dataQuality 등급표가 DATA_AUDIT.md §4 표와 같다(문서와 코드가 어긋나지 않게)', () => {
  const md = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'regulation-engine', 'DATA_AUDIT.md'), 'utf8');
  const section = md.slice(md.indexOf('## 4.'), md.indexOf('## 5.'));
  const rowsMd = section.split(/\r?\n/).filter((l) => /^\| 20\d\d \|/.test(l));
  assert.equal(rowsMd.length, 10);
  for (const line of rowsMd) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const year = Number(cells[0]);
    const gradeIn = (cell) => (/\*\*([ABC])\*\*/.exec(cell) || /^([ABC])\b/.exec(cell))[1];
    assert.equal(dq.DATA_GRADES.REQUIREMENTS[year], gradeIn(cells[1]), `${year} 졸업요건`);
    assert.equal(dq.DATA_GRADES.MAJOR_COURSES[year], gradeIn(cells[2]), `${year} 전공과목`);
    assert.equal(dq.DATA_GRADES.CSE_MAJOR_COURSES[year], gradeIn(cells[3]), `${year} 컴소공`);
    assert.equal(dq.DATA_GRADES.RAG[year], gradeIn(cells[4]), `${year} RAG`);
  }
});
