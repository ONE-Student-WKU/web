const pool = require('../db');
const aiClient = require('./aiClient');
const curriculumService = require('./curriculumService');

/**
 * server/services/careerService.js
 * 진로 탐색(상담형) — 고정 질문 답변 + 자유 대화를 career_messages에 하나의 트랜스크립트로
 * 쌓고, 대화를 종합해 진로 후보를 뽑은 뒤, 확정된 진로에 맞춰 아직 안 들은 과목으로만
 * 로드맵을 구성한다(career_roadmap_items — curriculum_courses에 실제로 있는 과목만 저장).
 */

async function createSession(studentId) {
  const [result] = await pool.query('INSERT INTO career_sessions (student_id) VALUES (?)', [studentId]);
  return result.insertId;
}

async function findSessionRow(studentId, sessionId) {
  const [rows] = await pool.query(
    'SELECT id, status, confirmed_career FROM career_sessions WHERE id = ? AND student_id = ?',
    [sessionId, studentId]
  );
  return rows[0] || null;
}

async function findLatestSessionRow(studentId) {
  const [rows] = await pool.query(
    'SELECT id, status, confirmed_career FROM career_sessions WHERE student_id = ? ORDER BY id DESC LIMIT 1',
    [studentId]
  );
  return rows[0] || null;
}

async function listMessages(sessionId) {
  const [rows] = await pool.query(
    'SELECT role, content FROM career_messages WHERE session_id = ? ORDER BY id',
    [sessionId]
  );
  return rows;
}

async function listCandidates(sessionId) {
  const [rows] = await pool.query(
    'SELECT id, career_name, reasoning FROM career_candidates WHERE session_id = ? ORDER BY sort_order',
    [sessionId]
  );
  return rows.map((r) => ({ id: r.id, careerName: r.career_name, reasoning: r.reasoning }));
}

async function listRoadmap(sessionId) {
  const [rows] = await pool.query(
    'SELECT grade, semester, course_name, reason FROM career_roadmap_items WHERE session_id = ? ORDER BY sort_order',
    [sessionId]
  );
  return rows.map((r) => ({ grade: r.grade, semester: r.semester, courseName: r.course_name, reason: r.reason }));
}

// 세션 하나를 화면이 필요로 하는 형태로 통째로 조립한다 (재진입/새로고침 시 그대로 복원).
async function getSessionDetail(studentId, sessionId) {
  const session = await findSessionRow(studentId, sessionId);
  if (!session) return null;

  const [messages, candidates, roadmap] = await Promise.all([
    listMessages(sessionId),
    session.status !== 'IN_PROGRESS' ? listCandidates(sessionId) : Promise.resolve([]),
    session.status === 'CONFIRMED' ? listRoadmap(sessionId) : Promise.resolve([]),
  ]);

  return {
    id: session.id,
    status: session.status,
    confirmedCareer: session.confirmed_career,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    candidates,
    roadmap,
  };
}

async function getLatestSessionDetail(studentId) {
  const latest = await findLatestSessionRow(studentId);
  if (!latest) return null;
  return getSessionDetail(studentId, latest.id);
}

async function saveMessage(sessionId, role, content) {
  await pool.query('INSERT INTO career_messages (session_id, role, content) VALUES (?, ?, ?)', [sessionId, role, content]);
}

// 대화 중인 AI가 "학생이 지금까지 뭘 들었는지"를 실제로 참고할 수 있게 한다 — 과목 관리에
// 이미 등록된 데이터인데도 진로 상담 AI가 몰라서 "확인할 수 없다"고 답하는 문제가 실사용으로
// 확인됨. 다만 이건 참고용 컨텍스트일 뿐, 진로 판단의 주된 근거는 여전히 대화 자체다
// (aiClient.buildCareerStudentNote에서 그 우선순위를 명시).
async function getCompletedCourses(studentId) {
  const [rows] = await pool.query(
    'SELECT name, category FROM student_courses WHERE student_id = ? ORDER BY year, semester',
    [studentId]
  );
  return rows.map((r) => ({ name: r.name, category: r.category }));
}

