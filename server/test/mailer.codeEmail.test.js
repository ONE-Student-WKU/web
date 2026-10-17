// services/mailer.js가 require 시점에 Resend 클라이언트를 만들어서, .env가 없는 CI에선 키가 없다고 throw한다(consent.test.js와 같은 이유로 더미 값).
process.env.RESEND_API_KEY ||= 're_test_dummy';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCodeEmail } = require('../services/mailer');

/**
 * server/test/mailer.codeEmail.test.js
 * 인증코드 메일 — 메일을 열지 않고 알림에서 코드를 보게 제목에 코드를 넣고, 본문에도 남긴다(2026-10-17).
 */

test('로그인 코드는 제목과 본문에 모두 들어간다', () => {
  const { subject, text } = buildCodeEmail('123456');
  assert.equal(subject, '[ONE Student] 로그인 인증코드: 123456');
  assert.match(text, /123456/);
  assert.doesNotMatch(text, /무시하세요/);
});

test('계정 삭제 재인증은 제목이 로그인과 다르다', () => {
  const { subject, text } = buildCodeEmail('654321', 'delete_reauth');
  assert.equal(subject, '[ONE Student] 계정 삭제 확인 코드: 654321');
  assert.match(text, /계정 삭제 확인 코드/);
  assert.match(text, /654321/);
});

test('모르는 목적은 로그인 문구로 보낸다', () => {
  assert.equal(buildCodeEmail('000111', 'unknown').subject, '[ONE Student] 로그인 인증코드: 000111');
});
