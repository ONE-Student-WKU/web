const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// pdfImportService는 로드 시점에 aiClient/pdf-parse의 export를 구조분해해 쥐고 있으므로,
// 반드시 서비스를 require하기 "전에" 가짜로 바꿔둬야 한다 — 실제 Claude API는 부르지 않는다.
const aiClient = require('../services/aiClient');
const pdfParse = require('pdf-parse');

let calls;
let aiImpl;
let pdfText;
aiClient.extractFullTranscriptRows = async (content) => {
  calls.push({ type: 'ai', content });
  return aiImpl(content);
};
aiClient.extractCourseListRows = async (content) => {
  calls.push({ type: 'ai', content });
  return aiImpl(content);
};
pdfParse.PDFParse = class {
  async getText() {
    return { text: pdfText };
  }
  async destroy() {}
};

const { parseCourseListPdf, parseFullTranscriptText } = require('../services/pdfImportService');
const { buildTableText, buildFullPageText, FAKE_STUDENT_ID, FAKE_STUDENT_NAME } = require('../test-helpers/fullTranscriptFixture');

/**
 * server/test/pdfImportService.aiHook.test.js
 * 학기당 한도 예약 훅(beforeAiCall)이 "Claude를 실제로 부르기 직전에만" 호출되는지, 그리고
 * aiSucceeded가 AI 호출 성공 여부를 정확히 알려주는지 검증 — 라우트는 이 두 신호만 보고
 * 한도를 차감/반환하므로(courseService.runWithPdfImportQuota), 여기가 틀리면 AI를 안 쓴
 * 요청이 한도를 깎는 문제가 재발한다.
 */

const beforeAiCall = async () => {
  calls.push({ type: 'hook' });
};

beforeEach(() => {
  calls = [];
  aiImpl = async () => [];
});

test('한글이 전혀 없는 PDF는 AI도 훅도 부르지 않는다', async () => {
  pdfText = '2024 1 A+ 3.0 iOS Java AI';
  const result = await parseCourseListPdf(Buffer.from(''), { beforeAiCall });
  assert.deepEqual(calls, []);
  assert.equal(result.aiSucceeded, false);
  assert.equal(result.docType, null);
});

test('전체성적조회 PDF는 훅을 AI 호출 직전에 정확히 한 번 부른다', async () => {
  pdfText = buildFullPageText();
  aiImpl = async () => [{ rawCategory: '기전', name: '가상전공과목', year: 2023, semester: 1, credits: 3, letterGrade: 'A+' }];
  const result = await parseCourseListPdf(Buffer.from(''), { beforeAiCall });
  assert.deepEqual(
    calls.map((c) => c.type),
    ['hook', 'ai']
  );
  assert.equal(result.aiSucceeded, true);
  assert.equal(result.docType, 'full_transcript');
});

test('이수과목확인리스트 PDF도 훅을 AI 호출 직전에 부른다', async () => {
  pdfText = '이수과목확인리스트\n교필\t기초과목\t2024/1\t3.0';
  const result = await parseCourseListPdf(Buffer.from(''), { beforeAiCall });
  assert.deepEqual(
    calls.map((c) => c.type),
    ['hook', 'ai']
  );
  assert.equal(result.aiSucceeded, true);
  assert.equal(result.docType, 'course_list');
});

test('AI 호출이 실패하면 aiSucceeded=false와 경고를 돌려준다', async () => {
  aiImpl = async () => {
    throw new Error('Claude API timeout');
  };
  const result = await parseFullTranscriptText(buildTableText(), { beforeAiCall });
  assert.equal(result.aiSucceeded, false);
  assert.ok(result.warnings.some((w) => w.includes('문제가 생겼어요')));
});

test('훅이 throw하면(한도 초과) AI를 부르지 않고 에러를 전파한다', async () => {
  const limitError = new Error('limit');
  await assert.rejects(
    parseFullTranscriptText(buildTableText(), {
      beforeAiCall: async () => {
        throw limitError;
      },
    }),
    limitError
  );
  assert.deepEqual(calls, []);
});

test('학생정보가 표 뒤에 섞여 붙여넣어져도 AI로 보내는 내용엔 학번·이름이 없다', async () => {
  const text = `${buildTableText()}\n학 번\t${FAKE_STUDENT_ID}\t성 명\n${FAKE_STUDENT_NAME}`;
  await parseFullTranscriptText(text, { beforeAiCall });
  const sent = calls.find((c) => c.type === 'ai').content;
  assert.ok(!sent.includes(FAKE_STUDENT_ID));
  assert.ok(!sent.includes(FAKE_STUDENT_NAME));
});
