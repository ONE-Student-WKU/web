const { test } = require('node:test');
const assert = require('node:assert/strict');
const { settleTransferLiberalCap } = require('../services/graduationService');
const { decideLiberalArtsCap } = require('../services/regulationEngine/decisions');
const { makeFlag } = require('../services/regulationEngine/flags');

/**
 * server/test/graduationService.transferLiberalCap.test.js
 * 편입생 교양 52학점 상한 적용 여부(학교 확인 중, B-2)는 결과를 바꿀 때만 "추정" 사유다(2026-10-17).
 * 예전에는 편입생이면 무조건 추정이라, 3학년 편입생 전원이 "추정"이었다.
 */

test('상한이 없는 학번(2021학번 이하) 편입생에게는 상한 확인 사유를 붙이지 않는다', () => {
  const old = decideLiberalArtsCap({ admissionYear: 2021, enrollmentType: 'TRANSFER_ADMISSION' });
  assert.equal(old.cap, null);
  assert.ok(!old.flags.some((f) => f.code === 'LIBERAL_CAP_TRANSFER_EXEMPTION_UNVERIFIED'));
  const recent = decideLiberalArtsCap({ admissionYear: 2022, enrollmentType: 'TRANSFER_ADMISSION' });
  assert.ok(recent.flags.some((f) => f.code === 'LIBERAL_CAP_TRANSFER_EXEMPTION_UNVERIFIED'));
});

function engineResult() {
  const capFlag = makeFlag('LIBERAL_CAP_TRANSFER_EXEMPTION_UNVERIFIED');
  return {
    confidence: 'ESTIMATED',
    confidenceLabel: '추정',
    rules: [
      { id: 'REQUIREMENTS', critical: true, confidence: 'CONFIRMED', flags: [] },
      { id: 'LIBERAL_ARTS_CAP', critical: true, confidence: 'ESTIMATED', flags: [capFlag] },
    ],
    flags: [capFlag],
  };
}

test('교양이 상한 이하면 상한 확인 사유를 안내로 바꾸고 확정이 된다', () => {
  const settled = settleTransferLiberalCap(engineResult(), 30, 52);
  assert.equal(settled.confidence, 'CONFIRMED');
  assert.equal(settled.confidenceLabel, '확정');
  assert.deepEqual(settled.flags.map((f) => [f.code, f.level]), [['LIBERAL_CAP_TRANSFER_EXEMPTION_NO_EFFECT', 'INFO']]);
});

test('교양이 상한을 넘으면 결과가 달라질 수 있어 추정 그대로다', () => {
  const kept = settleTransferLiberalCap(engineResult(), 55, 52);
  assert.equal(kept.confidence, 'ESTIMATED');
  assert.equal(kept.flags[0].code, 'LIBERAL_CAP_TRANSFER_EXEMPTION_UNVERIFIED');
});

test('다른 추정 사유가 있으면 그 사유 때문에 추정으로 남는다', () => {
  const r = engineResult();
  r.rules[0] = { id: 'REQUIREMENTS', critical: true, confidence: 'ESTIMATED', flags: [makeFlag('TRANSFER_RECOGNIZED_CREDITS_ASSUMED')] };
  assert.equal(settleTransferLiberalCap(r, 10, 52).confidence, 'ESTIMATED');
});

test('편입생이 아니면(사유 없음) 그대로 돌려준다', () => {
  const r = { confidence: 'CONFIRMED', rules: [{ id: 'X', critical: true, confidence: 'CONFIRMED', flags: [] }], flags: [] };
  assert.equal(settleTransferLiberalCap(r, 100, 52), r);
});
