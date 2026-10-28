const test = require('node:test');
const assert = require('node:assert/strict');
const { assessAcademicWarnings } = require('../services/academicWarning');

/**
 * server/test/academicWarning.test.js
 * 학기 성적으로 학사경고(시행규칙 제68조)·유급(제100조) 대상일 수 있는 학기를 찾는다(#412, 설계 메모 #462). DB 없이 도는 순수 함수 테스트.
 * 학기 코드는 DB 값(1=1학기, 2=여름, 3=2학기, 4=겨울).
 */

const C = (name, year, semester, credits, letter, gpa, category = '전공선택') => ({ name, year, semester, credits, letter_grade: letter, gpa, category });
// 3학점 과목 하나로 학기 평균을 정한다.
const one = (year, semester, gpa, letter = 'C', category = '전공선택') => C(`과목${year}-${semester}`, year, semester, 3, letter, gpa, category);

test('일반 학과: 학기 평균 1.75 미만만 학사경고 대상 — 1.74는 대상, 1.75는 아니다', () => {
  const r = assessAcademicWarnings([one(2024, 1, 1.74, 'D'), one(2024, 3, 1.75, 'D+')], { departmentName: '경영학과' });
  assert.equal(r.regime, 'WARNING');
  assert.equal(r.threshold, 1.75);
  assert.deepEqual(r.terms.map((t) => [t.year, t.semester, t.gpa, t.flagged]), [
    [2024, 1, 1.74, true],
    [2024, 2, 1.75, false],
  ]);
  assert.deepEqual(r.terms[0].reasons, ['GPA_BELOW']);
  assert.equal(r.flaggedCount, 1);
  assert.equal(r.consecutiveCount, 0);
});

test('P/NP는 평균에서 빼고, 성적이 없는 과목이 있는 학기·계절학기는 판정하지 않는다', () => {
  const rows = [
    one(2024, 1, 1.0, 'D'),
    C('봉사', 2024, 1, 1, 'P', null), // 평균에 넣으면 안 된다
    one(2024, 2, 0, 'F'), // 여름 계절학기 — 판정하지 않는다
    one(2024, 3, 4.0, 'A'),
    C('수강중', 2024, 3, 3, null, null), // 이 학기는 성적이 다 들어오지 않았다
  ];
  const r = assessAcademicWarnings(rows, { departmentName: '경영학과' });
  assert.equal(r.terms.length, 2);
  assert.equal(r.terms[0].gpa, 1.0);
  assert.equal(r.terms[0].flagged, true);
  assert.equal(r.terms[1].judged, false);
  assert.equal(r.terms[1].pending, true);
});

test('재수강으로 나중에 대체된 기록도 그 학기 판정에 넣는다(당시 성적 기준)', () => {
  const rows = [C('자료구조', 2024, 1, 3, 'F', 0), C('자료구조', 2025, 1, 3, 'A', 4.0)];
  const r = assessAcademicWarnings(rows, { departmentName: '컴퓨터·소프트웨어공학과' });
  assert.equal(r.terms[0].flagged, true);
  assert.equal(r.terms[1].flagged, false);
});

test('연속 횟수는 가장 최근까지 이어진 판정 학기만 센다 — 판정하지 않은 학기는 건너뛴다', () => {
  const rows = [one(2023, 1, 3.0), one(2023, 3, 1.0, 'D'), one(2024, 1, 1.5, 'D'), C('수강중', 2024, 3, 3, null, null), one(2025, 1, 1.2, 'D')];
  const r = assessAcademicWarnings(rows, { departmentName: '경영학과' });
  assert.equal(r.flaggedCount, 3);
  assert.equal(r.consecutiveCount, 3);
  assert.deepEqual(r.dismissal, { consecutive: 4, total: 6 });
});

test('수업연한(4년 = 8학기)을 넘긴 학기는 학사경고를 판정하지 않는다', () => {
  const rows = [];
  for (let y = 2020; y <= 2024; y++) rows.push(one(y, 1, 3.0), one(y, 3, 3.0));
  rows.push(one(2025, 1, 1.0, 'D')); // 11번째 정규 학기
  const r = assessAcademicWarnings(rows, { departmentName: '경영학과' });
  const last = r.terms[r.terms.length - 1];
  assert.equal(last.beyondProgramYears, true);
  assert.equal(last.flagged, false);
});

