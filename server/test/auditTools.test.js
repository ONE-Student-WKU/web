const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diff, toTuple } = require('../../scripts/audit/diffPdfVsJson');
const { computeBins, parseRowByBins } = require('../../scripts/audit/auditRequirements');
const { findOutliers, indexRows } = require('../../scripts/audit/crossYearConsistency');
const { analyze } = require('../../scripts/audit/creditAnomalies');
const { yearsIn } = require('../../scripts/audit/auditRagDocs');

/**
 * server/test/auditTools.test.js
 * scripts/audit(교육과정 데이터 검수 도구)의 순수 함수 회귀 테스트 — PDF·DB 없이 가짜 입력으로 돈다.
 * 새 학년도가 들어와 도구를 다시 돌릴 때 대조 로직이 조용히 깨지는 것을 막는다.
 */

const pdfRow = (o) => ({ page: 1, grade: 1, semester: 1, categoryRaw: '전필', courseCode: '100001', courseName: '과목A', credits: '3', ...o });
// diff는 JSON 쪽을 loadJsonRows가 만든 6-튜플(+학과)로 받는다.
const jsonRow = (o) => ({ ...toTuple(pdfRow(o)), department: '가학과' });

test('PDF↔JSON 대조: 일치 / 학점·이름·구분 차이 / 학수번호만 다른 쌍(CODE) / 누락·초과를 분류한다', () => {
  const pdf = [
    pdfRow({}),
    pdfRow({ courseCode: '100002', courseName: '과목B', credits: '2' }),
    pdfRow({ courseCode: '100003', courseName: '과목C' }),
    pdfRow({ courseCode: '100004', courseName: '과목D', categoryRaw: '전선' }),
    pdfRow({ courseCode: '100005', courseName: '과목E' }),
    pdfRow({ courseCode: '999999', courseName: '책자에만' }),
  ];
  const json = [
    jsonRow({}),
    jsonRow({ courseCode: '100002', courseName: '과목B', credits: '3' }),
    jsonRow({ courseCode: '100003', courseName: '과목X' }),
    jsonRow({ courseCode: '100004', courseName: '과목D', categoryRaw: '전필' }),
    jsonRow({ courseCode: '200005', courseName: '과목E' }), // 학수번호만 다름
    jsonRow({ courseCode: '888888', courseName: 'JSON에만' }),
  ];
  const r = diff(pdf, json);
  assert.equal(r.matched, 1);
  const byType = Object.fromEntries(r.findings.map((f) => [f.pdf ? f.pdf.code : f.json.code, f.type]));
  assert.equal(byType['100002'], 'CREDITS');
  assert.equal(byType['100003'], 'NAME');
  assert.equal(byType['100004'], 'CATEGORY');
  assert.equal(byType['100005'], 'CODE');
  assert.equal(byType['999999'], 'PDF_ONLY');
  assert.equal(byType['888888'], 'JSON_ONLY');
});

test('PDF↔JSON 대조: 영문 꼬리가 붙은 이름과 PDF에서 못 읽은 학점은 불일치로 치지 않는다', () => {
  const r = diff(
    [pdfRow({ courseName: '안전및조직관리사례연구CaseStudyofSafety' }), pdfRow({ courseCode: '100002', courseName: '과목B', credits: '' })],
    [jsonRow({ courseName: '안전및조직관리사례연구' }), jsonRow({ courseCode: '100002', courseName: '과목B', credits: '3' })]
  );
  assert.equal(r.findings.length, 0);
  assert.equal(r.matched, 2);
});

test('총괄표 열 해석: 열 기준선으로 읽고, 전공 칸이 비면 null, 책자 행 산술이 안 맞으면 표시한다', () => {
  const tok = (x, s) => ({ x, s });
  const detail = [100, 110, 120, 130, 140, 150, 160, 170].map((x) => tok(x, '2'));
  const full = { page: 1, name: '가학과', tokens: [...detail, tok(300, '30'), tok(320, '15이상'), tok(340, '36'), tok(360, '66'), tok(380, '34'), tok(420, '130')] };
  const noMajor = { page: 1, name: '나학과', tokens: [...detail, tok(300, '30'), tok(420, '130')] };
  const bins = computeBins([full, full, noMajor]);
  const a = parseRowByBins(full, bins);
  assert.deepEqual([a.liberal, a.base, a.minMajor, a.major, a.free, a.total], [30, 15, 36, 66, 34, 130]);
  assert.equal(a.bookInconsistent, false, '30+66+34=130이라 책자 행 산술은 성립');
  const broken = parseRowByBins({ ...full, tokens: full.tokens.map((t) => (t.x === 380 ? tok(380, '32') : t)) }, bins);
  assert.equal(broken.bookInconsistent, true, '30+66+32≠130');
  const b = parseRowByBins(noMajor, bins);
  assert.equal(b.major, null);
  assert.equal(b.total, 130);
  assert.equal(b.partial, true);
});

test('학년도 간 일관성: 앞뒤 해는 같고 그 해만 다른 값을 이상치로 잡는다', () => {
  const mk = (name) => ({ 가학과: [{ grade: '1', semester: '1', categoryRaw: '전필', courseCode: '100001', courseName: name, credits: '3' }] });
  const byYear = { 2019: mk('열전달'), 2020: mk('유한요소해석및실습열전달'), 2021: mk('열전달'), 2022: mk('열전달') };
  const out = findOutliers(indexRows(byYear), [2019, 2020, 2021, 2022], ['name']);
  assert.deepEqual(out.map((o) => [o.year, o.field]), [[2020, 'name']]);
});

test('학점 이상치: P·졸업논문류 0학점·빈 학점·큰 학점을 구분해 센다', () => {
  const r = analyze(2020, {
    가학과: [
      { courseName: '졸업(시험.작품)논문', credits: '0' },
      { courseName: '현장실습', credits: '0' },
      { courseName: '졸업논문', credits: 'P' },
      { courseName: '빈칸', credits: '' },
      { courseName: '장기실습', credits: '18' },
      { courseName: '임상술기', credits: '1.5' },
    ],
  });
  assert.deepEqual([r.zeroKnown, r.zero.length, r.pf, r.blank.length, r.odd.length], [1, 1, 1, 1, 1]);
});

test('RAG 문서 연도 추출', () => {
  assert.deepEqual(yearsIn('2023학년도 책자, 2024학번, 2025년도'), [2023, 2024, 2025]);
});
