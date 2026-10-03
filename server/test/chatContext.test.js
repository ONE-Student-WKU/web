const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const curriculumService = require('../services/curriculumService');
const { resolveYearContext } = require('../services/yearContext');
const { assembleStructuredChunks, mergeChunks } = require('../services/chatContextService');

/**
 * server/test/chatContext.test.js
 * 챗봇이 학번/질문별로 "어떤 데이터를 어느 해 기준으로" 근거에 넣는지 검증한다(AI 호출 없이 근거 조립까지).
 * 학번 2018·2020·2021(컴퓨터·소프트웨어공학과), 2024(경영학과), 2026(경영계열) × 졸업요건·연도 지정·연도 비교·변경 이력 질문.
 * 전제: 시드 + seed:lineage + generate:curriculum-changes (curriculumHistoryService.test.js와 같음).
 */

const BOOKS = [2024, 2025, 2026];
const D = {};
let renamedCourse; // 2024→2025에 필수→선택으로 바뀐 과목
let removedCourse; // 2024까지 있고 2025부터 없는 과목

before(async () => {
  const [depts] = await pool.query('SELECT id, name FROM departments');
  for (const d of depts) D[d.name] = d.id;
  for (const n of ['컴퓨터·소프트웨어공학과', '경영학과', '경영계열']) assert.ok(D[n], `${n} 시드 필요`);

  // 이름이 길고 한 학과에만 있는, 이름 변경 없이 구분만 바뀐 과목을 찾는다(이름 변경이면 이력 해석이 달라짐).
  const [cat] = await pool.query(
    `SELECT c.display_name, c.department_id, c.subject_key FROM curriculum_changes c
     WHERE c.subject_type = 'COURSE' AND c.field = 'category' AND c.old_value = '전공필수' AND c.new_value = '전공선택'
       AND c.to_year = 2025 AND c.successor_department_id IS NULL AND CHAR_LENGTH(c.display_name) >= 5
       AND NOT EXISTS (SELECT 1 FROM curriculum_changes x WHERE x.subject_key = c.subject_key AND x.to_year = 2025 AND x.field IN ('course_name', 'course_code'))
       AND (SELECT COUNT(DISTINCT department_id) FROM curriculum_courses WHERE course_name = c.display_name) = 1
     LIMIT 1`
  );
  renamedCourse = cat[0];
  const [rem] = await pool.query(
    `SELECT c.display_name, c.department_id, c.subject_key, c.from_year FROM curriculum_changes c
     WHERE c.subject_type = 'COURSE' AND c.change_type = 'REMOVED' AND c.to_year = 2025 AND c.successor_department_id IS NULL
       AND CHAR_LENGTH(c.display_name) >= 5
       AND (SELECT COUNT(DISTINCT department_id) FROM curriculum_courses WHERE course_name = c.display_name) = 1
     LIMIT 1`
  );
  removedCourse = rem[0];
  assert.ok(renamedCourse && removedCourse, 'generate:curriculum-changes를 먼저 실행하세요');
});

after(async () => {
  await pool.end();
});

async function ask(student, message, previousUserMessage = null) {
  const yearContext = resolveYearContext({
    message, previousUserMessage, profileCohort: student.admission_year, availableBookYears: BOOKS,
  });
  const structured = await assembleStructuredChunks({ message, searchText: message, student, previousUserMessage, yearContext });
  return { yearContext, structured };
}

const yearsInTitles = (chunks) => chunks.map((c) => Number((c.documentTitle.match(/(\d{4})학번/) || [])[1]));

const STUDENTS = () => [
  ['컴소공 2018학번', { department_id: D['컴퓨터·소프트웨어공학과'], admission_year: 2018 }, 2018, 136],
  ['컴소공 2020학번', { department_id: D['컴퓨터·소프트웨어공학과'], admission_year: 2020 }, 2020, 136],
  ['컴소공 2021학번', { department_id: D['컴퓨터·소프트웨어공학과'], admission_year: 2021 }, 2021, 136],
  ['경영학과 2024학번', { department_id: D['경영학과'], admission_year: 2024 }, 2024, 130],
  ['경영계열 2026학번', { department_id: D['경영계열'], admission_year: 2026 }, 2026, 130],
];

