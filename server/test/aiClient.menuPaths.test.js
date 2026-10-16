const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSystemPrompt } = require('../services/aiClient');

/**
 * server/test/aiClient.menuPaths.test.js
 * 챗봇이 근거 문서 없이도 안내해야 하는 웹정보서비스 메뉴 경로. 이 서비스의 과목 관리 안내(courses.help.*)와 같은 경로라
 * 둘 중 하나만 바뀌지 않게 지킨다. 운영 점검(2026-10-17): "전체 성적은 어디서 봐?"에 "알 수 없다"고 답했다.
 */

test('성적 전체를 보는 경로(전체성적조회·이수과목확인리스트)를 안내할 수 있다', () => {
  const prompt = buildSystemPrompt(null, null, null);
  assert.match(prompt, /웹정보서비스 → 정보서비스 → 성적관리 → 전체성적조회/);
  assert.match(prompt, /웹정보서비스 → 정보서비스 → 성적관리 →\s*이수과목확인리스트/);
});

test('교육과정조회 경로(교육혁신과 답변)는 그대로 있다', () => {
  assert.match(buildSystemPrompt(null, null, null), /웹정보서비스 → 정보서비스 → 교육과정조회 →\s*교육과정조회\(학과별\)/);
});
