const pool = require('../db');
const { kstDateOffset } = require('./adminStatsService');

/**
 * server/services/reviewService.js
 * 앱 안 후기 — 써 본 학생에게 후기 창(client/src/components/ReviewPrompt.jsx)을 한 번 띄우고, 보낸 후기를 익명으로 저장한다.
 * 후기는 소개 자료에 "○○학과 익명"으로 쓰려고 받는다. 답장하지 않으므로 누가 썼는지 남기지 않는다(db/schema.sql 15).
 *
 * 띄우는 기준(사용자 결정 2026-11-09):
 *  - 깊게 써 본 학생만: 과목을 10개 이상 넣었거나, 챗봇 답변 3개 이상 + 진로 탐색 대화를 둘 다 해 봤어야 한다.
 *    (진단 기록 graduation_snapshots는 홈만 열어도 생겨서 신호로 쓰지 않는다.)
 *  - 한 사람에게 최대 2번: 처음 띄운 뒤 7일이 지나면 한 번 더, 그 뒤로는 띄우지 않는다. 보내면 바로 끝.
 *  - "이번 접속에서 3분 이상, 홈으로 돌아올 때"는 화면(client/src/hooks/useReviewPrompt.js)이 정한다.
 */

const MIN_COURSES = 10;
const MIN_CHAT_ANSWERS = 3;
const MIN_CAREER_ANSWERS = 1;
const MAX_PROMPTS = 2;
const RETRY_DAYS = 7;
const CONTENT_MAX_LENGTH = 500;

/** 깊게 써 본 학생인지 — 사용 기록 수로만 판단한다. */
function meetsUsageSignal({ courses, chatAnswers, careerAnswers }) {
  if (courses >= MIN_COURSES) return true;
  return chatAnswers >= MIN_CHAT_ANSWERS && careerAnswers >= MIN_CAREER_ANSWERS;
}

async function countUsage(studentId) {
  const [[row]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM student_courses WHERE student_id = ?) AS courses,
       (SELECT COUNT(*) FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
         WHERE c.student_id = ? AND m.role = 'assistant') AS chatAnswers,
       (SELECT COUNT(*) FROM career_messages m JOIN career_sessions s ON s.id = m.session_id
         WHERE s.student_id = ? AND m.role = 'user') AS careerAnswers`,
    [studentId, studentId, studentId]
  );
  return { courses: Number(row.courses), chatAnswers: Number(row.chatAnswers), careerAnswers: Number(row.careerAnswers) };
}

/** 지금 이 학생에게 후기 창을 띄워도 되는가. */
async function isPromptDue(studentId) {
  const [[student]] = await pool.query(
    'SELECT review_prompt_count, review_prompt_next_at <= NOW() AS retryReady FROM students WHERE id = ?',
    [studentId]
  );
  if (!student || student.review_prompt_count >= MAX_PROMPTS) return false;
  // 한 번 띄운 학생은 이미 기준을 채웠으니 7일만 지나면 된다.
  if (student.review_prompt_count > 0) return !!student.retryReady;
  return meetsUsageSignal(await countUsage(studentId));
}

/**
 * 창을 띄웠다고 기록한다. 띄운 채로 앱을 닫아도 "다음에"와 같게 치려고, 버튼이 아니라 띄우는 순간에 센다.
 * 두 번째면 다시 띄우지 않고, 첫 번째면 7일 뒤로 미룬다.
 */
async function markPromptShown(studentId) {
  // MySQL은 SET을 왼쪽부터 적용해서, 두 번째 줄의 review_prompt_count는 이미 1 늘어난 값이다.
  await pool.query(
    `UPDATE students
     SET review_prompt_count = review_prompt_count + 1,
         review_prompt_next_at = IF(review_prompt_count >= ?, NULL, NOW() + INTERVAL ? DAY)
     WHERE id = ? AND review_prompt_count < ?`,
    [MAX_PROMPTS, RETRY_DAYS, studentId, MAX_PROMPTS]
  );
}

/** 별점 1~5 정수와 500자 이하 후기(선택)인지. 통과하면 저장할 값을, 아니면 null을 돌려준다. */
function parseReview(body) {
  const rating = body?.rating;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  const raw = body?.content ?? '';
  if (typeof raw !== 'string') return null;
  const content = raw.trim();
  if (content.length > CONTENT_MAX_LENGTH) return null;
  return { rating, content: content || null };
}

/**
 * 후기를 익명으로 저장한다 — 학생 id는 남기지 않고 지금 학과 이름과 한국 날짜만 함께 둔다.
 * 창을 한 번도 띄우지 않은 계정이면 저장하지 않고 false. 보내면 다시 띄우지 않는다.
 */
async function submitReview(studentId, { rating, content }, now = Date.now()) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[student]] = await conn.query(
      `SELECT s.review_prompt_count, d.name AS department_name
       FROM students s LEFT JOIN departments d ON d.id = s.department_id
       WHERE s.id = ? FOR UPDATE`,
      [studentId]
    );
    if (!student || student.review_prompt_count < 1) {
      await conn.rollback();
      return false;
    }
    await conn.query('UPDATE students SET review_prompt_count = ?, review_prompt_next_at = NULL WHERE id = ?', [MAX_PROMPTS, studentId]);
    await conn.query('INSERT INTO service_reviews (rating, content, department_name, created_date) VALUES (?, ?, ?, ?)', [
      rating,
      content,
      student.department_name,
      kstDateOffset(now, 0),
    ]);
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** 관리자 후기 목록 — 최근 것부터, 개수·평균 별점과 함께. */
async function listReviews() {
  const [rows] = await pool.query(
    "SELECT id, rating, content, department_name, DATE_FORMAT(created_date, '%Y-%m-%d') AS date FROM service_reviews ORDER BY id DESC LIMIT 500"
  );
  const [[summary]] = await pool.query('SELECT COUNT(*) AS count, AVG(rating) AS average FROM service_reviews');
  return {
    count: Number(summary.count),
    average: summary.average === null ? null : Math.round(Number(summary.average) * 10) / 10,
    reviews: rows.map((r) => ({ id: r.id, rating: r.rating, content: r.content, department: r.department_name, date: r.date })),
  };
}

module.exports = {
  MIN_COURSES,
  MIN_CHAT_ANSWERS,
  MAX_PROMPTS,
  RETRY_DAYS,
  CONTENT_MAX_LENGTH,
  meetsUsageSignal,
  isPromptDue,
  markPromptShown,
  parseReview,
  submitReview,
  listReviews,
};
