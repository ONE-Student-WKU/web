const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// pdfImportService는 로드 시점에 aiClient의 export를 쥐고 있으므로 서비스를 require하기 전에 가짜로 바꾼다. 실제 AI는 부르지 않는다.
const aiClient = require('../services/aiClient');

let aiRows;
aiClient.extractCourseListRows = async () => aiRows;
aiClient.extractFullTranscriptRows = async () => aiRows;

const { parseCourseListText, parseFullTranscriptText } = require('../services/pdfImportService');

/**
 * server/test/pdfImportService.counseling.test.js
 * 이수과목확인리스트의 "상담 및 미분류"에 찍히는 상담 기록은 과목이 아니라 가져오기에서 뺀다(DECISIONS D-93).
 * 이름에 "상담"이 든 실제 과목이 같이 빠지면 졸업 진단이 조용히 틀려지므로, 세 조건(상담 이름·0학점·이수구분 없음)을 모두 볼 때만 뺀다.
 */

const row = (over) => ({ rawCategory: null, name: '자기계발심층상담', year: 2025, semester: 1, credits: 0, isFail: false, offeringDepartment: null, ...over });
const names = (result) => result.rows.map((r) => r.name);

beforeEach(() => {
  aiRows = [];
});

test('상담 기록(상담 이름·0학점·이수구분 없음)은 학기마다 있어도 모두 빠지고 "직접 선택" 경고도 없다', async () => {
  aiRows = [row({ semester: 1 }), row({ semester: 3 }), row({ name: 'Hug심층진로상담' }), row({ rawCategory: '선전', name: '데이터베이스', credits: 3 })];
  const result = await parseCourseListText('이수과목확인리스트');
  assert.deepEqual(names(result), ['데이터베이스']);
  assert.deepEqual(result.warnings.filter((w) => w.includes('직접 선택')), []);
});

test('이름에 상담이 든 실제 과목은 이수구분이 있으면 남는다', async () => {
  aiRows = [row({ rawCategory: '일선', name: '진로 및 직업상담', credits: 3 }), row({ rawCategory: '일선', name: '집단상담', credits: 0 })];
  assert.deepEqual(names(await parseCourseListText('이수과목확인리스트')), ['진로 및 직업상담', '집단상담']);
});

test('이수구분이 없어도 학점이 있으면 상담 이름이어도 남아 직접 고르게 한다', async () => {
  aiRows = [row({ name: '아동상담', credits: 3 })];
  const result = await parseCourseListText('이수과목확인리스트');
  assert.deepEqual(names(result), ['아동상담']);
  assert.equal(result.rows[0].category, null);
  assert.ok(result.warnings.some((w) => w.includes('직접 선택')));
});

test('상담이 아닌 미분류 0학점 행은 남아 직접 고르게 한다', async () => {
  aiRows = [row({ name: '현장실습' })];
  assert.deepEqual(names(await parseCourseListText('이수과목확인리스트')), ['현장실습']);
});

test('전체성적조회 경로도 같은 규칙으로 뺀다', async () => {
  aiRows = [row({ letterGrade: 'P' }), row({ rawCategory: '일선', name: '가족상담', credits: 3, letterGrade: 'A+' })];
  assert.deepEqual(names(await parseFullTranscriptText('2025년 1학기')), ['가족상담']);
});
