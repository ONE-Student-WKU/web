const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSystemPrompt } = require('../services/aiClient');
const { makeFlag } = require('../services/regulationEngine/flags');

/**
 * server/test/aiClient.calculationBasis.test.js
 * 졸업요건 화면은 조문·책자·학교 답변 근거를 빼고 짧은 한 줄만 보여 준다. 학생이 "내 학점은 왜 이렇게 나왔어?"라고 물으면
 * 챗봇이 설명할 수 있게, 이 진단에 적용한 참고 플래그(INFO)를 "계산 근거"로 넘기는지 본다.
 */

function statusWith(flags, confidence = 'CONFIRMED') {
  return {
    totalEarnedCredits: 30,
    totalRequiredCredits: 130,
    categories: [{ category: '전공', earnedCredits: 12, requiredCredits: 60 }],
    certifications: [],
    regulation: { confidence, confidenceLabel: confidence === 'CONFIRMED' ? '확정' : '추정', flags },
  };
}

test('확정 결과여도 참고 플래그를 계산 근거로 넘긴다(조문 그대로)', () => {
  const prompt = buildSystemPrompt(null, statusWith([makeFlag('MAJOR_CHANGE_PRIOR_COURSES'), makeFlag('LATEST_BOOKLET_COHORT_TABLE')]), null);
  assert.match(prompt, /이 진단에 적용한 계산 근거다/);
  assert.match(prompt, /전과 전 학과에서 들은 전공 과목은 일반선택으로 셌어요\(학칙시행규칙 제3조 제4항\)/);
  assert.match(prompt, /학번별 이수기준표/);
});

test('시스템 내부 사정과 따로 넘기는 통폐합 안내는 계산 근거에 넣지 않는다', () => {
  const prompt = buildSystemPrompt(null, statusWith([
    makeFlag('TEXT_SNAPSHOT_MAY_BE_OLDER'),
    makeFlag('COHORT_TRANSITION_ADDENDUM_NOT_HELD'),
    makeFlag('DEPARTMENT_ABSENT_IN_LATEST_BOOKLET', { latestBookletYear: 2026 }),
  ]), null);
  assert.doesNotMatch(prompt, /이 진단에 적용한 계산 근거다/);
  // 통폐합 안내는 기존처럼 한 번만 들어간다
  assert.equal(prompt.split('소속변경을 신청하지 않았다면').length - 1, 1);
});

test('추정 이유(INFO가 아닌 플래그)는 계산 근거가 아니라 기존 신뢰도 이유 목록에만 들어간다', () => {
  const prompt = buildSystemPrompt(null, statusWith([makeFlag('TRANSFER_GRADE_ASSUMED')], 'ESTIMATED'), null);
  assert.doesNotMatch(prompt, /이 진단에 적용한 계산 근거다/);
  assert.equal(prompt.split('편입 학년을 몰라 3학년 편입').length - 1, 1);
});
