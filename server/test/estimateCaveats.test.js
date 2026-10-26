const test = require('node:test');
const assert = require('node:assert/strict');
const { profileCaveats, allowedMajorChangeGrades } = require('../services/regulationEngine/profileCaveats');
const { certificationRecognitionUnverified, courseCountingCaveats, inProgressCredits } = require('../services/graduationService');

/**
 * "틀릴 수 있는데 확정처럼 보이는" 경우에 추정 플래그가 붙는지(2026-10-24 점검, 3차 문의 E·F).
 * 플래그가 없으면 진단이 확정으로 나가므로, 결과를 바꿀 수 있는 경우에만 붙고 아닌 경우에는 붙지 않아야 한다.
 */

const codes = (flags) => flags.map((f) => f.code);
const ctx = (over) => ({ admissionYear: 2021, enrollmentType: 'GENERAL', majorChange: null, transfer: null, ...over });
const row = (category, requiredCredits, minAdmissionYear, maxAdmissionYear) => ({ category, requiredCredits, minAdmissionYear, maxAdmissionYear, enrollmentType: null, minCourseCount: null });

test('전과 학년이 시행규칙 제109조 전과 시기와 맞지 않으면 추정(간호 3학년만, 보건의료·사범 2·3학년, 계열 2~4학년, 전문학사 1·2학년)', () => {
  assert.deepEqual(allowedMajorChangeGrades('간호학과'), [3]);
  assert.deepEqual(allowedMajorChangeGrades('물리치료학과'), [2, 3]);
  assert.deepEqual(allowedMajorChangeGrades('국어교육과'), [2, 3]);
  assert.deepEqual(allowedMajorChangeGrades('공학3계열'), [2, 3, 4]);
  assert.deepEqual(allowedMajorChangeGrades('외식조리과'), [1, 2]);
  assert.deepEqual(allowedMajorChangeGrades('경영학과'), [1, 2, 3, 4]);
  const mc = (grade) => ctx({ enrollmentType: 'MAJOR_CHANGE', majorChange: { grade, year: 2023, semester: 1 } });
  assert.ok(codes(profileCaveats(mc(2), '간호학과')).includes('MAJOR_CHANGE_GRADE_NOT_ALLOWED'));
  assert.ok(!codes(profileCaveats(mc(3), '간호학과')).includes('MAJOR_CHANGE_GRADE_NOT_ALLOWED'));
  assert.ok(!codes(profileCaveats(mc(4), '경영학과')).includes('MAJOR_CHANGE_GRADE_NOT_ALLOWED'));
});

test('전과생: "전과한 학년의 당초 입학자" 학번으로 계산한 최종 요건이 실제로 다를 때만 추정', () => {
  const { evaluate } = require('../services/regulationEngine/evaluate');
  const { normalizeInput } = require('../services/regulationEngine/context');
  const rows = [
    row('교양필수', 5, 2019, 2021), row('교양선택', 18, 2019, 2021), row('일반선택', 38, 2019, 2021),
    row('교양필수', 5, 2022, 2024), row('교양선택', 34, 2022, 2024), row('일반선택', 22, 2022, 2024),
    row('전공필수', 19, null, null), row('전공선택', 56, null, null),
    { ...row('전공', 48, null, null), enrollmentType: 'MAJOR_CHANGE' },
  ];
  const judge = (admissionYear, majorChange) => {
    const { ctx: c } = normalizeInput({ admissionYear, enrollmentType: 'MAJOR_CHANGE', majorChange, departmentName: '전기공학과', asOfDate: '2026-10-25' });
    return codes(evaluate(c, { department: { id: 1, name: '전기공학과' }, rows, latestDataYear: 2026 }).rules.find((x) => x.id === 'REQUIREMENTS').flags);
  };
  // 2021학번이 2년 휴학 뒤 2025년 3학년 전과 → 당초 입학자 2023학번(교양 39) ≠ 2021학번(교양 23)
  assert.ok(judge(2021, { grade: 3, year: 2025, semester: 1 }).includes('MAJOR_CHANGE_ORIGINAL_COHORT_DIFFERS'));
  // 휴학 없이 2023년 3학년 전과 → 당초 입학자 = 2021학번 자신
  assert.ok(!judge(2021, { grade: 3, year: 2023, semester: 1 }).includes('MAJOR_CHANGE_ORIGINAL_COHORT_DIFFERS'));
  // 휴학했어도 두 학번의 최종 요건이 같으면(2022학번 → 당초 입학자 2023학번) 붙지 않는다
  assert.ok(!judge(2022, { grade: 3, year: 2025, semester: 1 }).includes('MAJOR_CHANGE_ORIGINAL_COHORT_DIFFERS'));
});

