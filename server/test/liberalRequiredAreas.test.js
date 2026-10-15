const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateLiberalRequiredAreas } = require('../services/liberalRequiredAreas');
const { buildSystemPrompt } = require('../services/aiClient');

/**
 * server/test/liberalRequiredAreas.test.js
 * 교양필수 영역 판정(#378 결정 1-1 A·1-2 A). 예전에는 교양필수 학점 합계만 봐서 "종교와원불교"를 안 들어도 충족이었다.
 */

const byArea = (result) => Object.fromEntries(result.map((r) => [r.area, r]));

test('영역 과목을 들었는지 본다 — 종교와원불교를 안 들으면 건학이념 미이수', () => {
  const r = byArea(evaluateLiberalRequiredAreas(['건학이념', '대학생활'], ['대학생활과자기혁신', '글쓰기이론과실제']));
  assert.equal(r['건학이념'].satisfied, false);
  assert.deepEqual(r['건학이념'].missing, ['종교와원불교']);
  assert.equal(r['대학생활'].satisfied, true);
});

test('띄어쓰기·가운뎃점·끝 괄호처럼 표기만 다른 이름도 같은 과목으로 본다', () => {
  const r = byArea(evaluateLiberalRequiredAreas(['건학이념', '대학생활'], ['종교와 원불교', '대학생활과 자기혁신(1분반)']));
  assert.equal(r['건학이념'].satisfied, true);
  assert.equal(r['대학생활'].satisfied, true);
});

test('이름이 비슷한 다른 과목은 인정하지 않는다(한국종교문화와원불교(원어)는 종교와원불교가 아니다)', () => {
  const r = byArea(evaluateLiberalRequiredAreas(['건학이념'], ['한국종교문화와원불교(원어)']));
  assert.equal(r['건학이념'].satisfied, false);
});

test('전공탐색과진로(광역 계열)는 전공탐색101과 전공기초세미나를 모두 들어야 한다', () => {
  const half = byArea(evaluateLiberalRequiredAreas(['건학이념', '대학생활', '전공탐색과진로'], ['전공탐색101']));
  assert.equal(half['전공탐색과진로'].satisfied, false);
  assert.deepEqual(half['전공탐색과진로'].missing, ['전공기초세미나']);
  const full = byArea(evaluateLiberalRequiredAreas(['전공탐색과진로'], ['전공탐색101', '전공기초세미나']));
  assert.equal(full['전공탐색과진로'].satisfied, true);
});

test('영역 이름이 아닌 지정 과목(과목명이 직접 적힌 행)이면 판정하지 않는다(null)', () => {
  assert.equal(evaluateLiberalRequiredAreas(['종교와원불교'], ['종교와원불교']), null);
  assert.equal(evaluateLiberalRequiredAreas([], []), null);
});

test('챗봇에 넘기는 졸업 현황에 영역 이수 여부가 들어간다', () => {
  const status = {
    totalEarnedCredits: 39, totalRequiredCredits: 130, certifications: [],
    categories: [{ category: '교양필수', earnedCredits: 5, requiredCredits: 5, areas: evaluateLiberalRequiredAreas(['건학이념', '대학생활'], ['대학생활과자기혁신']) }],
  };
  const prompt = buildSystemPrompt(null, status, null, 'ko');
  assert.match(prompt, /교양필수: 5\/5학점 — 영역: 건학이념\(종교와원불교\) 미이수, 대학생활\(대학생활과자기혁신\) 이수/);
});
