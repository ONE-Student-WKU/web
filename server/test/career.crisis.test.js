const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const aiClient = require('../services/aiClient');
const careerService = require('../services/careerService');
const { detectCrisis, hasRecentCrisis } = require('../services/crisis');

/**
 * server/test/career.crisis.test.js
 * 진로 탐색 대화의 위기 신호 감지와, 신호가 있을 때 후보 생성이 AI를 부르지 않고 막히는지 검사한다. DB·Claude 호출은 mock.
 */

afterEach(() => mock.restoreAll());

test('자살·자해를 암시하는 말은 잡는다', () => {
  for (const text of [
    '요즘 진짜 죽고 싶다는 생각이 자주 들어요',
    '죽고싶어요',
    '그냥 다 끝내고 죽어버릴까 봐요',
    '자살 생각까지 했어요',
    '살기 싫어요',
    '살 이유가 없는 것 같아요',
    '사라지고 싶어요',
    'I want to die',
    'thinking about suicide',
  ]) {
    assert.equal(detectCrisis(text), true, text);
  }
});

test('흔한 관용·피로 표현이나 부정형은 잡지 않는다', () => {
  for (const text of [
    '요즘 너무 우울하고 다 포기하고 싶어요',
    '과제 때문에 힘들어 죽겠어요',
    '배고파 죽겠다 ㅋㅋ',
    '죽고 싶지는 않은데 너무 지쳐요',
    '웃겨 죽는 줄 알았어요',
    '발표가 싫어요',
    '',
  ]) {
    assert.equal(detectCrisis(text), false, text);
  }
});

test('최근 학생 메시지 6개 안에 있을 때만 위기로 본다(오래전 말 때문에 세션이 영영 막히지 않게)', () => {
  const turn = (role, content) => ({ role, content });
  const history = [turn('user', '죽고 싶어요')];
  for (let i = 0; i < 6; i++) history.push(turn('assistant', '질문'), turn('user', `답변 ${i}`));
  assert.equal(hasRecentCrisis(history), false);
  assert.equal(hasRecentCrisis(history.slice(-4)), false);
  assert.equal(hasRecentCrisis([...history, turn('user', '요즘 죽고 싶다는 생각이 들어요')]), true);
  // assistant 메시지에 든 말은 보지 않는다
  assert.equal(hasRecentCrisis([turn('assistant', '자살예방상담전화 109'), turn('user', '네')]), false);
});

test('위기 신호가 있으면 후보 생성은 AI를 부르지 않고 CAREER_CRISIS_DETECTED로 막힌다', async () => {
  mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM career_sessions')) return [[{ id: 7, status: 'IN_PROGRESS', confirmed_career: null }]];
    if (sql.includes('FROM career_messages')) return [[{ role: 'user', content: '요즘 진짜 죽고 싶다는 생각이 자주 들어요' }]];
    throw new Error(`예상 밖 쿼리: ${sql}`);
  });
  const ai = mock.method(aiClient, 'generateCareerCandidates', async () => []);

  await assert.rejects(() => careerService.generateCandidates(1, 7, { id: 1 }, 'ko'), { code: 'CAREER_CRISIS_DETECTED' });
  assert.equal(ai.mock.callCount(), 0);
});

test('위기 신호가 없으면 기존처럼 후보를 만든다', async () => {
  const writes = [];
  mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM career_sessions')) return [[{ id: 7, status: 'IN_PROGRESS', confirmed_career: null }]];
    if (sql.includes('FROM career_messages')) return [[{ role: 'user', content: '프로젝트가 재밌었어요' }]];
    if (sql.includes('FROM student_courses')) return [[]];
    if (sql.includes('FROM career_candidates')) return [[{ id: 1, career_name: '백엔드 개발자', reasoning: '근거' }]];
    writes.push(sql);
    return [{}];
  });
  const ai = mock.method(aiClient, 'generateCareerCandidates', async () => [{ careerName: '백엔드 개발자', reasoning: '근거' }]);

  const result = await careerService.generateCandidates(1, 7, { id: 1 }, 'ko');
  assert.equal(ai.mock.callCount(), 1);
  assert.equal(result[0].careerName, '백엔드 개발자');
});
