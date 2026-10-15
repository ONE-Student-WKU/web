const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { resolveYearContext } = require('../services/yearContext');
const { assembleStructuredChunks } = require('../services/chatContextService');
const { requirementChangeCaveat, unverifiedYearsIn } = require('../services/curriculumContextService');

/**
 * server/test/chatHistoryChunk.test.js
 * 챗봇 변경 이력 청크가 데이터 검수 등급·판단 보류를 반영하는지(FINAL_REVIEW F-5·B-12, 보정 라운드 A 2-3, DECISIONS D-36).
 * 앞쪽은 순수(가짜 등급표 주입), 뒤쪽은 로컬 시드 DB. AI 호출 없음.
 */

const D = {};
before(async () => {
  const [depts] = await pool.query('SELECT id, name FROM departments');
  for (const d of depts) D[d.name] = d.id;
});
after(async () => { await pool.end(); });

// 가짜 등급표: 2019=C(검증 안 됨), 2020=B, 나머지 A. 판단 보류는 (2021, '보류학과')만.
const fakeDq = {
  dataGrade: (area, year) => ({ area, grade: year === 2019 ? 'C' : year === 2020 ? 'B' : 'A' }),
  pendingHoldsFor: (year, name) => (year === 2021 && name === '보류학과' ? [{ id: 'X', note: '테스트 보류 사유' }] : []),
};

test('requirementChangeCaveat: 판단 보류와 겹치면 "확인 필요 + 실제 개정이 아닐 수 있다", C등급은 "검증되지 않았다", B등급은 "부분 검증"', () => {
  assert.equal(requirementChangeCaveat({ fromYear: 2022, toYear: 2023 }, '보통학과', fakeDq), '');
  const hold = requirementChangeCaveat({ fromYear: 2020, toYear: 2021 }, '보류학과', fakeDq);
  assert.match(hold, /⚠ 확인 필요 — 이 변경에 걸린 학번의 자료가 판단 보류 항목이다\(테스트 보류 사유\)\. 실제 개정이 아니라 자료 보정 때문에 생긴 변경일 수 있다/);
  assert.match(requirementChangeCaveat({ fromYear: 2018, toYear: 2019 }, '보통학과', fakeDq), /요건 자료는 검증되지 않았다/);
  assert.match(requirementChangeCaveat({ fromYear: 2020, toYear: 2021 }, '보통학과', fakeDq), /부분 검증\(B등급\)/);
});

test('unverifiedYearsIn: 비교한 해(앞해·그 해) 중 C나 자료 없음이 낀 학년도만', () => {
  assert.deepEqual(unverifiedYearsIn('REQUIREMENTS', 2018, 2022, '보통학과', fakeDq), [2019, 2020], '2019(C) 자체와 그 다음 해(앞해가 C)');
  assert.deepEqual(unverifiedYearsIn('REQUIREMENTS', 2021, 2022, '보통학과', fakeDq), []);
  assert.deepEqual(unverifiedYearsIn('REQUIREMENTS', 2025, 2024, '보통학과', fakeDq), [], '빈 구간');
  // 실제 등급표: 전공과목은 2017·2018·2020이 C
  assert.deepEqual(unverifiedYearsIn('MAJOR_COURSES', 2018, 2022, '간호학과'), [2018, 2019, 2020, 2021]);
});

const BOOKS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
async function history(dept, year, message) {
  const student = { department_id: D[dept], admission_year: year, enrollment_type: 'GENERAL' };
  const yc = resolveYearContext({ message, profileCohort: year, availableBookYears: BOOKS, today: '2026-10-05' });
  const s = await assembleStructuredChunks({ message, searchText: message, student, yearContext: yc });
  return s.history;
}

// 2026-10-12: 2025학번 이하 교양·일반선택은 2026 책자 학번별 표 값으로 정렬됐다(교육혁신과 면담). 사범대 2023·2024는 같은 표(교양 37)라
// 예전 "2024학번부터 39→37" 가짜 변경(N-6)이 사라지고, 2022(39)→2023(37)만 남는다. 보류 단서(⚠)도 더는 붙지 않는다.
test('DB: 국어교육과 2023 "교양 학점이 언제 바뀌었어?" — N-6 가짜 변경(2024 39→37)이 없고, 남은 변경에 보류 단서가 없다', async () => {
  const chunk = (await history('국어교육과', 2023, '교양 학점이 언제 바뀌었어?')).find((c) => /LIBERAL_TOTAL/.test(c.chunkId));
  const lines = chunk.content.split('\n');
  assert.equal(lines.find((l) => l.includes('2024학번부터')), undefined, `2024학번 변경이 남아 있다: ${chunk.content}`);
  assert.match(lines[0], /2023학번에 적용되는 교양 이수학점 합계: 37학점 — 이것이 이 학번의 적용 규정이다\.$/);
  const change = lines.find((l) => l.includes('2023학번부터 39학점 → 37학점'));
  assert.ok(change, `2022(39)→2023(37) 변경이 있어야 한다: ${chunk.content}`);
  assert.doesNotMatch(change, /⚠/);
  // 구간 정리 줄: 모델이 "2022학번까지 39학점"처럼 앞선 변경을 빼먹지 않게 구간을 미리 적어 준다(#378).
  const ranges = lines.find((l) => l.startsWith('학번 구간별'));
  assert.ok(ranges, `구간 정리 줄이 있어야 한다: ${chunk.content}`);
  assert.match(ranges, /2022학번 39학점, 2023학번~ 37학점$/);
  assert.match(ranges, /^학번 구간별 교양 이수학점 합계\(.*\): ~\d{4}학번 \d+학점, /);
});

