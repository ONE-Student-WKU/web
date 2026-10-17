const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSystemPrompt } = require('../services/aiClient');
const { makeFlag } = require('../services/regulationEngine/flags');

/**
 * server/test/aiClient.absentDepartment.test.js
 * 통폐합·개편 학과(최신 책자에 학과 행 없음) 학생의 챗봇 근거에 학교 답변 A-3 안내가 들어가는지.
 * 이 플래그는 INFO라 신뢰도 이유 목록에서는 빠지므로 따로 넘긴다(운영 점검 #378: "학과에 확인"으로만 끝났다).
 */

function statusWith(flags, confidence = 'CONFIRMED') {
  return {
    totalEarnedCredits: 30,
    totalRequiredCredits: 130,
    categories: [{ category: '전공', earnedCredits: 12, requiredCredits: 60 }],
    certifications: [],
    regulation: { confidence, confidenceLabel: '확정', flags },
  };
}

test('통폐합 학과면 소속 유지 안내(A-3)가 챗봇 근거에 들어간다', () => {
  const flag = makeFlag('DEPARTMENT_ABSENT_IN_LATEST_BOOKLET', { latestBookletYear: 2026 });
  assert.equal(flag.level, 'INFO');
  const prompt = buildSystemPrompt(null, statusWith([flag]), null);
  assert.match(prompt, /통폐합·개편 학과다/);
  assert.match(prompt, /소속변경을 신청하지 않았다면 옛 학과 소속이 그대로 유지/);
});

test('신뢰도가 추정이어도 INFO 안내는 이유 목록이 아니라 따로 한 번만 들어간다', () => {
  const flag = makeFlag('DEPARTMENT_ABSENT_IN_LATEST_BOOKLET', { latestBookletYear: 2026 });
  const prompt = buildSystemPrompt(null, statusWith([flag], 'ESTIMATED'), null);
  assert.equal(prompt.split('소속변경을 신청하지 않았다면').length - 1, 1);
});

test('통폐합 학과가 아니면 넣지 않는다', () => {
  const prompt = buildSystemPrompt(null, statusWith([]), null);
  assert.doesNotMatch(prompt, /통폐합·개편 학과다/);
});
