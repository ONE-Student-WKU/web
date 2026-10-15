const pool = require('../db');
const aiClient = require('./aiClient');
const { buildAnswersUpdate, currentFixedAnswers, historyForAi, diffFixedAnswers } = require('./careerAnswerUpdates');
const curriculumService = require('./curriculumService');
const { hasRecentCrisis } = require('./crisis');
const { buildCompletedNameSet, isCompleted } = require('./courseNameMatch');
const { syllabusSearchUrl } = require('./syllabusLink');

/**
 * server/services/careerService.js
 * 진로 탐색(상담형) — 고정 질문 답변 + 자유 대화를 career_messages에 하나의 트랜스크립트로
 * 쌓고, 대화를 종합해 진로 후보를 뽑은 뒤, 확정된 진로에 맞춰 아직 안 들은 과목으로만
 * 로드맵을 구성한다(career_roadmap_items — curriculum_courses에 실제로 있는 과목만 저장).
 */

// 상담 한 번의 크기 — 화면의 "3~5분만 대화하고 추천받기" 흐름(보통 자유 대화 6~10번)보다 넉넉하게 잡은 상한이다.
// 매 AI 호출에 그 상담의 대화 전체가 실리므로, 이 상한이 곧 호출 한 번의 크기와 상담 한 번의 호출 수를 묶는다.
// 횟수 검사는 "세고 → 저장"이라 같은 사용자의 동시 요청은 라우트(routes/career.js)가 한 번에 하나씩만 받는다.
const FIXED_QUESTION_COUNT = 5; // client/src/pages/CareerExploration.jsx의 FIXED_QUESTIONS 개수
const MAX_FREE_TURNS = 15;
const MAX_CANDIDATE_REQUESTS = 3;
const MAX_SESSIONS_PER_DAY = 3; // "다시 진단하기"로 새 상담을 열어 위 상한을 피하지 못하게

async function createSession(studentId) {
  const [[{ count }]] = await pool.query(
    'SELECT COUNT(*) AS count FROM career_sessions WHERE student_id = ? AND created_at >= CURDATE()',
    [studentId]
  );
  if (count >= MAX_SESSIONS_PER_DAY) throw Object.assign(new Error('CAREER_DAILY_SESSION_LIMIT'), { code: 'CAREER_DAILY_SESSION_LIMIT' });

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

// "다시 진단하기"로 새 세션을 시작하면 예전에 확정한 진로/로드맵은 더 이상 "최근 세션"이
// 아니게 되어 화면에서 아예 접근할 방법이 없어졌다(실사용 피드백) — 세션 상태와 무관하게
// "가장 최근에 확정한 세션"만 따로 찾아 프로필 등에서 다시 볼 수 있게 한다.
async function findLatestConfirmedSessionRow(studentId) {
  const [rows] = await pool.query(
    'SELECT id, confirmed_career FROM career_sessions WHERE student_id = ? AND status = "CONFIRMED" ORDER BY id DESC LIMIT 1',
    [studentId]
  );
  return rows[0] || null;
}

async function getLatestConfirmedRoadmap(studentId) {
  const latest = await findLatestConfirmedSessionRow(studentId);
  if (!latest) return null;

  const roadmap = await listRoadmap(latest.id);
  return { confirmedCareer: latest.confirmed_career, roadmap };
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
  const codes = await courseCodesForSession(sessionId, rows.map((r) => r.course_name));
  return rows.map((r) => ({
    grade: r.grade,
    semester: r.semester,
    courseName: r.course_name,
    reason: r.reason,
    syllabusUrl: syllabusSearchUrl(codes.get(r.course_name), r.semester),
  }));
}

// 로드맵 항목에는 학수번호가 저장돼 있지 않아(career_roadmap_items), 보여 줄 때 학생 학과의 편성표에서 과목명으로 찾는다.
// 이렇게 하면 이미 만들어진 로드맵에도 수업계획서 링크가 붙는다. 같은 이름이 여러 학번 범위에 있으면 가장 최근 편성의 학수번호를 쓴다
// (로드맵 후보도 가장 최근 편성에서 고른다 — D-56). 못 찾으면 링크 없이 둔다.
async function courseCodesForSession(sessionId, courseNames) {
  const codes = new Map();
  if (courseNames.length === 0) return codes;
  const [rows] = await pool.query(
    `SELECT cc.course_name, cc.course_code
     FROM career_sessions cs
     JOIN students s ON s.id = cs.student_id
     JOIN curriculum_courses cc ON cc.department_id = s.department_id
     WHERE cs.id = ? AND cc.course_name IN (?) AND cc.course_code IS NOT NULL AND cc.course_code <> ''
     ORDER BY COALESCE(cc.max_admission_year, 9999) DESC, COALESCE(cc.min_admission_year, 0) DESC`,
    [sessionId, courseNames]
  );
  for (const r of rows) if (!codes.has(r.course_name)) codes.set(r.course_name, r.course_code);
  return codes;
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

// 채팅이 시작된 뒤 처음 고정 질문 답변을 고친다(이슈 #245, #378 결정 14-1 C·14-2 A·14-3 A — careerAnswerUpdates.js).
// 원래 답은 덮어쓰지 않고 바뀐 내용을 학생 메시지 하나로 기록한 뒤, AI가 바로 한 번 응답한다.
//  - CONTINUE: 지금까지의 대화에 이어서, 바뀐 답을 반영한 응답
//  - RESTART: 같은 상담 안에서 그 기록 이후를 새 대화로 보고, 바뀐 답으로 첫 질문을 다시 받는다(이전 대화는 지우지 않는다)
// 기록 메시지는 학생 메시지라 자유 대화 한도에 들어간다. 바뀐 답이 없으면 아무것도 하지 않는다(AI 호출 없음).
async function updateFixedAnswers(studentId, sessionId, fixedAnswers, mode, student, language = 'ko') {
  const session = await findSessionRow(studentId, sessionId);
  if (!session) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });

  const messages = await listMessages(sessionId);
  if (messages.length < fixedAnswers.length * 2) {
    throw Object.assign(new Error('FIXED_ANSWERS_NOT_FOUND'), { code: 'FIXED_ANSWERS_NOT_FOUND' });
  }

  const changes = diffFixedAnswers(currentFixedAnswers(messages, FIXED_QUESTION_COUNT), fixedAnswers);
  if (changes.length === 0) return messages;

  const userCount = messages.filter((m) => m.role === 'user').length;
  if (userCount >= FIXED_QUESTION_COUNT + MAX_FREE_TURNS) throw Object.assign(new Error('CAREER_TURN_LIMIT'), { code: 'CAREER_TURN_LIMIT' });

  await saveMessage(sessionId, 'user', buildAnswersUpdate(mode, changes, fixedAnswers.map((a) => a.answer)));
  const [history, completedCourses] = await Promise.all([listMessages(sessionId), getCompletedCourses(studentId)]);
  const followUp = await aiClient.getCareerFollowUp(historyForAi(history, FIXED_QUESTION_COUNT), student, completedCourses, language);
  await saveMessage(sessionId, 'assistant', followUp);

  return listMessages(sessionId);
}

