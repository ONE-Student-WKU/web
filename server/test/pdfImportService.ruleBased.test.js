const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseFullTranscriptTextRuleBased,
  looksLikeFullTranscriptText,
  redactStudentIdentifiers,
} = require('../services/pdfImportService');
const {
  SEMESTERS,
  EXPECTED_ROW_COUNT,
  EXPECTED_TOTAL_CREDITS,
  FAKE_STUDENT_ID,
  FAKE_STUDENT_NAME,
  buildTableText,
  buildFullPageText,
} = require('../test-helpers/fullTranscriptFixture');

/**
 * server/test/pdfImportService.ruleBased.test.js
 * 붙여넣기 텍스트의 규칙 기반 파서(Claude 호출 없음)와 학번/이름 가리기 검증. DB·AI 없이 도는
 * 순수 함수 테스트다. 규칙 기반 파서는 "확실할 때만 결과를 내고, 아니면 null(→ AI 폴백)"이
 * 원칙이라, 성공 케이스와 함께 "반드시 null이어야 하는" 케이스도 같이 고정한다.
 */

function assertParsedFixture(result) {
  assert.ok(result, '규칙 기반 파싱이 null을 반환함');
  assert.equal(result.rows.length, EXPECTED_ROW_COUNT);
  assert.equal(result.extractedTotalCredits, EXPECTED_TOTAL_CREDITS);
  assert.deepEqual(result.warnings, []);
}

test('탭 구분 붙여넣기를 규칙 기반으로 파싱한다', () => {
  assertParsedFixture(parseFullTranscriptTextRuleBased(buildTableText()));
});

test('탭이 줄바꿈으로 바뀐 붙여넣기도 같은 결과를 낸다', () => {
  assertParsedFixture(parseFullTranscriptTextRuleBased(buildTableText().replace(/\t/g, '\n')));
});

test('페이지 전체(학생정보·버튼 텍스트 포함)를 붙여넣어도 표만 파싱한다', () => {
  assertParsedFixture(parseFullTranscriptTextRuleBased(buildFullPageText()));
});

test('P/NP/F 등급: P는 이수, F·NP는 불합격으로 처리하고 학기 소계와 맞는다', () => {
  const { rows } = parseFullTranscriptTextRuleBased(buildTableText());
  const byGrade = (g) => rows.find((r) => r.letterGrade === g);
  assert.equal(byGrade('P').isFail, false);
  assert.equal(byGrade('P').credits, 1);
  assert.equal(byGrade('F').isFail, true);
  assert.equal(byGrade('NP').isFail, true);
});

// 실제 화면은 P 과목의 평점을 빈칸이 아니라 "0.0"으로 채운다(실사용 샘플 확인) — 그래도 만약
// 빈칸으로 오면 행을 밀어 잘못 읽지 말고 null(→ AI 폴백)이어야 한다.
test('평점 칸이 빈 행은 추측하지 않고 null을 반환한다', () => {
  const text = buildTableText().replace('1.0\t0.0\tP', '1.0\t\tP');
  assert.equal(parseFullTranscriptTextRuleBased(text), null);
});

test('소계 숫자가 줄바꿈으로 갈려도 소계 대조가 동작해 누락된 행을 잡는다', () => {
  const withMissingRow = SEMESTERS.map((s, i) => (i === 0 ? { ...s, rows: s.rows.slice(1) } : s));
  const text = buildTableText(withMissingRow).replace(/(\d+\.\d+)\t(\d+\.\d+)/g, '$1\n$2');
  assert.equal(parseFullTranscriptTextRuleBased(text), null);
});

test('정수로 찍힌 소계가 줄바꿈으로 갈려도 소계 대조가 동작한다', () => {
  const withMissingRow = SEMESTERS.map((s, i) => (i === 0 ? { ...s, rows: s.rows.slice(1), subtotal: ['9', '3.93'] } : s));
  const text = buildTableText(withMissingRow).replace('9\t3.93', '9\n3.93');
  assert.equal(parseFullTranscriptTextRuleBased(text), null);
});

// F/NP 모양이 특히 위험하다 — 불합격 행은 소계 합계에서 빠지므로 소계 대조로는 못 걸러지고
// 허위 행이 결과에 그대로 섞인다. 합격 등급 모양은 소계를 어긋나게 해 불필요한 AI 폴백을 낸다.
test('마지막 소계 뒤 표 밖 텍스트가 과목 행 모양이어도(합격·F·NP 등급 모두) 과목으로 넣지 않는다', () => {
  for (const [avg, grade] of [['4.5', 'A+'], ['0.0', 'F'], ['0.0', 'NP']]) {
    const text = `${buildTableText()}\n교선\t000000\t안내문구\t3.0\t${avg}\t${grade}`;
    assertParsedFixture(parseFullTranscriptTextRuleBased(text));
  }
});

test('표 구간 안의 낯선 토큰은 신뢰하지 않고 null을 반환한다', () => {
  const text = buildTableText().replace('가상전공과목A\t3.0', '가상전공과목A\t알수없음\t3.0');
  assert.equal(parseFullTranscriptTextRuleBased(text), null);
});

test('학기 헤더 유무로 전체성적조회 붙여넣기 여부를 판별한다', () => {
  assert.equal(looksLikeFullTranscriptText(buildTableText()), true);
  assert.equal(looksLikeFullTranscriptText('교필\t기초과목\t2024/1\t3.0\n성적취득학점 3.0'), false);
});

test('학번과 이름을 라벨 모양·구분자와 무관하게 가린다', () => {
  const cases = [
    `학 번\t${FAKE_STUDENT_ID}\t성 명\t${FAKE_STUDENT_NAME}`,
    `성명\t${FAKE_STUDENT_NAME}`,
    `성명\n${FAKE_STUDENT_NAME}`,
    `성명 : ${FAKE_STUDENT_NAME}`,
    `성 명\n\t${FAKE_STUDENT_NAME}\n화면 출력`,
    `이름：${FAKE_STUDENT_NAME}`,
  ];
  for (const input of cases) {
    const out = redactStudentIdentifiers(input);
    assert.ok(!out.includes(FAKE_STUDENT_NAME), `이름이 남음: ${JSON.stringify(out)}`);
    assert.ok(!out.includes(FAKE_STUDENT_ID), `학번이 남음: ${JSON.stringify(out)}`);
  }

  const longName = redactStudentIdentifiers('성명\t남궁가나다라');
  assert.ok(!/[가-힣]/.test(longName.replace('성명', '')), `긴 이름 일부가 남음: ${longName}`);
});

test('가리기는 학수번호·과목 행은 건드리지 않는다', () => {
  const row = '기전\t900001\t가상전공과목A\t3.0\t3.5\tB+\n교선\tL09001\t가상Java실습\t2.0\t4.5\tA+';
  assert.equal(redactStudentIdentifiers(row), row);
});
