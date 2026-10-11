const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixBareHonorific } = require('../services/aiClient');

/**
 * server/test/career.honorific.test.js
 * 모델이 닉네임을 빼고 "님의 성향과"처럼 호칭 조각만 쓴 응답을 후처리로 채우는 순수 함수 검사 — Claude 호출 없음.
 */

const student = { name: 'user42' };

test('홀로 선 "님"을 닉네임+님으로 채운다', () => {
  assert.equal(fixBareHonorific('님의 성향과 잘 맞아요.', student), 'user42님의 성향과 잘 맞아요.');
  assert.equal(fixBareHonorific('그래서 님이 편하다고 하셨고, 님은 발표를 싫어하세요.', student), '그래서 user42님이 편하다고 하셨고, user42님은 발표를 싫어하세요.');
  assert.equal(fixBareHonorific('저는 "님"께 묻고 싶어요.', student), '저는 "user42님"께 묻고 싶어요.');
});

test('이미 닉네임이 붙었거나 한글 뒤에 붙은 "님"은 건드리지 않는다', () => {
  assert.equal(fixBareHonorific('user42님의 성향과 잘 맞아요.', student), 'user42님의 성향과 잘 맞아요.');
  assert.equal(fixBareHonorific('고객님과 선생님께 여쭤보세요.', student), '고객님과 선생님께 여쭤보세요.');
});

test('닉네임이 없으면 "학생"으로 바꾼다', () => {
  assert.equal(fixBareHonorific('님의 성향과 잘 맞아요.', { name: null }), '학생의 성향과 잘 맞아요.');
  assert.equal(fixBareHonorific('님의 성향과 잘 맞아요.', null), '학생의 성향과 잘 맞아요.');
});

test('영어 응답이나 문자열이 아닌 값은 그대로 둔다', () => {
  assert.equal(fixBareHonorific('님의 성향', student, 'en'), '님의 성향');
  assert.equal(fixBareHonorific(undefined, student), undefined);
});
