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

test('A-4: 개편된 2026 학과·계열의 졸업인증제 그룹이 확정 값이다(디자인융합계열만 학교 확인 안내)', () => {
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
  assert.match(cert2026('디자인융합계열')[0].description, /학교에 확인/);
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
