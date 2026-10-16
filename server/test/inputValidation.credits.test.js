const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isValidCredits } = require('../services/inputValidation');

/**
 * server/test/inputValidation.credits.test.js
 * 과목 학점 검사 — 0~9.5, 0.5 단위. 운영 점검(2026-10-17)에서 API로 2.3학점이 저장되는 걸 확인해 막았다.
 */

test('0.5 단위 학점은 받는다(0은 졸업논문 등 P/F)', () => {
  for (const v of [0, 0.5, 1, 1.5, 2, 3, 9.5, '3', '1.5']) {
    assert.equal(isValidCredits(v), true, String(v));
  }
});

test('0.5 단위가 아니거나 범위 밖이면 거절한다', () => {
  for (const v of [2.3, 0.1, -1, -0.5, 10, 9.9, 99, 'abc', '', ' ', NaN, Infinity]) {
    assert.equal(isValidCredits(v), false, String(v));
  }
});

test('숫자·문자열이 아닌 값(SQL 조각으로 펼쳐질 수 있는 객체·배열 등)은 거절한다', () => {
  for (const v of [null, undefined, true, [3], { credits: 3 }]) {
    assert.equal(isValidCredits(v), false, JSON.stringify(v));
  }
});
