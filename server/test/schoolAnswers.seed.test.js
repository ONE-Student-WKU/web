const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * server/test/schoolAnswers.seed.test.js
 * 학교 서면 답변으로 확정한 값이 시드에서 되돌아가지 않는지 확인한다. DB 없이 돈다.
 * 답변 원문·해석: docs/school-inquiry/교육혁신과_답변_2026-10-14.md
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SEED = require(path.join(ROOT, 'db', 'seed', 'curriculum_requirements.json'));
const COURSES_2026 = require(path.join(ROOT, 'db', 'curriculum', '_source', '2026_학과별_전공과목_원본.json'));

const cert2026 = (dept) =>
  SEED.filter((r) => r.departmentName === dept && r.category === '졸업인증제' && r.minAdmissionYear === 2026 && r.maxAdmissionYear === null);

test('A-4·D-2: 개편된 2026 학과·계열의 졸업인증제 그룹이 확정 값이다(디자인융합계열은 "가", 패션디자인산업전공만 "나")', () => {
  const expected = {
    나: ['공학1계열', '공학2계열', '공학3계열', '그린바이오계열', '스마트농업계열', '푸드테크계열', '뷰티디자인학과', '의생명공학계열'],
    가: ['창의문화융합계열', '경영계열', '경제금융·회계세무계열', '경찰·공공행정계열', '소방행정·방재계열', '보건행정학과', '사회복지학과'],
  };
  for (const [group, depts] of Object.entries(expected)) {
    for (const dept of depts) {
      const rows = cert2026(dept);
      assert.equal(rows.length, 1, dept);
      assert.match(rows[0].description, new RegExp(`졸업인증제 "${group}" 그룹`), dept);
    }
  }
  // 디자인융합계열은 "가" 그룹이다(2차 문의 D-2, D-83 — D-66의 판단 보류를 해소). 2020~2025학번 행도 같다.
  // 패션디자인산업전공만 "나" 그룹이라 세부전공 예외(trackCertificationRules.js)로 바꿔 끼운다.
  const design = SEED.filter((r) => r.departmentName === '디자인융합계열' && r.category === '졸업인증제');
  assert.equal(design.length, 2);
  for (const row of design) {
    assert.match(row.description, /졸업인증제 "가" 그룹/);
    assert.doesNotMatch(row.description, /학교에 확인 중/);
    assert.deepEqual(row.requiredCourses, ['전공현장실습', '캡스톤디자인', '사회봉사']);
    assert.equal(row.minCourseCount, 1);
  }
  const { applyTrackCertificationRule } = require('../services/trackCertificationRules');
  const toEngineRow = (r) => ({ category: r.category, description: r.description, requiredCourses: r.requiredCourses, min_course_count: r.minCourseCount });
  for (const admissionYear of [2025, 2026]) {
    const base = toEngineRow(design.find((r) => admissionYear >= r.minAdmissionYear && (r.maxAdmissionYear == null || admissionYear <= r.maxAdmissionYear)));
    const [fashion] = applyTrackCertificationRule([base], { departmentName: '디자인융합계열', admissionYear, trackName: '패션디자인산업전공' });
    assert.deepEqual([fashion.requiredCourses, fashion.min_course_count], [['캡스톤디자인', '기업연계프로젝트', '종합설계'], 1], `${admissionYear} 패션`);
    assert.match(fashion.description, /"나" 그룹/);
    for (const trackName of ['시각정보디자인전공', '실내·산업디자인전공', '파인아트전공', '공예문화·주얼리디자인전공']) {
      assert.deepEqual(applyTrackCertificationRule([base], { departmentName: '디자인융합계열', admissionYear, trackName }), [base], `${admissionYear} ${trackName}`);
    }
  }
});

test('A-6: 간호학과는 졸업인증제 "다" 그룹이라 2026학번에도 기본영역 행이 없다', () => {
  assert.deepEqual(cert2026('간호학과'), []);
  const table = require(path.join(ROOT, 'db', 'curriculum', '_source', '2026_학번별_이수기준.json'));
  assert.ok(table.certification.groupC.colleges.includes('간호대학'));
});

test('C-1: 책자와 조회시스템이 다르면 조회시스템 — 2026 편성의 정산사상1(101298)은 2학점', () => {
  const rows = Object.values(COURSES_2026).flat().filter((c) => c && c.courseCode === '101298');
  assert.ok(rows.length > 0);
  for (const c of rows) assert.equal(c.credits, '2');
});

test('결정 2-1 A(#378): 공학3계열 2026 졸업인증제는 공학1·2계열처럼 분류 이름을 포함하는 과목을 인정한다', () => {
  const { evaluateCertifications } = require('../services/graduationService');
  const [eng3] = cert2026('공학3계열');
  assert.deepEqual(eng3.requiredCourses, cert2026('공학1계열')[0].requiredCourses);
  const row = { category: eng3.category, description: eng3.description, min_course_count: eng3.minCourseCount, requiredCourses: eng3.requiredCourses };
  const satisfied = (name) => evaluateCertifications([row], [{ name, letter_grade: 'A' }])[0].satisfied;
  // 예전에는 컴소공·게임콘텐츠 과목명 4개만 인정해, 이름이 조금 다른 세부전공 과목은 미충족이었다
  for (const name of ['캡스톤디자인1', '기업연계프로젝트2(종합설계2)', 'AI융합캡스톤디자인', '소프트웨어종합설계']) assert.equal(satisfied(name), true, name);
  assert.equal(satisfied('프로젝트관리'), false);
});
