const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const careerService = require('../services/careerService');
const studentService = require('../services/studentService');
const aiClient = require('../services/aiClient');
const careerRouter = require('../routes/career');
const { parseLanguage } = require('../services/language');

/**
 * server/test/career.language.test.js
 * 진로 탐색 AI 답변 언어(영어 화면): 클라이언트가 보낸 language가 허용 목록을 거쳐 careerService까지 전달되고,
 * 영어일 때만 시스템 프롬프트에 답변 언어 지시가 붙으며, 로드맵의 과목명은 한국어 원문 그대로 두라는 지시가 들어 있다.
 * DB와 Claude 호출은 쓰지 않는다(서비스·학생 조회는 mock, 프롬프트 검사는 fetch를 가로챔).
 */

let server;
let baseUrl;
let captured;
const realFetch = global.fetch;

before(async () => {
  mock.method(studentService, 'findById', async () => ({ id: 1, department_id: 1 }));
  for (const name of ['submitFixedAnswers', 'postMessage', 'generateCandidates', 'confirmCareer']) {
    mock.method(careerService, name, async (...args) => {
      captured = { name, args };
      return name === 'generateCandidates' ? [] : name === 'confirmCareer' ? [] : [];
    });
  }

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: 1 };
    next();
  });
  app.use('/api/career', careerRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err) })); // eslint-disable-line no-unused-vars
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  mock.restoreAll();
  global.fetch = realFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
});

const post = async (path, body) => {
  captured = null;
  const res = await realFetch(`${baseUrl}/api/career${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('parseLanguage: en만 en이고 나머지는 모두 ko', () => {
  assert.equal(parseLanguage('en'), 'en');
  for (const v of [undefined, null, '', 'ko', 'EN', 'ja', 1, {}]) assert.equal(parseLanguage(v), 'ko');
});

test('자유 대화·진로 후보·확정·고정 답변 제출 모두 language를 careerService 마지막 인자로 전달한다', async () => {
  await post('/sessions/7/messages', { content: 'hello', language: 'en' });
  assert.equal(captured.name, 'postMessage');
  assert.equal(captured.args.at(-1), 'en');

  await post('/sessions/7/candidates', { language: 'en' });
  assert.equal(captured.name, 'generateCandidates');
  assert.equal(captured.args.at(-1), 'en');

  await post('/sessions/7/confirm', { careerName: 'Backend developer', language: 'en' });
  assert.equal(captured.name, 'confirmCareer');
  assert.equal(captured.args.at(-1), 'en');

  await post('/sessions/7/fixed-answers', { fixedAnswers: [{ question: 'q', answer: 'a' }], language: 'en' });
  assert.equal(captured.name, 'submitFixedAnswers');
  assert.equal(captured.args.at(-1), 'en');
});

test('language가 없거나 허용 목록 밖이면 한국어(ko)로 처리하고, 본문이 없는 후보 요청도 동작한다', async () => {
  await post('/sessions/7/messages', { content: '안녕' });
  assert.equal(captured.args.at(-1), 'ko');
  await post('/sessions/7/messages', { content: '안녕', language: 'ja' });
  assert.equal(captured.args.at(-1), 'ko');

  captured = null;
  const res = await realFetch(`${baseUrl}/api/career/sessions/7/candidates`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(captured.name, 'generateCandidates');
  assert.equal(captured.args.at(-1), 'ko');
});

test('시스템 프롬프트: 영어일 때만 답변 언어 지시가 붙고, 로드맵 과목명은 한국어 원문 유지 지시가 있다', async () => {
  const systems = [];
  global.fetch = async (url, options) => {
    systems.push(JSON.parse(options.body).system);
    return { ok: true, json: async () => ({ content: [{ text: '[]' }] }), text: async () => '' };
  };
  const student = { name: '학생', department_name: '컴퓨터·소프트웨어공학과', admission_year: 2022, leave_semesters: 0 };

  for (const language of ['ko', 'en']) {
    systems.length = 0;
    await aiClient.getCareerFollowUp([{ role: 'user', content: 'x' }], student, [], language);
    await aiClient.generateCareerCandidates([{ role: 'assistant', content: 'q' }], student, [], language);
    await aiClient.generateCareerRoadmap('Backend developer', 'because', [{ grade: 3, semester: 1, courseName: '운영체제', category: '전공필수', credits: 3 }], student, language);
    assert.equal(systems.length, 3);
    for (const system of systems) {
      assert.equal(system.includes('Answer language'), language === 'en', `${language}: ${system.slice(0, 40)}`);
    }
    if (language === 'en') {
      assert.match(systems[2], /courseName.*exactly as written in the course list/s);
      assert.match(systems[2], /Korean/);
    }
  }
  assert.equal(aiClient.buildCareerLanguageNote('ko'), null);
});
