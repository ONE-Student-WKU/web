const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeExcerpt, citationExcerpt, MAX_CHARS } = require('../services/citationExcerpt');

/**
 * server/test/citationExcerpt.test.js
 * 챗봇 근거 발췌문: 줄 단위로 잘라 마크다운(제목·표)을 화면이 그릴 수 있게 남기고, 앞머리(책자 학년도·출처 URL)는 뺀다(2026-10-16 운영 점검).
 */

test('책자 학년도 앞머리와 출처 줄을 빼고, 제목은 마크다운 그대로 둔다', () => {
  assert.equal(
    makeExcerpt('[2019학년도 교육과정 책자] ### 교육과정 편성\r\n가. 교육과정은 학칙 제31조에 의하여 편성한다.'),
    '### 교육과정 편성\n가. 교육과정은 학칙 제31조에 의하여 편성한다.'
  );
  assert.equal(makeExcerpt('# 전과\r\n\r\n출처: https://www.wku.ac.kr/x\r\n\r\n## 관련규정\r\n학칙 제42조'), '# 전과\n\n## 관련규정\n학칙 제42조');
  assert.equal(makeExcerpt('#### 세부 항목\n내용'), '### 세부 항목\n내용');
});

test('표는 머리 줄·구분선을 남기고 앞 3행까지만 넣는다', () => {
  const table = ['### 개설 과목', '| 학수번호 | 교과목 |', '|---|---|', '| L1 | 가 |', '| L2 | 나 |', '| L3 | 다 |', '| L4 | 라 |'].join('\n');
  assert.equal(makeExcerpt(table), ['### 개설 과목', '| 학수번호 | 교과목 |', '|---|---|', '| L1 | 가 |', '| L2 | 나 |', '| L3 | 다 |', '…'].join('\n'));
});

test('긴 글은 줄을 잘라 "…"를 붙이고, 자리가 모자라면 표를 시작하지 않는다', () => {
  const long = '가'.repeat(MAX_CHARS + 50);
  assert.equal(makeExcerpt(long), `${'가'.repeat(MAX_CHARS)}…`);
  const fill = '나'.repeat(MAX_CHARS);
  assert.equal(makeExcerpt(`${fill}\n| a | b |\n|---|---|\n| 1 | 2 |`), `${fill}\n…`);
});

test('발췌문은 문서·조문 원문에만 붙이고, 서버가 계산한 근거(지시문이 섞인 규정 판단 등)는 제목만 보이게 null', () => {
  assert.equal(citationExcerpt({ chunkId: 12, content: '### 2. 주의사항' }), '### 2. 주의사항');
  assert.equal(citationExcerpt({ chunkId: 'regulation-article-ACAD_RULE:111', content: '제111조(전과(부)의 제한)' }), '제111조(전과(부)의 제한)');
  assert.equal(citationExcerpt({ chunkId: 'regulation-judgment-2-2026-GENERAL-2026-10-16', content: '답변 지침: 단정하지 마라' }), null);
  assert.equal(citationExcerpt({ chunkId: 'graduation-2-2026', content: '단정하지 말고' }), null);
});

test('짧은 조각은 그대로 둔다', () => {
  assert.equal(makeExcerpt('제111조(전과(부)의 제한)\r\n  1. 특별전형'), '제111조(전과(부)의 제한)\n  1. 특별전형');
  assert.equal(makeExcerpt(''), '');
});