test('"내 졸업요건이 뭐야?": 학생 학번 한 해의 요건만, 학번이 제목에 명시된다', async () => {
  for (const [label, student, cohort, total] of STUDENTS()) {
    const { yearContext, structured } = await ask(student, '내 졸업요건이 뭐야?');
    assert.equal(yearContext.mode, 'COHORT', label);
    assert.equal(structured.graduation.length, 1, label);
    assert.deepEqual(yearsInTitles(structured.graduation), [cohort], `${label}: 다른 해 요건이 섞임`);
    assert.match(structured.graduation[0].content, new RegExp(`졸업학점 합계\\(교양\\+전공\\+일반선택\\): ${total}학점`), label);
    assert.equal(structured.history.length, 0, `${label}: 이력 질문이 아닌데 이력이 들어감`);
  }
});

test('"2024학년도 졸업요건이 뭐야?": 학생 학번과 상관없이 2024학번 기준 한 해만', async () => {
  for (const [label, student] of STUDENTS()) {
    const { yearContext, structured } = await ask(student, '2024학년도 졸업요건이 뭐야?');
    assert.equal(yearContext.mode, 'SPECIFIC_YEAR', label);
    assert.deepEqual(yearsInTitles(structured.graduation), [2024], label);
    assert.ok(!structured.graduation[0].content.includes('자료 없음'), `${label}: 2024 자료가 있어야 함`);
  }
});