test('예과·간호·약학: 학기 평균 2.0 미만이면 유급 대상(학사경고가 아니다)', () => {
  for (const dept of ['의예과', '간호학과', '약학과', '한약학과']) {
    const r = assessAcademicWarnings([one(2025, 1, 1.99, 'D+'), one(2025, 3, 2.0, 'C')], { departmentName: dept });
    assert.equal(r.regime, 'REPEAT', dept);
    assert.equal(r.threshold, 2.0);
    assert.deepEqual(r.terms.map((t) => t.flagged), [true, false], dept);
  }
});

test('전공필수 F가 하나라도 있으면 평균이 높아도 유급 대상(의·치·한·간호), 교양 F는 유급이 아니라 "재학 중 취득" 안내', () => {
  const rows = [
    C('해부학', 2025, 1, 3, 'F', 0, '전공필수'),
    C('생화학', 2025, 1, 9, 'A+', 4.5, '전공선택'),
    C('글쓰기', 2025, 3, 2, 'F', 0, '교양필수'),
    C('생리학', 2025, 3, 9, 'A+', 4.5, '전공필수'),
  ];
  const r = assessAcademicWarnings(rows, { departmentName: '간호학과' });
  assert.equal(r.terms[0].flagged, true);
  assert.deepEqual(r.terms[0].reasons, ['MAJOR_REQUIRED_F']);
  assert.deepEqual(r.terms[0].failedCourses, ['해부학']);
  assert.equal(r.terms[1].flagged, false);
  assert.deepEqual(r.terms[1].liberalArtsF, ['글쓰기']);
});

test('약학과는 전공필수뿐 아니라 전공 교과목 F도 유급 대상', () => {
  const rows = [C('약물학', 2025, 1, 3, 'F', 0, '전공선택'), C('약제학', 2025, 1, 9, 'A+', 4.5, '전공필수')];
  const r = assessAcademicWarnings(rows, { departmentName: '약학과' });
  assert.deepEqual(r.terms[0].reasons, ['MAJOR_F']);
});

test('의학과: 본과 학기는 전공교과목 평균으로, 예과 시절(처음 4학기)은 학기 평균으로 본다', () => {
  const rows = [
    // 예과 4학기 — 1학기만 평균 1.9
    one(2022, 1, 1.9, 'D+', '교양선택'), one(2022, 3, 3.0), one(2023, 1, 3.0), one(2023, 3, 3.0),
    // 본과 1학기: 교양은 낮아도 전공 평균 2.5 → 대상 아님
    C('교양', 2024, 1, 3, 'D', 1.0, '교양선택'), C('병리학', 2024, 1, 3, 'C+', 2.5, '전공선택'),
    // 본과 2학기: 전공 평균 1.5 → 대상
    C('내과학', 2024, 3, 3, 'D', 1.0, '전공선택'), C('외과학', 2024, 3, 3, 'C', 2.0, '전공선택'),
  ];
  const r = assessAcademicWarnings(rows, { departmentName: '의학과' });
  assert.deepEqual(r.terms.map((t) => t.flagged), [true, false, false, false, false, true]);
  assert.deepEqual(r.terms[0].reasons, ['GPA_BELOW']);
  assert.equal(r.terms[4].majorGpa, 2.5);
  assert.deepEqual(r.terms[5].reasons, ['MAJOR_GPA_BELOW']);
});

test('작업치료학과·응급구조학과는 의료계열이어도 학사경고 쪽이다(제100조 ① 단서)', () => {
  for (const dept of ['작업치료학과', '응급구조학과']) {
    const r = assessAcademicWarnings([one(2025, 1, 1.9, 'D+')], { departmentName: dept });
    assert.equal(r.regime, 'WARNING', dept);
    assert.equal(r.terms[0].flagged, false, dept);
  }
});