// 고정 질문(프론트 하드코딩) 답변을 assistant(질문)/user(답변) 턴으로 이어 붙여 대화 이력의
// 시작 부분을 채우고, 이어서 AI의 첫 자유 대화 질문을 생성한다.
async function submitFixedAnswers(studentId, sessionId, fixedAnswers, student, language = 'ko') {
  const session = await findSessionRow(studentId, sessionId);
  if (!session) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });

  // 처음 제출은 상담당 한 번이다. 대화가 시작된 뒤 다시 받으면 같은 답이 기록에 계속 쌓여 AI 호출이 커진다(수정은 PATCH).
  // 단, 이전 제출이 고정 답변만 저장하고 AI 단계에서 실패한 경우(같은 질문 쌍만 있고 AI 질문은 없음)는 재시도로 보고 다시 받는다.
  const existing = await listMessages(sessionId);
  if (existing.length > 0) {
    const isFailedSubmitRetry =
      existing.length === fixedAnswers.length * 2 && fixedAnswers.every((a, i) => existing[i * 2].content === a.question);
    if (!isFailedSubmitRetry) throw Object.assign(new Error('FIXED_ANSWERS_ALREADY_SUBMITTED'), { code: 'FIXED_ANSWERS_ALREADY_SUBMITTED' });
    await pool.query('DELETE FROM career_messages WHERE session_id = ?', [sessionId]);
  }

  for (const { question, answer } of fixedAnswers) {
    await saveMessage(sessionId, 'assistant', question);
    await saveMessage(sessionId, 'user', answer || '(잘 모르겠어요, 건너뜀)');
  }

  const [history, completedCourses] = await Promise.all([listMessages(sessionId), getCompletedCourses(studentId)]);
  const followUp = await aiClient.getCareerFollowUp(history, student, completedCourses, language);
  await saveMessage(sessionId, 'assistant', followUp);

  return listMessages(sessionId);
}