test('"2020학년도와 2026학년도의 졸업요건 차이는?": 두 해를 각각 조회하고 그 외 해는 섞이지 않는다', async () => {
  for (const [label, student] of STUDENTS()) {
    const { yearContext, structured } = await ask(student, '2020학년도와 2026학년도의 졸업요건 차이는 뭐야?');
    assert.equal(yearContext.mode, 'COMPARE', label);
    assert.deepEqual(yearsInTitles(structured.graduation), [2020, 2026], label);
  }
  // 컴소공: 2020은 136학점(컴소공), 2026은 개편된 공학3계열 130학점 — 개편 관계를 건너 찾는다
  const cse = STUDENTS()[0][1];
  const { structured } = await ask(cse, '2020학년도와 2026학년도의 졸업요건 차이는 뭐야?');
  assert.match(structured.graduation[0].content, /136학점/);
  assert.match(structured.graduation[1].documentTitle, /공학3계열 2026학번/);
  assert.match(structured.graduation[1].content, /130학점/);
  // 경영학과: 2020 자료는 시스템에 없다 → 다른 해로 추정하지 않고 "자료 없음"
  const biz = STUDENTS()[3][1];
  const bizAnswer = await ask(biz, '2020학년도와 2026학년도의 졸업요건 차이는 뭐야?');
  assert.match(bizAnswer.structured.graduation[0].documentTitle, /자료 없음/);
  assert.match(bizAnswer.structured.graduation[0].content, /입력된 학번 범위는 2024~2026학번/);
  assert.match(bizAnswer.structured.graduation[1].content, /130학점/);
  assert.match(bizAnswer.structured.graduation[1].content, /\[2026학번 적용 요건/);
});

test('변경 이력 "졸업학점이 언제 바뀌었어?": 학생 적용 규정과 이후 변경이 분리돼 나온다', async () => {
  const cse2018 = STUDENTS()[0][1];
  const { yearContext, structured } = await ask(cse2018, '졸업학점이 언제 바뀌었어?');
  assert.equal(yearContext.mode, 'HISTORY');
  const rule = structured.history.find((c) => c.chunkId.startsWith('history-rule-') && /졸업학점 총계/.test(c.documentTitle));
  assert.ok(rule);
  assert.match(rule.content, /2018학번에 적용되는 졸업학점 총계: 136학점/);
  assert.match(rule.content, /이 학번에는 적용되지 않는다/);
  assert.match(rule.content, /2026학번부터 136학점 → 130학점/);
  assert.ok(structured.history.some((c) => c.chunkId.startsWith('history-dept-')), '학과 개편 이력도 같이');
});

test('"이 과목은 언제 필수에서 선택으로 바뀌었어?": 과목 이력에 변경 시점이 있다', async () => {
  const student = { department_id: renamedCourse.department_id, admission_year: 2024 };
  const { structured } = await ask(student, `${renamedCourse.display_name}은(는) 언제 필수에서 선택으로 바뀌었어?`);
  const chunk = structured.history.find((c) => c.documentTitle.startsWith(renamedCourse.display_name));
  assert.ok(chunk, '과목 이력 청크가 있어야 함');
  assert.match(chunk.content, /\[category\] 2025학번부터 전공필수 → 전공선택 \(변경 전 마지막 학번 2024\)/);
  assert.match(chunk.content, /2024학번에 적용되는 편성: 전공필수/);
  assert.match(chunk.content, /변경 이유는 이 자료에 기록되어 있지 않다/);
});

test('"이 과목은 언제 없어졌어?": 마지막으로 있던 학번과 폐지 단정 금지 문구', async () => {
  const student = { department_id: removedCourse.department_id, admission_year: 2024 };
  const { structured } = await ask(student, `${removedCourse.display_name} 언제 없어졌어?`);
  const chunk = structured.history.find((c) => c.documentTitle.startsWith(removedCourse.display_name));
  assert.ok(chunk);
  assert.match(chunk.content, new RegExp(`${removedCourse.from_year}학번 자료까지 편성되어 있고 그 이후 학번 자료에는 없다`));
  assert.match(chunk.content, /단정하지 말 것/);
});

test('"예전에는 필수였는데 왜 지금은 선택이야?": 직전 질문의 과목을 이어받아 과거·현재 비교 근거를 만든다', async () => {
  const student = { department_id: renamedCourse.department_id, admission_year: 2025 };
  const previous = `${renamedCourse.display_name}은(는) 필수 과목이야?`;
  const { yearContext, structured } = await ask(student, '예전에는 필수였는데 왜 지금은 선택이야?', previous);
  assert.equal(yearContext.mode, 'HISTORY');
  const chunk = structured.history.find((c) => c.documentTitle.startsWith(renamedCourse.display_name));
  assert.ok(chunk, '직전 질문의 과목 이력이 있어야 함');
  assert.match(chunk.content, /2024학번 [^\n]*: 전공필수/);
  assert.match(chunk.content, /2025학번 [^\n]*: 전공선택/);
  assert.match(chunk.content, /변경 이유는 이 자료에 기록되어 있지 않다/);
});

test('같은 과목이 여러 해에 있을 때: 연도를 모르면 최신 한 해, 비교 질문이면 해마다 별도 청크(연도가 합쳐져 사라지지 않음)', async () => {
  const student = { department_id: D['경영학과'], admission_year: null };
  const course = '상업논리및논술';

  const unknownYear = await curriculumService.lookupFromMessage(
    `${course} 알려줘`, student, resolveYearContext({ message: `${course} 알려줘`, availableBookYears: BOOKS })
  );
  assert.equal(unknownYear.length, 1);
  assert.match(unknownYear[0].documentTitle, /\[2025~2025학번\]/, '연도를 모르면 가장 최신 버전만');

  const message = `2024학년도와 2025학년도 ${course} 차이`;
  const compared = await curriculumService.lookupFromMessage(message, student, resolveYearContext({ message, availableBookYears: BOOKS }));
  assert.equal(compared.length, 2);
  assert.equal(new Set(compared.map((c) => c.chunkId)).size, 2, 'chunkId에 학번 범위가 들어가 구분됨');
  assert.deepEqual(compared.map((c) => c.documentTitle.match(/\[(\d{4})~/)[1]).sort(), ['2024', '2025']);
});

test('연도가 나와도 졸업요건 질문에는 그 해 개설과목 목록을 붙이지 않는다(개설 질문일 때만)', async () => {
  // course_offerings(실개설 이력)는 컴퓨터·소프트웨어공학과만 시딩돼 있다.
  const student = { department_id: D['컴퓨터·소프트웨어공학과'], admission_year: 2024 };
  const req = await ask(student, '2024학년도 졸업요건이 뭐야?');
  assert.equal(req.structured.offering.length, 0);
  const off = await ask(student, '2024년 1학기에 개설된 과목 알려줘');
  assert.ok(off.structured.offering.length > 0);
  assert.ok(off.structured.offering.every((c) => /2024학년도/.test(c.documentTitle)));
});

test('mergeChunks: 직전 turn의 다른 해 책자 청크는 이번 질문의 학년도와 섞이지 않는다', async () => {
  const student = STUDENTS()[3][1];
  const { yearContext, structured } = await ask(student, '2026학년도 졸업요건이 뭐야?');
  const merged = mergeChunks({
    structured,
    previousCitedChunks: [
      { chunkId: 1, bookYear: 2025, documentTitle: '2025 해설', content: 'x' },
      { chunkId: 2, bookYear: 2026, documentTitle: '2026 해설', content: 'x' },
      { chunkId: 3, bookYear: null, documentTitle: '학칙', content: 'x' },
    ],
    freshChunks: [],
    yearContext,
  });
  assert.deepEqual(merged.filter((c) => typeof c.chunkId === 'number').map((c) => c.chunkId), [2, 3]);
});
