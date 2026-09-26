const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const courseService = require('../services/courseService');

/**
 * server/test/courseService.pdfImportQuota.test.js
 * 가져오기 학기당 한도(pdf_import_logs) 검증 — 동시 요청에도 한도를 넘지 않는지, 그리고
 * runWithPdfImportQuota가 "AI 결과를 실제로 받은 시도만" 차감하는지.
 *
 * courseService.ownership.test.js와 같은 이유로 실제 로컬 DB에 붙는 통합 테스트다(동시성은
 * 실제 트랜잭션/행 잠금으로만 의미 있게 검증된다). 시드 학생 student_id=1을 쓰고, 테스트가
 * 넣은 행(시작 시점의 최대 id 이후)만 지워 기존 로컬 데이터는 건드리지 않는다.
 */

const STUDENT_ID = 1;
const LIMIT = courseService.PDF_IMPORT_LIMIT_PER_PERIOD;
let maxIdBefore;
let existingCount;

async function countLogs() {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS count FROM pdf_import_logs WHERE student_id = ? AND period = ?',
    [STUDENT_ID, courseService.getCurrentAcademicPeriod()]
  );
  return rows[0].count;
}

async function cleanupFixtures() {
  await pool.query('DELETE FROM pdf_import_logs WHERE student_id = ? AND id > ?', [STUDENT_ID, maxIdBefore]);
}

before(async () => {
  const [rows] = await pool.query('SELECT COALESCE(MAX(id), 0) AS maxId FROM pdf_import_logs');
  maxIdBefore = rows[0].maxId;
  existingCount = await countLogs();
  assert.ok(existingCount < LIMIT, `로컬 DB의 student_id=${STUDENT_ID}가 이미 한도를 다 써서 테스트할 수 없음`);
});

afterEach(cleanupFixtures);

after(async () => {
  await cleanupFixtures();
  await pool.end();
});

test('동시 예약 요청이 몰려도 한도만큼만 통과한다', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => courseService.reservePdfImport(STUDENT_ID)));
  const granted = results.filter((id) => id !== null);
  assert.equal(granted.length, LIMIT - existingCount);
  assert.equal(await countLogs(), LIMIT);
});

test('AI 결과를 받으면 1회 차감한다', async () => {
  await courseService.runWithPdfImportQuota(STUDENT_ID, async (beforeAiCall) => {
    await beforeAiCall();
    return { aiSucceeded: true };
  });
  assert.equal(await countLogs(), existingCount + 1);
});

test('AI 호출이 실패하면 차감하지 않는다', async () => {
  await courseService.runWithPdfImportQuota(STUDENT_ID, async (beforeAiCall) => {
    await beforeAiCall();
    return { aiSucceeded: false };
  });
  assert.equal(await countLogs(), existingCount);
});

test('AI를 부르지 않고 끝나면(훅 미호출) 차감하지 않는다', async () => {
  await courseService.runWithPdfImportQuota(STUDENT_ID, async () => ({ aiSucceeded: false }));
  assert.equal(await countLogs(), existingCount);
});

test('예약 후 파싱 중 에러가 나면 예약을 되돌리고 에러를 그대로 던진다', async () => {
  const parseError = new Error('pdf broken');
  await assert.rejects(
    courseService.runWithPdfImportQuota(STUDENT_ID, async (beforeAiCall) => {
      await beforeAiCall();
      throw parseError;
    }),
    parseError
  );
  assert.equal(await countLogs(), existingCount);
});

test('한도를 다 쓰면 PdfImportLimitExceededError를 던지고 더 기록하지 않는다', async () => {
  for (let i = existingCount; i < LIMIT; i += 1) {
    assert.notEqual(await courseService.reservePdfImport(STUDENT_ID), null);
  }
  await assert.rejects(
    courseService.runWithPdfImportQuota(STUDENT_ID, async (beforeAiCall) => {
      await beforeAiCall();
      return { aiSucceeded: true };
    }),
    courseService.PdfImportLimitExceededError
  );
  assert.equal(await countLogs(), LIMIT);
});