test('작업치료·응급구조학과는 제109조 전과 시기를 2026학번부터 적용한다(시행규칙 부칙 2026.02.05. 제2조)', () => {
  assert.deepEqual(allowedMajorChangeGrades('응급구조학과', 2022), [1, 2, 3, 4]);
  assert.deepEqual(allowedMajorChangeGrades('응급구조학과', 2026), [2, 3]);
  const mc = ctx({ admissionYear: 2022, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 4, year: 2025, semester: 1 } });
  assert.ok(!codes(profileCaveats(mc, '작업치료학과')).includes('MAJOR_CHANGE_GRADE_NOT_ALLOWED'));
});

test('수강 중 학점은 이번 학기 이후의 성적 없는 과목만 센다(지난 학기에 성적 없이 저장한 과목은 이수한 과목)', () => {
  const courses = [
    { credits: 3, year: 2026, semester: 3, letter_grade: null }, // 2026-2학기 수강 중
    { credits: 3, year: 2026, semester: 4, letter_grade: null }, // 겨울 계절(뒤 학기)
    { credits: 3, year: 2026, semester: 1, letter_grade: null }, // 지난 학기, 성적 없이 저장
    { credits: 3, year: 2026, semester: 3, letter_grade: 'A' },
  ];
  assert.equal(inProgressCredits(courses, { year: 2026, semester: 2 }), 6);
  assert.equal(inProgressCredits(courses, { year: 2026, semester: 1 }), 9);
});

test('광역계열에 전과·편입으로 들어와 기초·심화·응용을 적용하지 않았으면 추정, 일반 계열 학생은 아님', () => {
  const relaxed = profileCaveats(ctx({ admissionYear: 2023, enrollmentType: 'MAJOR_CHANGE', majorChange: { grade: 3, year: 2025, semester: 1 } }), '공학3계열', { adjustments: ['MAJOR_RELAXATION'] });
  assert.ok(codes(relaxed).includes('BROAD_SERIES_AREAS_NOT_APPLIED'));
  const general = profileCaveats(ctx({ admissionYear: 2026 }), '공학3계열', { hasMajorAreaMinimums: true });
  assert.ok(!codes(general).includes('BROAD_SERIES_AREAS_NOT_APPLIED'));
});

test('의학과·치의학과·한의학과 편입은 내규 확인 안내, 의생명공학계열 2026 졸업인증 그룹은 해석이라 추정', () => {
  assert.ok(codes(profileCaveats(ctx({ enrollmentType: 'TRANSFER_ADMISSION', transfer: { grade: 3 } }), '의학과')).includes('TRANSFER_MEDICAL_SCHOOL_BYLAW'));
  assert.ok(codes(profileCaveats(ctx({ admissionYear: 2026 }), '의생명공학계열', { hasCertificationRows: true, hasMajorAreaMinimums: true })).includes('CERTIFICATION_GROUP_INTERPRETED'));
  assert.ok(!codes(profileCaveats(ctx({ admissionYear: 2026 }), '공학3계열', { hasCertificationRows: true, hasMajorAreaMinimums: true })).includes('CERTIFICATION_GROUP_INTERPRETED'));
});

