const { test } = require('node:test');
const assert = require('node:assert/strict');
const keys = require('../services/curriculumKeys');
const {
  expandYears,
  normalizeCourseCategory,
  computeRequirementChanges,
  computeCourseChanges,
  computeDepartmentChanges,
} = require('../services/curriculumChanges');

/**
 * server/test/curriculumChanges.test.js
 * 학년도 사이 변경 이력 계산(순수 함수)과 rule_key/course_key 규칙 검증. DB가 필요 없다.
 * 2017~2026 10개 학번에 걸친 가상의 "A 규정"(졸업학점·필수/선택 변경)과 학과 개편(경영학과 → 경영계열)을 쓴다.
 */

const UNIVERSE = { min: 2017, max: 2026 };
const names = {
  departments: new Map([[1, 'A학과'], [2, '경영학과'], [3, '경영계열']]),
  tracks: new Map([[31, '경영학전공']]),
};

function req(departmentId, departmentName, category, requiredCredits, min, max, extra = {}) {
  return {
    departmentId, departmentName, category, requiredCredits,
    minAdmissionYear: min, maxAdmissionYear: max,
    enrollmentType: null, minCourseCount: null, ...extra,
  };
}

test('rule_key: 학과|카테고리코드|입학유형, 입학유형이 없으면 GENERAL', () => {
  assert.equal(keys.buildRuleKey('경영학과', '전공필수', null), '경영학과|MAJOR_REQUIRED|GENERAL');
  assert.equal(keys.buildRuleKey('건축학과', '전공', 'TRANSFER_ADMISSION'), '건축학과|MAJOR|TRANSFER_ADMISSION');
  assert.equal(keys.buildRuleKey('X', '새카테고리', null), 'X|OTHER:새카테고리|GENERAL');
  assert.equal(keys.buildDerivedRuleKey('경영학과', 'GRAD_TOTAL', null), '경영학과|GRAD_TOTAL|GENERAL');
});

test('course_key: 학수번호가 있으면 C:학수번호, 없으면 정규화한 과목명(N:)', () => {
  assert.equal(keys.buildCourseKey(' 169041 ', '상업논리및논술'), 'C:169041');
  assert.equal(keys.buildCourseKey('l04003', 'x'), 'C:L04003');
  assert.equal(keys.buildCourseKey(null, '졸업(시험·작품)논문'), keys.buildCourseKey('', '졸업(시험.작품)논문'));
  assert.notEqual(keys.buildCourseKey(null, '기업연계프로젝트1'), keys.buildCourseKey(null, '기업연계프로젝트2'));
});

test('expandYears: null 상·하한은 universe 끝으로 자른다', () => {
  assert.deepEqual(expandYears(2024, 2026, UNIVERSE), [2024, 2025, 2026]);
  assert.deepEqual(expandYears(null, 2018, UNIVERSE), [2017, 2018]);
  assert.deepEqual(expandYears(2025, null, UNIVERSE), [2025, 2026]);
  assert.deepEqual(expandYears(2000, 2017, UNIVERSE), [2017]);
});

test('이전 구분 코드(기전/선전/교필)와 광역계열 코드(기초/심화/응용)를 비교용으로 통일한다', () => {
  assert.equal(normalizeCourseCategory('기전'), '전공필수');
  assert.equal(normalizeCourseCategory('선전'), '전공선택');
  assert.equal(normalizeCourseCategory('심화'), '전공심화');
  assert.equal(normalizeCourseCategory('전공필수'), '전공필수');
});

