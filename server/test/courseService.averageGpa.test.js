const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const { averageGpa } = require('../services/courseService');

/**
 * server/test/courseService.averageGpa.test.js
 * 과목 관리 요약의 평균 평점 — 평점이 있는 과목이 없으면 0이 아니라 null이어야 화면이 "-"로 보여 준다
 * (성적 미입력 학기가 "평균 0"으로 보이던 문제). 전부 F인 학기는 진짜 0.0이라 0으로 남아야 한다.
 */

after(async () => {
  await pool.end();
});

test('평점이 있는 과목이 없으면(성적 미입력·P/F만) null', () => {
  assert.equal(averageGpa(0, 0), null);
});

test('전부 F(평점 0.0)면 0 — 미입력과 구분된다', () => {
  assert.equal(averageGpa(0, 6), 0);
});

test('학점 가중 평균을 소수 둘째 자리까지', () => {
  // A+ 3학점(4.5) + B0 2학점(3.0) → (13.5 + 6) / 5 = 3.9
  assert.equal(averageGpa(13.5 + 6, 5), 3.9);
  // 4.5 * 3 + 4.0 * 3 + 3.5 * 1 = 29 / 7 = 4.142857…
  assert.equal(averageGpa(29, 7), 4.14);
});
