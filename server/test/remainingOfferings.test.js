const test = require('node:test');
const assert = require('node:assert/strict');
const { isCompleted, buildCompletedNameSet, normalizeCourseName, courseNameVariants } = require('../services/courseNameMatch');
const { buildRemainingOfferingChunks } = require('../services/curriculumService');
const { mergeChunks } = require('../services/chatContextService');

// DB 없이 도는 순수 함수 테스트. course_offerings.semester는 1=1학기, 3=2학기(termCode.js).

const row = (course_name, category, grade, semester = 1, credits = 3) => ({
  department_name: '컴퓨터·소프트웨어공학과', track_name: null, year: 2026, semester, grade, category, course_name, credits,
});

test('과목명 비교: 구두점·공백 차이와 끝 괄호 병기·알려진 약칭을 같은 과목으로 본다', () => {
  const done = buildCompletedNameSet(['졸업(시험.작품)논문', '기업연계프로젝트2', '기연프1', '자료 구조']);
  assert.ok(isCompleted('졸업(시험·작품)논문', done)); // 가운뎃점 ↔ 마침표
  assert.ok(isCompleted('기업연계프로젝트2(종합설계2)', done)); // 끝 괄호 병기를 뗀 이름
  assert.ok(isCompleted('기업연계프로젝트1(종합설계1)', done)); // 약칭 화이트리스트
  assert.ok(isCompleted('자료구조', done)); // 공백
});

test('과목명 비교: 번호가 다른 과목이나 비슷한 이름의 다른 과목은 같은 과목이 아니다', () => {
  const done = buildCompletedNameSet(['기업연계프로젝트2', '대학생활']);
  assert.ok(!isCompleted('기업연계프로젝트1(종합설계1)', done));
  assert.ok(!isCompleted('대학생활과자기혁신', done)); // 부분 문자열 일치는 인정하지 않는다
  assert.equal(normalizeCourseName('졸업(시험·작품)논문'), '졸업(시험작품)논문');
  assert.deepEqual(courseNameVariants('기업연계프로젝트2(종합설계2)').sort(), ['기업연계프로젝트2', '기업연계프로젝트2(종합설계2)', '기연프2'].sort());
});

test('개설 − 이수: 이수한 과목은 빠지고 학기별로 청크가 나뉘며 학년은 거르지 않고 표시만 한다', () => {
  const rows = [
    row('인공지능', '전공선택', 3, 1),
    row('운영체제', '전공필수', 3, 1),
    row('캡스톤디자인', '전공선택', 4, 1), // 상위 학년 과목도 후보
    row('데이터통신', '전공선택', 3, 3),
    row('운영체제', '전공필수', 3, 3), // 같은 과목이 2학기에도 개설
  ];
  const chunks = buildRemainingOfferingChunks(rows, buildCompletedNameSet(['운영체제', '자료구조']), 2);
  assert.equal(chunks.length, 2);

  const [first, second] = chunks;
  assert.match(first.documentTitle, /2026학년도 1학기 개설과목 중 아직 이수하지 않은 과목/);
  assert.match(first.content, /인공지능\(3학점, 3학년\)/);
  assert.match(first.content, /캡스톤디자인\(3학점, 4학년\)/);
  assert.doesNotMatch(first.content, /운영체제/);
  assert.match(first.content, /이수 기록 2개를 뺀 목록, 이미 이수한 개설 과목 1개 제외/);

  assert.match(second.documentTitle, /2026학년도 2학기/); // DB 코드 3이 "3학기"로 보이면 안 된다
  assert.doesNotMatch(second.documentTitle, /3학기/);
  assert.match(second.content, /데이터통신/);
  assert.notEqual(first.chunkId, second.chunkId);
});

test('개설 − 이수: 한 학기의 개설 과목을 전부 이수했으면 그 학기 청크는 만들지 않는다', () => {
  const rows = [row('운영체제', '전공필수', 3, 1), row('인공지능', '전공선택', 3, 3)];
  const chunks = buildRemainingOfferingChunks(rows, buildCompletedNameSet(['운영체제']), 1);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0].documentTitle, /2학기/);
});

test('mergeChunks: remaining이 없는 호출도 동작하고, 있으면 개설 청크보다 앞에 온다', () => {
  const base = { regulation: [], graduation: [], history: [], curriculum: [], requirement: [], linkedMajor: [], microDegree: [] };
  const offering = [{ chunkId: 'offering-1', documentTitle: 'o', content: 'o' }];
  const remaining = [{ chunkId: 'remaining-1', documentTitle: 'r', content: 'r' }];
  const yc = { bookYears: [] };

  assert.deepEqual(mergeChunks({ structured: { ...base, offering }, yearContext: yc }).map((c) => c.chunkId), ['offering-1']);
  assert.deepEqual(mergeChunks({ structured: { ...base, offering, remaining }, yearContext: yc }).map((c) => c.chunkId), ['remaining-1', 'offering-1']);
});