const GENERIC = { category: '졸업인증제', requiredCourses: ['전공현장실습', '캡스톤디자인', '사회봉사'], min_course_count: 1 };
const course = (name, category, letter_grade = 'A') => ({ name, category, letter_grade });

test('졸업인증 기본영역: 학과 전공 과목으로 채웠으면 확정, 일반선택 과목으로만 채웠거나 비슷한 다른 실습을 들었으면 추정', () => {
  assert.equal(certificationRecognitionUnverified([GENERIC], [course('캡스톤디자인1', '전공선택')]), false);
  assert.equal(certificationRecognitionUnverified([GENERIC], [course('융합캡스톤디자인1', '일반선택')]), true);
  assert.equal(certificationRecognitionUnverified([GENERIC], [course('사회복지현장실습', '전공선택')]), true, '이름이 달라 미충족이지만 인정될 수 있다');
  assert.equal(certificationRecognitionUnverified([GENERIC], [course('경영학원론', '전공필수')]), false, '비슷한 과목이 없으면 미충족이 확실하다');
  assert.equal(certificationRecognitionUnverified([GENERIC], [course('융합캡스톤디자인1', '일반선택')], { teachingCourse: true }), false, '교직이수자는 교직 과목으로 대체');
  const deptOnly = { category: '졸업인증제', requiredCourses: ['기업연계프로젝트1', '기업연계프로젝트2'], min_course_count: 2 };
  assert.equal(certificationRecognitionUnverified([deptOnly], [course('단기현장실습1', '일반선택')]), false, '학과가 정한 과목은 이름이 정해져 있다');
});

test('과목 세기 가정: 교양기초 초과분으로 교양선택을 채웠을 때, 계열 과목으로 전공필수가 모자랄 때, 교직 이수 중일 때만 추정', () => {
  const base = { majorAreaCredits: null, primaryCourses: [], teachingCourse: null, certificationRows: [], allCourseRows: [] };
  const liberal = (electiveCredits) => ({ electiveCredits, unknownCredits: 0, electiveCreditsRequired: 16 });
  const elective = [{ category: '교양선택', requiredCredits: 32, earnedCredits: 32 }];
  assert.ok(codes(courseCountingCaveats({ ...base, categories: elective, liberalElectiveAreas: liberal(10) })).includes('LIBERAL_FOUNDATION_OVERFLOW_COUNTED'));
  assert.ok(!codes(courseCountingCaveats({ ...base, categories: elective, liberalElectiveAreas: liberal(16) })).includes('LIBERAL_FOUNDATION_OVERFLOW_COUNTED'));

  const required = [{ category: '전공필수', requiredCredits: 19, earnedCredits: 12 }];
  const seriesCourse = [{ name: '자료구조', category: '전공선택', major_area: '기초' }];
  assert.ok(codes(courseCountingCaveats({ ...base, categories: required, liberalElectiveAreas: null, primaryCourses: seriesCourse })).includes('MAJOR_AREA_COURSES_OUTSIDE_SERIES'));
  const met = [{ category: '전공필수', requiredCredits: 19, earnedCredits: 21 }];
  assert.ok(!codes(courseCountingCaveats({ ...base, categories: met, liberalElectiveAreas: null, primaryCourses: seriesCourse })).includes('MAJOR_AREA_COURSES_OUTSIDE_SERIES'));

  assert.ok(codes(courseCountingCaveats({ ...base, categories: [], liberalElectiveAreas: null, teachingCourse: true })).includes('TEACHING_CREDITS_COUNTED'));
  assert.deepEqual(codes(courseCountingCaveats({ ...base, categories: [], liberalElectiveAreas: null })), []);
});

