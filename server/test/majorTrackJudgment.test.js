const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const studentService = require('../services/studentService');
const { resolveRequirementsForStudent, inputFromStudentRow } = require('../services/regulationEngine');
const { computeMajorAreaCredits } = require('../services/graduationService');
const { buildSystemPrompt } = require('../services/aiClient');

/**
 * server/test/majorTrackJudgment.test.js
 * 광역 계열전공 판정(학칙시행규칙 제7조, #378 E-3): 이수유형별 주전공 학점(제2항)과 이수구분별 최소 학점(제3항).
 * 시드의 계열 전공 행은 전공심화형 기준(전공필수 36 + 전공선택 나머지)이다. 요건 계산은 시드 DB를 쓴다.
 */

after(() => pool.end());

const requirementsFor = async (name, admissionYear, extra = {}) => {
  const d = (await studentService.listDepartments()).find((x) => x.name === name);
  const regulation = await resolveRequirementsForStudent(inputFromStudentRow({ department_id: d.id, department_name: name, admission_year: admissionYear, enrollment_type: 'GENERAL', ...extra }));
  const rule = regulation.rules.find((r) => r.id === 'REQUIREMENTS');
  const credits = Object.fromEntries(rule.value.categories.map((c) => [c.category, c.requiredCredits]));
  return { rule, credits, codes: rule.flags.map((f) => f.code) };
};

test('이수유형별 주전공: 전공심화형은 시드 그대로, 복수전공형 36·전공융합형 48, 졸업학점은 그대로(줄어든 만큼 자유선택)', async () => {
  const intensive = await requirementsFor('공학1계열', 2026, { major_track_type: 'INTENSIVE' });
  const double = await requirementsFor('공학1계열', 2026, { major_track_type: 'DOUBLE_MAJOR' });
  const convergence = await requirementsFor('공학1계열', 2026, { major_track_type: 'CONVERGENCE' });
  assert.equal(intensive.rule.confidence, 'CONFIRMED');
  assert.ok(!intensive.codes.some((c) => c.startsWith('MAJOR_TRACK_')));
  assert.equal(double.credits['전공필수'] + double.credits['전공선택'], 36);
  assert.equal(convergence.credits['전공필수'] + convergence.credits['전공선택'], 48);
  for (const r of [double, convergence]) {
    assert.equal(r.rule.value.totalRequiredCredits, intensive.rule.value.totalRequiredCredits, '졸업학점은 유형과 무관');
    assert.equal(r.rule.confidence, 'ESTIMATED', '제2전공·마이크로디그리를 아직 판정하지 않아 추정');
  }
  assert.ok(double.codes.includes('MAJOR_TRACK_DOUBLE_MAJOR'));
  assert.ok(convergence.codes.includes('MAJOR_TRACK_CONVERGENCE'));
});

test('아직 안 정했으면 기초·심화·응용 최소(36)만, 답하지 않았으면 전공심화형 기준 — 둘 다 추정', async () => {
  const undecided = await requirementsFor('공학1계열', 2026, { major_track_type: 'UNDECIDED' });
  assert.equal(undecided.credits['전공필수'] + undecided.credits['전공선택'], 36);
  assert.ok(undecided.codes.includes('MAJOR_TRACK_UNDECIDED'));
  const unanswered = await requirementsFor('공학1계열', 2026);
  assert.equal(unanswered.credits['전공필수'] + unanswered.credits['전공선택'], 72);
  assert.ok(unanswered.codes.includes('MAJOR_TRACK_UNANSWERED'));
});

test('이수구분별 최소 학점: 경영계열 18·12·6, 그 외 계열 12·15·9, 계열이 아니면 없음', async () => {
  assert.deepEqual((await requirementsFor('경영계열', 2026, { major_track_type: 'INTENSIVE' })).rule.value.majorAreaMinimums, { 기초: 18, 심화: 12, 응용: 6 });
  assert.deepEqual((await requirementsFor('공학1계열', 2026, { major_track_type: 'INTENSIVE' })).rule.value.majorAreaMinimums, { 기초: 12, 심화: 15, 응용: 9 });
  assert.equal((await requirementsFor('컴퓨터·소프트웨어공학과', 2022)).rule.value.majorAreaMinimums, null);
});

test('이수구분별 학점: 저장된 구분을 먼저 쓰고, 없으면 편성표 과목명으로 찾고, 둘 다 없으면 따로 센다', () => {
  const areaByName = new Map([['편성표심화과목', '심화']]);
  const result = computeMajorAreaCredits({ 기초: 12, 심화: 15, 응용: 9 }, [
    { name: '저장된기초', category: '전공선택', credits: 3, major_area: '기초' },
    { name: '편성표 심화과목', category: '전공선택', credits: 3, major_area: null },
    { name: '모르는과목', category: '전공선택', credits: 3, major_area: null },
    { name: '교양과목', category: '교양선택', credits: 3, major_area: null },
  ], areaByName);
  const byArea = Object.fromEntries(result.areas.map((a) => [a.area, a]));
  assert.deepEqual([byArea['기초'].earned, byArea['심화'].earned, byArea['응용'].earned], [3, 3, 0]);
  assert.equal(result.unknownCredits, 3);
  assert.equal(result.satisfied, false);
});

test('챗봇에 이수유형과 이수구분별 학점을 넘기고, 구분을 모르는 학점은 단정하지 말라고 한다', () => {
  const status = {
    totalEarnedCredits: 9, totalRequiredCredits: 130, categories: [], certifications: [], majorTrackType: 'INTENSIVE',
    majorAreaCredits: { areas: [{ area: '기초', required: 12, earned: 3, satisfied: false }, { area: '심화', required: 15, earned: 3, satisfied: false }, { area: '응용', required: 9, earned: 0, satisfied: false }], unknownCredits: 3, satisfied: false },
  };
  const prompt = buildSystemPrompt(null, status, null, 'ko');
  assert.match(prompt, /이수유형: 전공심화형/);
  assert.match(prompt, /기초전공 3\/12학점, 심화전공 3\/15학점, 응용전공 0\/9학점/);
  assert.match(prompt, /알 수 없는 전공 3학점/);
});