test('요건: 같은 규정의 버전들(2017~2018 / 2019~2021 / 2022~2026)에서 변경 시점을 찾는다', () => {
  const rows = [
    req(1, 'A학과', '교양선택', 30, 2017, 2018),
    req(1, 'A학과', '교양선택', 32, 2019, 2021),
    req(1, 'A학과', '교양선택', 32, 2022, 2026),
    req(1, 'A학과', '전공필수', 19, 2017, 2021),
    req(1, 'A학과', '전공선택', 56, 2017, 2021),
    req(1, 'A학과', '전공필수', 19, 2022, 2026),
    req(1, 'A학과', '전공선택', 51, 2022, 2026),
  ];
  const changes = computeRequirementChanges({ rows, edges: [], universe: UNIVERSE });
  const byKey = (k) => changes.filter((c) => c.subjectKey === k);

  assert.deepEqual(
    byKey('A학과|LIBERAL_ELECTIVE|GENERAL').map((c) => [c.fromYear, c.toYear, c.oldValue, c.newValue]),
    [[2018, 2019, '30', '32']],
    '교양선택은 2018학번까지 30, 2019학번부터 32 — 한 건'
  );
  assert.deepEqual(
    byKey('A학과|MAJOR_ELECTIVE|GENERAL').map((c) => [c.fromYear, c.toYear, c.oldValue, c.newValue]),
    [[2021, 2022, '56', '51']]
  );
  assert.equal(byKey('A학과|MAJOR_REQUIRED|GENERAL').length, 0, '값이 같은 전공필수는 변경이 아님');

  // 합산(졸업학점 총계) 이력: 2018→2019(+2), 2021→2022(−5)
  const grad = byKey('A학과|GRAD_TOTAL|GENERAL').map((c) => [c.fromYear, c.toYear, c.oldValue, c.newValue]);
  assert.deepEqual(grad, [[2018, 2019, '105', '107'], [2021, 2022, '107', '102']]);
});

test('요건: 데이터가 없는 학번(2017~2023 미입력)은 신설/폐지로 잡지 않는다', () => {
  const rows = [
    req(1, 'A학과', '교양선택', 32, 2024, 2024),
    req(1, 'A학과', '교양선택', 30, 2025, 2025),
  ];
  const changes = computeRequirementChanges({ rows, edges: [], universe: UNIVERSE });
  assert.equal(changes.filter((c) => c.changeType !== 'CHANGED').length, 0);
  // 교양선택 값 변경이 교양선택·교양 합계(LIBERAL_TOTAL)·졸업학점 총계(GRAD_TOTAL) 세 규정의 변경으로 각각 남는다
  assert.deepEqual(changes.map((c) => c.subjectKey).sort(), [
    'A학과|GRAD_TOTAL|GENERAL',
    'A학과|LIBERAL_ELECTIVE|GENERAL',
    'A학과|LIBERAL_TOTAL|GENERAL',
  ]);
  assert.ok(changes.every((c) => c.fromYear === 2024 && c.toYear === 2025));
});

test('요건: 전공필수+선택 ↔ 전공으로 구성이 바뀌어도 MAJOR_TOTAL로 비교된다', () => {
  const rows = [
    req(1, 'A학과', '전공필수', 20, 2024, 2024),
    req(1, 'A학과', '전공선택', 46, 2024, 2024),
    req(1, 'A학과', '전공', 66, 2025, 2025),
  ];
  const changes = computeRequirementChanges({ rows, edges: [], universe: UNIVERSE });
  assert.equal(changes.filter((c) => c.subjectKey === 'A학과|MAJOR_TOTAL|GENERAL').length, 0, '합계 66은 그대로');
  const structural = changes.filter((c) => c.field === 'existence');
  assert.equal(structural.length, 3);
  assert.ok(structural.every((c) => c.note && c.note.includes('MAJOR_TOTAL')));
});

test('요건: 졸업인증제처럼 여러 학번에 걸친 행이 있어도 학점 요건이 없던 학번을 coverage로 보지 않는다', () => {
  const rows = [
    req(1, 'A학과', '교양선택', 32, 2024, 2025),
    req(1, 'A학과', '졸업인증제', 0, 2020, 2025, { minCourseCount: 1 }),
  ];
  const changes = computeRequirementChanges({ rows, edges: [], universe: UNIVERSE });
  assert.equal(changes.length, 0);
});

test('요건: 학과 개편(경영학과 → 경영계열)을 건너 마지막 학번과 첫 학번을 비교한다', () => {
  const rows = [
    req(2, '경영학과', '교양선택', 32, 2025, 2025),
    req(2, '경영학과', '일반선택', 27, 2025, 2025),
    req(3, '경영계열', '교양선택', 28, 2026, null),
    req(3, '경영계열', '일반선택', 21, 2026, null),
  ];
  const edges = [{ fromDepartmentId: 2, fromTrackId: null, toDepartmentId: 3, toTrackId: 31, relation: 'REORG', effectiveYear: 2026, source: 'NAME_MATCH', note: null }];
  const changes = computeRequirementChanges({ rows, edges, universe: UNIVERSE });
  const lib = changes.find((c) => c.subjectKey === '경영학과|LIBERAL_ELECTIVE|GENERAL');
  assert.equal(lib.fromYear, 2025);
  assert.equal(lib.toYear, 2026);
  assert.equal(lib.oldValue, '32');
  assert.equal(lib.newValue, '28');
  assert.equal(lib.successorDepartmentId, 3);
  assert.match(lib.note, /학과 개편/);
});