test('전문학사 과정은 졸업논문·졸업인증제를 졸업사정에서 뺀다(시행규칙 제118조 제1항 제7호)', () => {
  const { evaluate } = require('../services/regulationEngine/evaluate');
  const { normalizeInput } = require('../services/regulationEngine/context');
  const rows = [
    row('교양필수', 5, 2026, null), row('교양선택', 4, 2026, null), row('전공필수', 15, 2026, null), row('전공선택', 45, 2026, null), row('일반선택', 11, 2026, null),
    { ...row('졸업논문', 0, 2026, null), minCourseCount: 1, requiredCourses: ['졸업(시험·작품)논문'] },
    { ...row('졸업인증제', 0, 2026, null), minCourseCount: 1, requiredCourses: ['캡스톤디자인'] },
  ];
  const judge = (name) => {
    const { ctx: c } = normalizeInput({ admissionYear: 2026, enrollmentType: 'GENERAL', departmentName: name, asOfDate: '2026-10-25' });
    const r = evaluate(c, { department: { id: 1, name }, rows, latestDataYear: 2026 });
    return r.rules.find((x) => x.id === 'REQUIREMENTS');
  };
  const associate = judge('외식조리과');
  assert.deepEqual(associate.value.certifications, []);
  assert.ok(codes(associate.flags).includes('ASSOCIATE_DEGREE_THESIS_CERT_EXCLUDED'));
  assert.equal(judge('경영학과').value.certifications.length, 2);
});

test('계열 과목 추정은 계열 학생이 아닐 때, 전공선택으로 센 과목이 있을 때만 붙는다', () => {
  const base = { majorAreaCredits: null, teachingCourse: null, certificationRows: [], allCourseRows: [], liberalElectiveAreas: null };
  const categories = [{ category: '전공필수', requiredCredits: 19, earnedCredits: 12 }];
  const series = [{ name: '자료구조', category: '전공선택', major_area: '기초' }];
  assert.ok(!codes(courseCountingCaveats({ ...base, categories, primaryCourses: series, isSeriesDepartment: true })).includes('MAJOR_AREA_COURSES_OUTSIDE_SERIES'));
  const savedAsRequired = [{ name: '자료구조', category: '전공필수', major_area: '기초' }];
  assert.ok(!codes(courseCountingCaveats({ ...base, categories, primaryCourses: savedAsRequired })).includes('MAJOR_AREA_COURSES_OUTSIDE_SERIES'));
});

test('복학생: 휴학한 만큼 뒤 학번으로 계산한 최종 요건이 입학 학번과 다를 때만 추정(2차 문의 B-1)', () => {
  const { evaluate } = require('../services/regulationEngine/evaluate');
  const { normalizeInput } = require('../services/regulationEngine/context');
  const rows = [
    row('교양필수', 5, 2019, 2021), row('교양선택', 18, 2019, 2021), row('일반선택', 38, 2019, 2021),
    row('교양필수', 5, 2022, 2024), row('교양선택', 34, 2022, 2024), row('일반선택', 22, 2022, 2024),
    row('전공필수', 19, null, null), row('전공선택', 56, null, null),
  ];
  const judge = (admissionYear, leavePeriods) => {
    const { ctx: c } = normalizeInput({ admissionYear, enrollmentType: 'GENERAL', departmentName: '전기공학과', asOfDate: '2026-10-25', leavePeriods });
    return codes(evaluate(c, { department: { id: 1, name: '전기공학과' }, rows, latestDataYear: 2026 }).rules.find((x) => x.id === 'REQUIREMENTS').flags);
  };
  // 복학생도 입학 학번 표를 따른다(2차 문의 B-1) — 휴학해 함께 다니는 학번의 기준이 달라도 추정 사유가 아니다.
  for (const periods of [[{ startYear: 2023, startSemester: 1, semesters: 4 }], [{ startYear: 2023, startSemester: 1, semesters: 1 }], [], null]) {
    const flags = judge(2021, periods);
    assert.ok(!flags.some((code) => code.startsWith('RETURNING_')), JSON.stringify(periods));
  }
});
