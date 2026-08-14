/**
 * server/services/aiClient.js
 * Claude Haiku 4.5 (Anthropic Messages API) 클라이언트.
 * 근거: 위키 API-설계 3장 - https://github.com/ONE-Student-wku/web/wiki/API-설계
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT = `너는 원광대학교 학생의 학사 규정 질문에 답하는 챗봇이다.
아래 "근거 문서"에 제공된 내용만 근거로 답변하고, 임의로 해석하거나 추측하지 마라.
근거 문서에서 답을 찾을 수 없으면 곧바로 "정확히 모른다"고 답한 뒤 학사지원과(063-850-6788)에
직접 확인하라고 안내하라 — "좋은 질문입니다" 같은 형식적인 인사말이나 칭찬으로 시작하지 말고,
질문과 관련 없는 부가 정보를 늘어놓다가 뒤늦게 모른다고 밝히지 마라. 아는 것과 모르는 것을
먼저 명확히 구분한 뒤 간결하게 답하라. 비공식 참고용이라는 안내 문구는 화면에 별도로 표시되니
답변에 반복해서 넣지 마라.`;

const ENROLLMENT_TYPE_LABEL = { GENERAL: '일반 재학생', TRANSFER_ADMISSION: '편입생', MAJOR_CHANGE: '전과생' };

// client/src/utils/academic.js의 getGradeLevel과 동일한 공식(2학기당 1년 보정) — 서버는
// 브라우저 모듈을 못 불러오니 그대로 옮겨둠. 둘 중 하나만 고치면 어긋나므로 같이 수정할 것.
function getCurrentGrade(admissionYear, leaveSemesters) {
  if (!admissionYear) return null;
  const currentYear = new Date().getFullYear();
  const leaveYears = Math.floor((leaveSemesters || 0) / 2);
  return Math.min(4, Math.max(1, currentYear - admissionYear - leaveYears + 1));
}

// 근거 문서(RAG 검색 결과)는 학번별로 기준이 갈리는 표를 그대로 담고 있을 수 있는데, 정작
// 모델은 "이 학생이 몇 학번인지" 전혀 모른 채 답을 골라야 했다 — 그래서 22학번 학생에게
// 2026학번 표를 그대로 답하는 문제가 실사용으로 확인됨. 학생 프로필(온보딩 정보)을 시스템
// 프롬프트에 명시해 반드시 이 학생 학번 기준을 우선 적용하도록 못박는다.
function buildStudentProfileNote(student) {
  if (!student || !student.admission_year) return null;

  const grade = getCurrentGrade(student.admission_year, student.leave_semesters);
  const parts = [
    `학과: ${student.department_name || '미상'}`,
    `입학년도: ${student.admission_year}학번`,
    student.track_name ? `세부전공: ${student.track_name}` : null,
    `입학유형: ${ENROLLMENT_TYPE_LABEL[student.enrollment_type] || '미상'}`,
    grade ? `현재 학년: ${grade}학년 (누적 휴학 ${student.leave_semesters || 0}학기 반영)` : null,
  ].filter(Boolean);

  return `이 학생의 프로필 — ${parts.join(', ')}.
근거 문서에 학번/입학년도별로 기준이 나뉘어 있으면 반드시 이 학생의 학번(${student.admission_year}학번) 기준을 우선 적용해서 답하라.
근거 문서에 이 학생의 학번에 해당하는 내용이 없고 다른 학번 기준만 있다면, 그 문서가 어느 학번 기준인지 명시하면서
"정확히 이 학번 기준 자료는 못 찾았다"고 분명히 밝혀라 — 다른 학번 기준을 이 학생에게 그대로 적용해 단정적으로 답하지 마라.`;
}

function buildSystemPrompt(student) {
  const profileNote = buildStudentProfileNote(student);
  return profileNote ? `${SYSTEM_PROMPT}\n\n${profileNote}` : SYSTEM_PROMPT;
}

const QUERY_REWRITE_SYSTEM_PROMPT = `너는 원광대학교 학생의 캐주얼한 질문을 학사 규정 검색에 적합한
정식 용어 질문으로 바꿔주는 도우미다. 학생이 쓴 줄임말·은어·비격식 표현을 원광대학교 공식
학사 용어로 풀어써라. 예: "겜콘" → "게임콘텐츠학전공", "복전" → "복수전공", "컴공" → "컴퓨터·소프트웨어공학".
질문의 의미나 의도는 절대 바꾸지 말고, 검색어로 쓸 짧은 문장 하나만 출력하라. 인사말, 설명, 따옴표 없이
문장만 출력하라. 이미 정식 용어로 되어 있으면 그대로 출력하라.`;

// 임베딩 검색 직전에 한 번 더 호출해 캐주얼한 질문을 정식 용어로 정규화한다. "겜콘"처럼 원문
// 문서에 없는 줄임말은 임베딩 유사도가 안 맞아 검색이 실패하는데, 문서마다 동의어를 일일이
// 심어두는 방식은 학생들이 쓸 모든 표현을 못 따라가서 확장성이 없다 — Claude가 이미 아는
// 일반 상식(은어/줄임말)을 활용해 검색어만 자동으로 정규화하는 편이 훨씬 일반적으로 통한다.
// 실패해도 검색 자체가 막히면 안 되므로 원문 그대로 폴백한다.
async function rewriteSearchQuery(rawQuery) {
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.AI_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 100,
        system: QUERY_REWRITE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: rawQuery }],
      }),
    });

    if (!res.ok) return rawQuery;

    const data = await res.json();
    const rewritten = data.content.map((block) => block.text).join('').trim();
    return rewritten || rawQuery;
  } catch {
    return rawQuery;
  }
}

// history: 이번 메시지 이전까지의 대화 이력 [{role, content}, ...] — "왜 그래?" 같은 후속
// 질문이 직전 turn을 참고할 수 있도록 Anthropic Messages API의 멀티턴 형식으로 그대로 넘긴다.
async function getAIChatResponse(userMessage, relevantChunks, history = [], student = null) {
  const context = relevantChunks
    .map((c, i) => `[문서 ${i + 1}] ${c.documentTitle}\n${c.content}`)
    .join('\n\n');

  const userContent = `근거 문서:\n${context}\n\n학생 질문: ${userMessage}`;
  const messages = [...history, { role: 'user', content: userContent }];

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.AI_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(student),
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ANTHROPIC_API_ERROR: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.content.map((block) => block.text).join('');
}

module.exports = {
  getAIChatResponse,
  rewriteSearchQuery,
};
