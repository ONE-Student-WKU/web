const test = require('node:test');
const assert = require('node:assert/strict');
const { regularSemesterToOfferingCode, offeringCodeToRegularSemester, offeringCodeLabel } = require('../services/termCode');
const { extractSemester, formatOfferingChunk } = require('../services/curriculumService');

// DB 없이 도는 순수 함수 테스트 — course_offerings.semester는 1=1학기, 2=여름, 3=2학기, 4=겨울이다.

test('정규 학기 ↔ 개설 이력 코드 변환: 2학기는 3이다', () => {
  assert.equal(regularSemesterToOfferingCode(1), 1);
  assert.equal(regularSemesterToOfferingCode(2), 3);
  assert.equal(regularSemesterToOfferingCode(3), null);
  assert.equal(offeringCodeToRegularSemester(1), 1);
  assert.equal(offeringCodeToRegularSemester(3), 2);
  assert.equal(offeringCodeToRegularSemester(2), null);
  assert.equal(offeringCodeToRegularSemester(4), null);
});

test('개설 학기 코드의 표시 이름', () => {
  assert.equal(offeringCodeLabel(1), '1학기');
  assert.equal(offeringCodeLabel(2), '여름 계절학기');
  assert.equal(offeringCodeLabel(3), '2학기');
  assert.equal(offeringCodeLabel(4), '겨울 계절학기');
});

test('extractSemester: 질문의 "2학기"는 개설 이력의 코드 3으로 바뀐다', () => {
  assert.equal(extractSemester('2026학년도 1학기에 개설된 과목'), 1);
  assert.equal(extractSemester('2026학년도 2학기에 개설된 과목'), 3);
  assert.equal(extractSemester('2026학년도 학기: 2 개설 과목'), 3);
});

test('extractSemester: 계절학기는 코드 2·4, 학기 언급이 없거나 1·2가 아니면 null', () => {
  assert.equal(extractSemester('2026학년도 여름 계절학기 개설 과목'), 2);
  assert.equal(extractSemester('2025학년도 겨울학기에 뭐 열려?'), 4);
  assert.equal(extractSemester('2026학년도 개설 현황'), null);
  assert.equal(extractSemester('3학기에 뭐 들어?'), null);
});

test('formatOfferingChunk: 2학기 개설 데이터(코드 3)가 "3학기"로 보이지 않는다', () => {
  const chunk = formatOfferingChunk({
    departmentName: '컴퓨터·소프트웨어공학과',
    trackName: null,
    year: 2026,
    semester: 3,
    grade: 4,
    categories: new Map([['전공선택', new Set(['인공지능(3학점)'])]]),
  });
  assert.match(chunk.documentTitle, /2026학년도 2학기 4학년/);
  assert.doesNotMatch(chunk.documentTitle, /3학기/);
  assert.match(chunk.content, /2026년 2학기에 실제 개설된 과목 목록\(4학년\)/);
  // 같은 학기의 서로 다른 학년·학기 청크가 합쳐지지 않도록 chunkId는 DB 코드를 그대로 유지한다.
  assert.match(chunk.chunkId, /-2026-3-4$/);
});