// 채팅이 시작된 뒤에도 처음 고정 질문 답변을 고칠 수 있게 한다 — 이미 나눈 자유 대화는
// 그대로 두고, 다음에 보낼 메시지부터 AI가 새 답변을 참고하도록 한다(합의된 설계). 고정
// 질문 블록은 항상 세션 맨 앞에 (assistant 질문, user 답변) 쌍으로 저장돼 있으므로, 그
// 안에서 답변(user) 메시지만 id 순서를 그대로 유지한 채 내용을 갱신한다 — 지우고 다시
// 넣으면 auto-increment id가 뒤로 밀려 대화 순서가 흐트러진다.
async function updateFixedAnswers(studentId, sessionId, fixedAnswers) {
  const session = await findSessionRow(studentId, sessionId);
  if (!session) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });

  const [rows] = await pool.query('SELECT id, role FROM career_messages WHERE session_id = ? ORDER BY id', [sessionId]);
  const fixedBlockSize = fixedAnswers.length * 2;
  if (rows.length < fixedBlockSize) {
    throw Object.assign(new Error('FIXED_ANSWERS_NOT_FOUND'), { code: 'FIXED_ANSWERS_NOT_FOUND' });
  }

  for (let i = 0; i < fixedAnswers.length; i++) {
    const answerRow = rows[i * 2 + 1]; // (질문, 답변) 쌍이라 홀수 인덱스가 항상 답변(user)
    if (answerRow.role !== 'user') continue;
    await pool.query('UPDATE career_messages SET content = ? WHERE id = ?', [fixedAnswers[i].answer, answerRow.id]);
  }

  return listMessages(sessionId);
}

// 고정 질문(프론트 하드코딩) 답변을 assistant(질문)/user(답변) 턴으로 이어 붙여 대화 이력의
// 시작 부분을 채우고, 이어서 AI의 첫 자유 대화 질문을 생성한다.
async function submitFixedAnswers(studentId, sessionId, fixedAnswers, student) {
  const session = await findSessionRow(studentId, sessionId);
  if (!session) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });

  for (const { question, answer } of fixedAnswers) {
    await saveMessage(sessionId, 'assistant', question);
    await saveMessage(sessionId, 'user', answer || '(잘 모르겠어요, 건너뜀)');
  }

  const history = await listMessages(sessionId);
  const completedCourses = await getCompletedCourses(studentId);
  const followUp = await aiClient.getCareerFollowUp(history, student, completedCourses);
  await saveMessage(sessionId, 'assistant', followUp);

  return listMessages(sessionId);
}

// 자유 대화 한 턴 — 사용자 메시지를 저장하고, 이어서 AI의 다음 질문을 저장한다.
async function postMessage(studentId, sessionId, content, student) {
  const session = await findSessionRow(studentId, sessionId);
  if (!session) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });

  await saveMessage(sessionId, 'user', content);
  const history = await listMessages(sessionId);
  const completedCourses = await getCompletedCourses(studentId);
  const followUp = await aiClient.getCareerFollowUp(history, student, completedCourses);
  await saveMessage(sessionId, 'assistant', followUp);

  return listMessages(sessionId);
}

// 지금까지의 대화를 종합해 진로 후보를 뽑는다. "더 이야기해볼게요"로 되돌아갔다가 다시
// 요청하는 경우를 대비해 이전 후보는 지우고 새로 채운다.
async function generateCandidates(studentId, sessionId, student) {
  const session = await findSessionRow(studentId, sessionId);
  if (!session) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });

  const history = await listMessages(sessionId);
  const completedCourses = await getCompletedCourses(studentId);
  // 정보가 아주 적을 때 모델이 JSON 대신 되묻는 문장을 낼 수 있어(프롬프트로 최대한
  // 막아뒀지만 100% 보장은 안 됨) 파싱 실패도 "후보 없음"과 동일하게 다뤄, 500 대신
  // 사용자가 이해할 수 있는 CAREER_CANDIDATES_EMPTY로 수렴시킨다.
  let candidates;
  try {
    candidates = await aiClient.generateCareerCandidates(history, student, completedCourses);
  } catch {
    candidates = [];
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw Object.assign(new Error('CAREER_CANDIDATES_EMPTY'), { code: 'CAREER_CANDIDATES_EMPTY' });
  }

  await pool.query('DELETE FROM career_candidates WHERE session_id = ?', [sessionId]);
  let order = 0;
  for (const c of candidates) {
    await pool.query(
      'INSERT INTO career_candidates (session_id, career_name, reasoning, sort_order) VALUES (?, ?, ?, ?)',
      [sessionId, c.careerName, c.reasoning, order++]
    );
  }
  await pool.query('UPDATE career_sessions SET status = "CANDIDATES_READY" WHERE id = ?', [sessionId]);

  return listCandidates(sessionId);
}

