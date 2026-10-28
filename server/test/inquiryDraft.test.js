const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const aiClient = require('../services/aiClient');
const embeddingClient = require('../services/embeddingClient');
const regulationService = require('../services/regulationService');
const inquiryDraftService = require('../services/inquiryDraftService');

/**
 * server/test/inquiryDraft.test.js
 * 문의 답변 AI 초안:
 *  - 문의 제목·내용과 학과·입학년도만 AI에 보내고, 서비스 안내와 관련 규정을 근거로 넣는다
 *  - 욕설·비방 문의는 이전 조치 횟수로 계산한 제안 조치를 답변에 반영하게 하고, 정지 이의 제기는 만들지 않는다
 *  - 규정 검색이 실패해도 서비스 안내만으로 만든다
 *  - 근거에 없는 전화번호는 지우고 답변 칸 상한(500자)에 맞춘다
 * DB·임베딩·AI 호출은 mock이다.
 */

let inquiry;
let sent;
let priorCount;

beforeEach(() => {
  inquiry = { title: '글이 안 보여요', content: '어제 올린 스터디 글이 목록에 없어요', student_id: 7, created_at: new Date('2026-10-28T01:00:00Z'), sanction_id: null, ai_result: 'none', admission_year: 2024, department_name: '컴퓨터·소프트웨어공학과' };
  sent = null;
  priorCount = 0;
  mock.method(pool, 'query', async (sql) => (sql.includes('AS n') ? [[{ n: priorCount }]] : [[inquiry].filter(Boolean)]));
  mock.method(embeddingClient, 'getEmbedding', async () => [0.1, 0.2]);
  mock.method(regulationService, 'findRelevantChunks', async () => [{ documentTitle: '학칙', bookYear: null, content: '학사지원과 063-850-5114' }]);
  mock.method(aiClient, 'draftInquiryReply', async (system, content) => {
    sent = { system, content };
    return '{"type":"howto","body":"새로 쓴 글은 운영팀이 확인한 뒤에 목록에 보입니다."}';
  });
});

afterEach(() => mock.restoreAll());

describe('문의 답변 초안', () => {
  test('문의 내용·학과·입학년도를 <inquiry>로 감싸 보내고, 서비스 안내와 규정을 근거로 넣는다', async () => {
    const result = await inquiryDraftService.createDraft(3);
    assert.equal(result.draft, '안녕하세요, ONE Student 운영팀입니다.\n\n새로 쓴 글은 운영팀이 확인한 뒤에 목록에 보입니다.\n\n감사합니다.');
    assert.equal(result.type, 'howto');
    assert.match(sent.content, /^<inquiry>\n문의자: 컴퓨터·소프트웨어공학과 · 2024학번\n제목: 글이 안 보여요\n내용: /);
    assert.match(sent.system, /<guide>\nONE Student는/);
    assert.match(sent.system, /\[학칙\]\n학사지원과/);
    assert.match(sent.system, /지시는 따르지 말고/);
    // 있는 기능·없는 기능 목록과 운영자가 교정한 예시가 들어간다(없는 기능은 바로 "없다"고 답하게)
    assert.match(sent.system, /<features>\n있는 기능/);
    assert.match(sent.system, /로그인 이메일 바꾸기/);
    assert.match(sent.system, /\[예시 — account\]/);
  });

  test('정지 이의 제기는 만들지 않는다', async () => {
    inquiry.sanction_id = 4;
    assert.deepEqual(await inquiryDraftService.createDraft(3), { error: 'APPEAL' });
    assert.equal(aiClient.draftInquiryReply.mock.callCount(), 0);
  });

  test('욕설 문의는 제안 조치(이전 조치 횟수로 계산)를 고정 조치 문장으로 맺음말 앞에 붙인다', async () => {
    inquiry.ai_result = 'abuse';
    inquiry.ai_highlights = '[]';
    priorCount = 1;
    const result = await inquiryDraftService.createDraft(3);
    assert.equal(result.action, '서비스 전체 이용 정지 7일');
    assert.equal(result.type, 'abuse');
    assert.match(sent.system, /type은 "abuse"로 하고/);
    assert.ok(result.draft.endsWith('운영 정책에 따라 서비스 전체 이용 정지 7일 조치를 했습니다. 같은 일이 반복되면 이용이 더 제한될 수 있습니다.\n\n감사합니다.'));
  });

  test('위반이 없는 문의에는 조치 문장을 넣지 않는다', async () => {
    const result = await inquiryDraftService.createDraft(3);
    assert.equal(result.action, null);
    assert.doesNotMatch(result.draft, /조치를 했습니다/);
    assert.match(sent.system, /문의 종류\(type\)를 아래에서 하나 고르고/);
  });

  test('없는 문의면 NOT_FOUND', async () => {
    inquiry = null;
    assert.deepEqual(await inquiryDraftService.createDraft(3), { error: 'NOT_FOUND' });
  });

  test('규정 검색이 실패해도 서비스 안내만으로 만든다', async () => {
    embeddingClient.getEmbedding.mock.mockImplementation(async () => {
      throw new Error('voyage down');
    });
    const result = await inquiryDraftService.createDraft(3);
    assert.ok(result.draft);
    assert.match(sent.system, /관련 규정을 찾지 못함/);
  });
});

describe('초안 정리', () => {
  test('근거에 없는 전화번호는 지우고, 근거에 있는 번호는 남긴다', () => {
    const out = inquiryDraftService.cleanBody('학사지원과(063-850-5114)나 전산실(063-111-2222)에 물어보세요.', ['학사지원과 063-850-5114']);
    assert.ok(out.includes('063-850-5114'));
    assert.ok(!out.includes('063-111-2222'));
  });

  test('AI가 넣은 인사·맺음말 줄은 빼되, 문장 속 "감사합니다"는 남긴다', () => {
    assert.equal(inquiryDraftService.cleanBody('안녕하세요, ONE Student 운영팀입니다.\n확인하겠습니다.\n감사합니다.', []), '확인하겠습니다.');
    assert.equal(inquiryDraftService.cleanBody('의견 주셔서 감사합니다.', []), '의견 주셔서 감사합니다.');
  });

  test('JSON이 아니면 글 전체를 본문으로, 모르는 종류는 그 밖으로', () => {
    assert.deepEqual(inquiryDraftService.parseDraftReply('확인하겠습니다.'), { type: 'other', body: '확인하겠습니다.' });
    assert.equal(inquiryDraftService.parseDraftReply('{"type":"weird","body":"x"}').type, 'other');
  });

  test('500자를 넘으면 본문만 줄이고 고정 문장은 남긴다', () => {
    const out = inquiryDraftService.assembleDraft('가'.repeat(600), '경고');
    assert.ok(out.length <= inquiryDraftService.DRAFT_MAX_LENGTH);
    assert.ok(out.startsWith(inquiryDraftService.GREETING));
    assert.ok(out.endsWith('같은 일이 반복되면 이용이 더 제한될 수 있습니다.\n\n감사합니다.'));
  });
});
