const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groundRoadmapItems } = require('../services/careerService');

/**
 * server/test/career.roadmapGrounding.test.js
 * AI 로드맵 응답을 교육과정 목록으로 접지하는 순수 함수 검사 — DB·Claude 호출 없음.
 * 실제 구분값(심화·응용 등)이 든 목록에서 모델이 "데이터베이스 (심화, 3학점)"처럼 괄호까지 베껴 쓰면 예전에는 로드맵이 통째로 비었다.
 */

const remaining = [
  { grade: 3, semester: '1', courseName: '운영체제', category: '심화', credits: '3.0' },
  { grade: 3, semester: '2', courseName: '데이터베이스', category: '심화', credits: '3.0' },
  { grade: 4, semester: '1', courseName: '기업연계프로젝트1(종합설계1)', category: '심화', credits: '2.0' },
  { grade: 4, semester: '1,2', courseName: '소프트웨어공학', category: '응용', credits: '3.0' },
];

test('정확히 일치하는 과목만 남기고 학년·학기는 교육과정 원본 값을 쓴다', () => {
  const result = groundRoadmapItems(
    [
      { grade: 1, semester: 1, courseName: '운영체제', reason: '서버 기초' },
      { grade: 3, semester: 2, courseName: '지어낸과목', reason: '없는 과목' },
    ],
    remaining
  );
  assert.deepEqual(result, [{ grade: 3, semester: '1', courseName: '운영체제', reason: '서버 기초' }]);
});

test('과목명 뒤에 목록 모양의 "(구분, N학점)"이 붙어 와도 원본 과목명으로 찾는다', () => {
  const result = groundRoadmapItems(
    [
      { courseName: '데이터베이스 (심화, 3학점)', reason: 'a' },
      { courseName: '소프트웨어공학 (응용, 3.0학점)', reason: 'b' },
    ],
    remaining
  );
  assert.deepEqual(result.map((r) => r.courseName), ['데이터베이스', '소프트웨어공학']);
});

test('이름 안에 원래 괄호가 있는 과목은 그대로 일치한다', () => {
  const result = groundRoadmapItems([{ courseName: '기업연계프로젝트1(종합설계1)', reason: 'c' }], remaining);
  assert.equal(result.length, 1);
  assert.equal(result[0].courseName, '기업연계프로젝트1(종합설계1)');
});

test('같은 과목이 두 번 오면 한 번만 담고, 학년·학기 순으로 정렬한다', () => {
  const result = groundRoadmapItems(
    [
      { courseName: '소프트웨어공학', reason: 'x' },
      { courseName: '데이터베이스', reason: 'y' },
      { courseName: '데이터베이스 (심화, 3학점)', reason: 'z' },
      { courseName: '운영체제', reason: 'w' },
    ],
    remaining
  );
  assert.deepEqual(result.map((r) => r.courseName), ['운영체제', '데이터베이스', '소프트웨어공학']);
});

test('배열이 아니거나 형식이 깨진 항목은 무시하고 reason이 없으면 null이다', () => {
  assert.deepEqual(groundRoadmapItems(null, remaining), []);
  assert.deepEqual(groundRoadmapItems([null, { courseName: 3 }, { courseName: '운영체제' }], remaining), [
    { grade: 3, semester: '1', courseName: '운영체제', reason: null },
  ]);
});