test('과목: 과목명·학점·필수/선택·학년·학기 변경과 폐지·신설을 학수번호로 이어 찾는다', () => {
  const c = (code, name, credits, category, grade, semester, min, max) => ({
    departmentId: 1, trackId: null, minAdmissionYear: min, maxAdmissionYear: max,
    courseCode: code, courseName: name, credits, category, grade, semester,
  });
  const rows = [
    // 2024
    c('101', '상업논리', 3, '전공필수', 1, '1', 2024, 2024),
    c('102', '통계', 3, '전공필수', 2, '1', 2024, 2024),
    c('103', '폐지될과목', 3, '전공선택', 3, '1', 2024, 2024),
    c('104', '구번호과목', 3, '전공선택', 3, '2', 2024, 2024),
    // 2025
    c('101', '상업논리및논술', 2, '전공선택', 1, '1', 2025, 2025),
    c('102', '통계', 3, '전공필수', 2, '1', 2025, 2025),
    c('905', '구번호과목', 3, '전공선택', 3, '2', 2025, 2025),
    c('106', '신설과목', 3, '전공선택', 4, '1', 2025, 2025),
  ];
  const { changes, courseLineage } = computeCourseChanges({ rows, edges: [], universe: UNIVERSE, names });
  const find = (key, field) => changes.find((x) => x.subjectKey === key && x.field === field);

  assert.deepEqual([find('C:101', 'course_name').oldValue, find('C:101', 'course_name').newValue], ['상업논리', '상업논리및논술']);
  assert.deepEqual([find('C:101', 'credits').oldValue, find('C:101', 'credits').newValue], ['3', '2']);
  assert.deepEqual([find('C:101', 'category').oldValue, find('C:101', 'category').newValue], ['전공필수', '전공선택']);
  assert.equal(find('C:101', 'category').fromYear, 2024);
  assert.equal(find('C:101', 'category').toYear, 2025);
  assert.equal(changes.filter((x) => x.subjectKey === 'C:102').length, 0, '바뀐 게 없는 과목은 기록하지 않음');
  assert.equal(find('C:103', 'existence').changeType, 'REMOVED');
  assert.equal(find('C:106', 'existence').changeType, 'ADDED');
  // 과목명이 같고 학수번호만 바뀐 것은 폐지+신설이 아니라 학수번호 변경 + 계보(RENAME)
  assert.equal(find('C:104', 'existence'), undefined);
  assert.equal(find('C:905', 'existence'), undefined);
  assert.deepEqual([find('C:104', 'course_code').oldValue, find('C:104', 'course_code').newValue], ['104', '905']);
  assert.deepEqual(courseLineage.map((l) => [l.fromCourseKey, l.toCourseKey, l.relation, l.effectiveYear]), [['C:104', 'C:905', 'RENAME', 2025]]);
});

test('과목: 학과 개편을 건너도 계열공통 표로 옮겨 간 과목을 폐지로 보지 않는다', () => {
  const c = (departmentId, trackId, code, name, min, max) => ({
    departmentId, trackId, minAdmissionYear: min, maxAdmissionYear: max,
    courseCode: code, courseName: name, credits: 3, category: '전공선택', grade: 1, semester: '1',
  });
  const rows = [
    c(2, null, '201', '경영학원론', 2025, 2025),
    c(2, null, '202', '대학생활과자기혁신', 2025, 2025),
    c(2, null, '203', '사라지는과목', 2025, 2025),
    c(3, 31, '201', '경영학원론', 2026, 2026), // 세부전공 표에 그대로
    c(3, null, '202', '대학생활과자기혁신', 2026, 2026), // 계열공통 표로 이동
  ];
  const edges = [{ fromDepartmentId: 2, fromTrackId: null, toDepartmentId: 3, toTrackId: 31, relation: 'REORG', effectiveYear: 2026, source: 'NAME_MATCH', note: null }];
  const { changes } = computeCourseChanges({ rows, edges, universe: UNIVERSE, names });
  assert.deepEqual(
    changes.map((x) => [x.subjectKey, x.field, x.changeType, x.fromYear, x.toYear]),
    [['C:203', 'existence', 'REMOVED', 2025, 2026]],
    '경영학원론·대학생활과자기혁신은 이어지고 사라지는과목만 폐지'
  );
  assert.match(changes[0].note, /경영학과 → 경영계열\(경영학전공\)/);
});