// 학과·트랙·학번 기준 전체 교육과정에서 이미 이수한 과목명을 뺀, "아직 안 들은 과목" 닫힌
// 목록을 만든다. AI 로드맵은 이 목록 안에서만 고르게 하고, 목록 밖 응답은 그라운딩
// 안전망(아래 courseName 매칭)에서 걸러낸다.
async function getRemainingCourses(studentId, student) {
  const allCourses = await curriculumService.findCourses({
    departmentId: student.department_id,
    trackId: student.track_id || undefined,
    admissionYear: student.admission_year,
  });

  const [completedRows] = await pool.query('SELECT DISTINCT name FROM student_courses WHERE student_id = ?', [studentId]);
  const completedNames = new Set(completedRows.map((r) => r.name));

  return allCourses
    .filter((c) => !completedNames.has(c.courseName))
    .map((c) => ({ grade: c.grade, semester: c.semester, courseName: c.courseName, category: c.category, credits: c.credits }));
}

// 후보 중 하나를 진로로 확정하고, 남은 교육과정만으로 로드맵을 생성한다.
async function confirmCareer(studentId, sessionId, careerName, student) {
  const session = await findSessionRow(studentId, sessionId);
  if (!session) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });

  const candidates = await listCandidates(sessionId);
  const chosen = candidates.find((c) => c.careerName === careerName);
  if (!chosen) throw Object.assign(new Error('CAREER_CANDIDATE_NOT_FOUND'), { code: 'CAREER_CANDIDATE_NOT_FOUND' });

  const remainingCourses = await getRemainingCourses(studentId, student);
  const remainingByName = new Map(remainingCourses.map((c) => [c.courseName, c]));

  let roadmap = [];
  try {
    roadmap = await aiClient.generateCareerRoadmap(chosen.careerName, chosen.reasoning, remainingCourses, student);
  } catch {
    roadmap = [];
  }

  // 그라운딩 안전망: 목록에 실제로 있는 과목명만 남기고, 학년/학기/카테고리는 AI 응답이
  // 아니라 교육과정 원본 값을 그대로 쓴다(모델이 숫자를 잘못 옮겨 적을 수 있어서).
  const groundedItems = (Array.isArray(roadmap) ? roadmap : [])
    .filter((item) => remainingByName.has(item.courseName))
    .map((item) => {
      const source = remainingByName.get(item.courseName);
      return { grade: source.grade, semester: source.semester, courseName: source.courseName, reason: item.reason || null };
    });

  await pool.query('DELETE FROM career_roadmap_items WHERE session_id = ?', [sessionId]);
  let order = 0;
  for (const item of groundedItems) {
    await pool.query(
      'INSERT INTO career_roadmap_items (session_id, grade, semester, course_name, reason, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [sessionId, item.grade, item.semester, item.courseName, item.reason, order++]
    );
  }
  await pool.query('UPDATE career_sessions SET status = "CONFIRMED", confirmed_career = ? WHERE id = ?', [careerName, sessionId]);

  return listRoadmap(sessionId);
}

module.exports = {
  createSession,
  getSessionDetail,
  getLatestSessionDetail,
  submitFixedAnswers,
  updateFixedAnswers,
  postMessage,
  generateCandidates,
  confirmCareer,
};