// 자유 대화 한 턴 — 사용자 메시지를 저장하고, 이어서 AI의 다음 질문을 저장한다.
async function postMessage(studentId, sessionId, content, student, language = 'ko') {
  const session = await findSessionRow(studentId, sessionId);
  if (!session) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });

  const [[{ count }]] = await pool.query("SELECT COUNT(*) AS count FROM career_messages WHERE session_id = ? AND role = 'user'", [sessionId]);
  if (count >= FIXED_QUESTION_COUNT + MAX_FREE_TURNS) throw Object.assign(new Error('CAREER_TURN_LIMIT'), { code: 'CAREER_TURN_LIMIT' });

  await saveMessage(sessionId, 'user', content);
  const [history, completedCourses] = await Promise.all([listMessages(sessionId), getCompletedCourses(studentId)]);
  const followUp = await aiClient.getCareerFollowUp(historyForAi(history, FIXED_QUESTION_COUNT), student, completedCourses, language);
  await saveMessage(sessionId, 'assistant', followUp);

  return listMessages(sessionId);
}

// 지금까지의 대화를 종합해 진로 후보를 뽑는다. "더 이야기해볼게요"로 되돌아갔다가 다시
// 요청하는 경우를 대비해 이전 후보는 지우고 새로 채운다.
async function generateCandidates(studentId, sessionId, student, language = 'ko') {
  const session = await findSessionRow(studentId, sessionId);
  if (!session) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });

  const history = await listMessages(sessionId);
  // 최근 대화에 위기 신호가 있으면 직업 후보를 내밀지 않고 도움 안내로 대신한다(AI 호출 없음 — services/crisis.js 참고).
  if (hasRecentCrisis(history)) {
    throw Object.assign(new Error('CAREER_CRISIS_DETECTED'), { code: 'CAREER_CRISIS_DETECTED' });
  }
  // 추천받기는 상담당 MAX_CANDIDATE_REQUESTS번. 후보를 못 만든 시도(CAREER_CANDIDATES_EMPTY — 대화가 부족함)는 되돌려 준다.
  const [claim] = await pool.query(
    'UPDATE career_sessions SET candidate_requests = candidate_requests + 1 WHERE id = ? AND candidate_requests < ?',
    [sessionId, MAX_CANDIDATE_REQUESTS]
  );
  if (claim.affectedRows === 0) throw Object.assign(new Error('CAREER_CANDIDATE_LIMIT'), { code: 'CAREER_CANDIDATE_LIMIT' });

  const completedCourses = await getCompletedCourses(studentId);
  // 정보가 아주 적을 때 모델이 JSON 대신 되묻는 문장을 낼 수 있어(프롬프트로 최대한
  // 막아뒀지만 100% 보장은 안 됨) 파싱 실패도 "후보 없음"과 동일하게 다뤄, 500 대신
  // 사용자가 이해할 수 있는 CAREER_CANDIDATES_EMPTY로 수렴시킨다.
  let candidates;
  try {
    candidates = await aiClient.generateCareerCandidates(historyForAi(history, FIXED_QUESTION_COUNT), student, completedCourses, language);
  } catch {
    candidates = [];
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    await pool.query('UPDATE career_sessions SET candidate_requests = candidate_requests - 1 WHERE id = ?', [sessionId]);
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
// 앞으로 들을 과목이므로 입학한 해의 편성이 아니라 지금 적용되는 편성(그 학과의 가장 최근 편성)에서 고른다 — 원광대는 개편된
// 교육과정을 그 전 학번에도 적용해서, 입학 당시 편성에는 이미 폐설된 과목이 남아 있다(curriculumService.resolveCourseListYear).
async function getRemainingCourses(studentId, student) {
  const departmentId = student.department_id;
  const trackId = student.track_id || undefined;
  const admissionYear = await curriculumService.resolveCourseListYear({ departmentId, trackId, admissionYear: student.admission_year });
  const allCourses = await curriculumService.findCourses({ departmentId, trackId, admissionYear });

  const [completedRows] = await pool.query('SELECT DISTINCT name FROM student_courses WHERE student_id = ?', [studentId]);
  const [lineageRows] = await pool.query(
    'SELECT from_name, to_name FROM course_lineage WHERE from_name IS NOT NULL AND to_name IS NOT NULL AND (department_id = ? OR department_id IS NULL)',
    [departmentId]
  );
  // 편성표와 학생이 등록한 이름이 띄어쓰기·구두점만 다른 경우가 있어(최신 편성에서 표기가 바뀐 과목 등) 정규화해 비교한다.
  const completedNameSet = buildCompletedNameSet(withSuccessorNames(completedRows.map((r) => r.name), lineageRows));

  return allCourses
    .filter((c) => !isCompleted(c.courseName, completedNameSet))
    .map((c) => ({ grade: c.grade, semester: c.semester, courseName: c.courseName, category: c.category, credits: c.credits }));
}

// 최신 편성에는 학수번호까지 바뀐 과목이 있다(예: 컴소공 C언어및실습 → C언어프로그래밍). 이름 비교만으로는 옛 과목을 들은 학생에게
// 새 과목을 다시 추천하므로, course_lineage(옛 이름 → 새 이름)를 따라 이수한 과목의 후속 이름도 이수한 것으로 본다. 여러 번 바뀐 경우도 끝까지 따라간다.
function withSuccessorNames(names, lineageRows) {
  const result = new Set(names);
  let added = true;
  while (added) {
    added = false;
    const done = buildCompletedNameSet([...result]);
    for (const { from_name: from, to_name: to } of lineageRows) {
      if (!result.has(to) && isCompleted(from, done)) {
        result.add(to);
        added = true;
      }
    }
  }
  return [...result];
}

// AI 로드맵 응답을 교육과정 원본 값으로 접지(grounding)한다 — 목록에 실제로 있는 과목만 남기고, 학년/학기는 AI 응답이
// 아니라 교육과정 원본 값을 쓴다(모델이 숫자를 잘못 옮겨 적을 수 있어서). 모델이 "데이터베이스 (심화, 3학점)"처럼 목록 모양의 괄호를
// 과목명 뒤에 붙여 오는 경우가 있어, 정확히 일치하지 않으면 끝의 "(…학점)"을 떼고 한 번 더 찾는다. 같은 과목이 두 번 오면 한 번만 담고,
// 화면이 학년·학기 순으로 읽히게 정렬한다(모델은 순서를 뒤섞어 내는 경우가 있다).
function groundRoadmapItems(roadmap, remainingCourses) {
  const remainingByName = new Map(remainingCourses.map((c) => [c.courseName, c]));
  const seen = new Set();
  const items = [];
  for (const item of Array.isArray(roadmap) ? roadmap : []) {
    if (!item || typeof item.courseName !== 'string') continue;
    const name = item.courseName.trim();
    const source = remainingByName.get(name) || remainingByName.get(name.replace(/\s*\([^()]*학점\)\s*$/, '').trim());
    if (!source || seen.has(source.courseName)) continue;
    seen.add(source.courseName);
    items.push({ grade: source.grade, semester: source.semester, courseName: source.courseName, reason: item.reason || null });
  }
  const semesterOrder = (v) => parseInt(String(v), 10) || 0;
  return items.sort((a, b) => a.grade - b.grade || semesterOrder(a.semester) - semesterOrder(b.semester));
}

// 후보 중 하나를 진로로 확정하고, 남은 교육과정만으로 로드맵을 생성한다.
async function confirmCareer(studentId, sessionId, careerName, student, language = 'ko') {
  const session = await findSessionRow(studentId, sessionId);
  if (!session) throw Object.assign(new Error('SESSION_NOT_FOUND'), { code: 'SESSION_NOT_FOUND' });
  // 확정(로드맵 AI 호출)은 추천을 받을 때마다 한 번 — 이미 확정했으면 다시 추천받아야 한다.
  if (session.status !== 'CANDIDATES_READY') throw Object.assign(new Error('CAREER_NOT_READY_TO_CONFIRM'), { code: 'CAREER_NOT_READY_TO_CONFIRM' });

  const candidates = await listCandidates(sessionId);
  const chosen = candidates.find((c) => c.careerName === careerName);
  if (!chosen) throw Object.assign(new Error('CAREER_CANDIDATE_NOT_FOUND'), { code: 'CAREER_CANDIDATE_NOT_FOUND' });

  const remainingCourses = await getRemainingCourses(studentId, student);

  let roadmap = [];
  try {
    roadmap = await aiClient.generateCareerRoadmap(chosen.careerName, chosen.reasoning, remainingCourses, student, language);
  } catch {
    roadmap = [];
  }

  // 그라운딩 안전망 — 위 groundRoadmapItems 참고.
  const groundedItems = groundRoadmapItems(roadmap, remainingCourses);

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
  getLatestConfirmedRoadmap,
  submitFixedAnswers,
  updateFixedAnswers,
  postMessage,
  generateCandidates,
  confirmCareer,
  groundRoadmapItems,
  getRemainingCourses,
  withSuccessorNames,
};