test('과목: 광역계열 이수구분 체계(기초·심화·응용)로 바뀐 것은 실제 필수/선택 변경이 아닐 수 있다고 표시한다', () => {
  const base = { departmentId: 1, trackId: null, courseCode: '301', courseName: 'X', credits: 3, grade: 1, semester: '1' };
  const rows = [
    { ...base, category: '전공필수', minAdmissionYear: 2025, maxAdmissionYear: 2025 },
    { ...base, category: '심화', minAdmissionYear: 2026, maxAdmissionYear: 2026 },
  ];
  const { changes } = computeCourseChanges({ rows, edges: [], universe: UNIVERSE, names });
  const cat = changes.find((x) => x.field === 'category');
  assert.equal(cat.newValue, '전공심화');
  assert.match(cat.note, /이수구분 체계 변경/);
});

test('과목: 이전 학과 구분 코드가 그대로 남은 행(선전)과 정규 구분(전공선택)은 같은 값으로 비교한다', () => {
  const base = { departmentId: 1, trackId: null, courseCode: '401', courseName: 'Y', credits: 3, grade: 1, semester: '1' };
  const rows = [
    { ...base, category: '선전', minAdmissionYear: null, maxAdmissionYear: 2025 },
    { ...base, category: '전공선택', minAdmissionYear: 2026, maxAdmissionYear: 2026 },
  ];
  const { changes } = computeCourseChanges({ rows, edges: [], universe: UNIVERSE, names });
  assert.equal(changes.length, 0);
});

test('학과 개편 이력(DEPARTMENT): 간선 한 건당 한 행, 이름 일치로 추정한 것은 표시한다', () => {
  const edges = [{ fromDepartmentId: 2, fromTrackId: null, toDepartmentId: 3, toTrackId: 31, relation: 'REORG', effectiveYear: 2026, source: 'NAME_MATCH', note: '메모' }];
  const [c] = computeDepartmentChanges({ edges, names });
  assert.equal(c.subjectType, 'DEPARTMENT');
  assert.equal(c.fromYear, 2025);
  assert.equal(c.toYear, 2026);
  assert.equal(c.oldValue, '경영학과');
  assert.equal(c.newValue, '경영계열(경영학전공)');
  assert.match(c.note, /REORG\(이름 일치로 추정\)/);
});

test('과목: 인접 두 과목의 학수번호가 맞바뀐 경우 이름이 서로 바뀐 것이 아니라 학수번호 변경으로 기록한다', () => {
  const c = (code, name, min, max, category) => ({
    departmentId: 1, trackId: null, minAdmissionYear: min, maxAdmissionYear: max,
    courseCode: code, courseName: name, credits: 3, category, grade: 2, semester: '1',
  });
  const rows = [
    c('168008', '경제금융통계기초', 2024, 2024, '전공필수'),
    c('168009', '실용금융', 2024, 2024, '전공선택'),
    c('168008', '실용금융', 2025, 2025, '전공선택'),
    c('168009', '경제금융통계기초', 2025, 2025, '전공필수'),
  ];
  const { changes, courseLineage } = computeCourseChanges({ rows, edges: [], universe: UNIVERSE, names });
  assert.equal(changes.filter((x) => x.field === 'course_name').length, 0, '이름 변경으로 기록하면 안 됨');
  assert.equal(changes.filter((x) => x.field === 'category').length, 0, '이름 기준으로 이으면 구분은 그대로');
  const codeChanges = changes.filter((x) => x.field === 'course_code').map((x) => [x.displayName, x.oldValue, x.newValue]).sort();
  assert.deepEqual(codeChanges, [['경제금융통계기초', '168008', '168009'], ['실용금융', '168009', '168008']]);
  assert.ok(codeChanges.length === 2 && changes.every((x) => /맞바뀜/.test(x.note)));
  assert.equal(courseLineage.length, 2);
});