test('rangesLine: 변경 목록을 학번 구간으로 정리하고, 신설·폐지가 섞이면 단정하지 않는다', () => {
  const { rangesLine } = require('../services/curriculumContextService');
  const C = (fromYear, toYear, oldValue, newValue) => ({ changeType: 'CHANGED', fromYear, toYear, oldValue, newValue });
  assert.equal(rangesLine([C(2022, 2023, 39, 37), C(2019, 2020, 25, 27), C(2021, 2022, 27, 39)]), '~2019학번 25학점, 2020~2021학번 27학점, 2022학번 39학점, 2023학번~ 37학점');
  assert.equal(rangesLine([]), null);
  assert.equal(rangesLine([C(2019, 2020, 25, 27), { changeType: 'ADDED', toYear: 2021 }]), null);
});

test('DB: 옛 보류가 해소된 학번(국어교육과 2024)의 적용 값 줄에는 단서가 없고, 남은 보류(SW융합학과 2021)에는 단서가 붙는다', async () => {
  const edu = (await history('국어교육과', 2024, '교양 학점이 언제 바뀌었어?')).find((c) => /LIBERAL_TOTAL/.test(c.chunkId));
  assert.match(edu.content.split('\n')[0], /2024학번에 적용되는 교양 이수학점 합계: 37학점 — 이것이 이 학번의 적용 규정이다\.$/);
  const sw = (await history('SW융합학과', 2021, '졸업학점이 언제 바뀌었어?')).find((c) => /GRAD_TOTAL/.test(c.chunkId));
  assert.match(sw.content.split('\n')[0], /⚠ 확인 필요 — 이 학번의 자료가 판단 보류 항목이다\(SW융합학과 교양·전공·자유 학점 구조/);
});

test('DB: 판단 보류 없는 학과·학번(간호학과 2023)의 졸업학점 이력에는 단서가 붙지 않고 기존 경과조치 문구를 유지', async () => {
  const chunk = (await history('간호학과', 2023, '졸업학점이 언제 바뀌었어?')).find((c) => /GRAD_TOTAL/.test(c.chunkId));
  assert.doesNotMatch(chunk.content, /⚠/);
  assert.match(chunk.content, /2024학번부터 140학점 → 130학점/);
  assert.match(chunk.content, /경과조치에 따라 달라질 수 있어 단정할 수 없다/);
});

test('DB: 컴소공 2020 교양·일반선택 분할 보류(#260-cse-liberal)는 2026 책자 학번별 표로 해소 — 이력 청크에 보류 단서가 없다(판단 함수와 같은 등급표)', async () => {
  const chunk = (await history('컴퓨터·소프트웨어공학과', 2020, '졸업학점이 언제 바뀌었어?')).find((c) => /GRAD_TOTAL/.test(c.chunkId));
  assert.match(chunk.content.split(String.fromCharCode(10))[0], /2020학번에 적용되는 졸업학점 총계: 136학점 — 이것이 이 학번의 적용 규정이다\.$/);
});

test('DB: 과목 이력 — 검증 안 된 학년도(전공과목 2017·2018·2020 = C)가 낀 구간의 "변경 없음"은 "기록 없음(검증 안 됨)"', async () => {
  const chunks = await history('간호학과', 2018, '교육실습및교육윤리(보건) 언제 바뀌었어?');
  const course = chunks.find((c) => /history-course-/.test(c.chunkId));
  assert.ok(course, '과목 이력 청크');
  assert.match(course.content, /변경 이력: 기록 없음\(검증 안 됨 — .*2018.*학년도 과목 자료가 검증되지 않아 "변경 없음"을 확인할 수 없다\)/);
  assert.doesNotMatch(course.content, /변경 이력: 기록된 변경 없음/);
});
