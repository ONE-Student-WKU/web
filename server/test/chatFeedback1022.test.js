const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateCertifications } = require('../services/graduationService');
const { buildSystemPrompt } = require('../services/aiClient');
const { serviceGuideChunks } = require('../services/serviceGuide');
const { mergeChunks } = require('../services/chatContextService');

/**
 * server/test/chatFeedback1022.test.js
 * 2026-10-22 사용자 피드백으로 고친 챗봇 근거:
 *  - 졸업인증제에서 어느 과목을 이미 이수했는지 챗봇에 넘긴다(기업연계프로젝트1을 들었는데 둘 다 들으라고 답했다).
 *  - 서비스(ONE Student) 기능 질문에는 이용 안내를 근거로 넣는다(커뮤니티 질문에 학교 전산 부서를 안내했다).
 */

const BOTH_REQUIRED = {
  category: '졸업인증제',
  description: '기업연계프로젝트1(종합설계1)·2(종합설계2) 둘 다 필수 이수',
  min_course_count: 2,
  requiredCourses: ['기업연계프로젝트1(종합설계1)', '기업연계프로젝트2(종합설계2)'],
};
const ONE_OF = {
  category: '졸업인증제',
  description: '캡스톤디자인·기업연계프로젝트·종합설계 중 1과목',
  min_course_count: 1,
  requiredCourses: ['캡스톤디자인', '기업연계프로젝트', '종합설계'],
};
const passed = (...names) => names.map((name) => ({ name, letter_grade: 'A0' }));

test('evaluateCertifications: 이수한 요구 과목과 최소 과목 수를 함께 돌려준다', () => {
  const [row] = evaluateCertifications([BOTH_REQUIRED], passed('기업연계프로젝트1(종합설계1)'));
  assert.equal(row.satisfied, false);
  assert.deepEqual(row.completedCourses, ['기업연계프로젝트1(종합설계1)']);
  assert.equal(row.minCourseCount, 2);
});

test('evaluateCertifications: 성적을 아직 안 넣은 이번 학기 과목도 이수로 센다(졸업인증제는 성적을 요구하지 않는다)', () => {
  const [row] = evaluateCertifications([BOTH_REQUIRED], [{ name: '기업연계프로젝트1(종합설계1)', letter_grade: null }]);
  assert.deepEqual(row.completedCourses, ['기업연계프로젝트1(종합설계1)']);
});

function statusWith(certifications) {
  return {
    totalEarnedCredits: 96,
    totalRequiredCredits: 136,
    categories: [{ category: '전공', earnedCredits: 40, requiredCredits: 60 }],
    certifications,
    regulation: { confidence: 'CONFIRMED', confidenceLabel: '확정', flags: [] },
  };
}

test('챗봇 근거: 모두 들어야 하는 졸업인증제는 이수한 과목과 남은 과목을 나눠 적는다', () => {
  const certifications = evaluateCertifications([BOTH_REQUIRED], passed('기업연계프로젝트1(종합설계1)'));
  const prompt = buildSystemPrompt(null, statusWith(certifications), null);
  assert.match(prompt, /이미 이수한 과목: 기업연계프로젝트1\(종합설계1\) \/ 아직 남은 과목: 기업연계프로젝트2\(종합설계2\)/);
  assert.match(prompt, /이미 이수한 과목을 다시 들으라고 안내하지 마라/);
});

test('챗봇 근거: 여러 과목 중 몇 개만 들으면 되는 졸업인증제는 "남은 과목"으로 나열하지 않는다', () => {
  const certifications = evaluateCertifications([ONE_OF], []);
  const prompt = buildSystemPrompt(null, statusWith(certifications), null);
  assert.match(prompt, /중 1과목 이상이면 된다\. 이미 이수한 과목: 없음/);
  assert.doesNotMatch(prompt, /아직 남은 과목: 캡스톤디자인/);
});

test('챗봇 근거: 근거 자료를 말로 언급하지 말고, 묻지 않은 부가 정보를 붙이지 않게 지시한다', () => {
  const prompt = buildSystemPrompt(null, null, null);
  assert.match(prompt, /근거 자료를 말로 언급하지 마라/);
  assert.match(prompt, /질문이 요구한 범위만 답하라/);
});

test('serviceGuideChunks: 이 서비스의 기능을 말하면 이용 안내를 근거로 넣고, 학사 질문에는 넣지 않는다', () => {
  for (const m of ['커뮤니티 글 올렸는데 왜 바로 등록이 안 돼?', '과목 관리에 성적표 어떻게 올려?', '이 앱 오류 나면 어디에 말해?', '스터디 글 썼는데 안 보여']) {
    assert.equal(serviceGuideChunks(m).length, 1, m);
  }
  for (const m of ['졸업학점 몇 학점이야?', '휴학은 몇 학기까지 돼?', '전과 신청 기간 알려줘']) {
    assert.equal(serviceGuideChunks(m).length, 0, m);
  }
  const [chunk] = serviceGuideChunks('커뮤니티 글이 안 보여');
  assert.match(chunk.content, /승인/);
  assert.match(chunk.content, /문의하기/);
});

test('mergeChunks: 서비스 안내 청크가 다른 근거가 없어도 들어간다(근거 없음 고정 안내로 끝나지 않게)', () => {
  const structured = { regulation: [], graduation: [], history: [], curriculum: [], requirement: [], offering: [], linkedMajor: [], microDegree: [], service: serviceGuideChunks('커뮤니티 글이 안 보여') };
  const merged = mergeChunks({ structured, yearContext: { bookYears: [] } });
  assert.deepEqual(merged.map((c) => c.chunkId), ['service-guide']);
});
