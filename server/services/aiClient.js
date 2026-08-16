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
근거 문서에서 답을 찾을 수 없으면 곧바로 "정확히 알 수 없습니다"라고 정중하게 답한 뒤
학사지원과(063-850-6788)에 직접 확인하라고 안내하라 — "좋은 질문입니다" 같은 형식적인
인사말이나 칭찬으로 시작하지 말고, 질문과 관련 없는 부가 정보를 늘어놓다가 뒤늦게 모른다고
밝히지 마라. 아는 것과 모르는 것을 먼저 명확히 구분한 뒤 간결하게 답하라. 근거 문서 안에
학사지원과 외의 다른 부서 전화번호(학과 사무실, 단과대학 교학과, 재무과 등)가 들어있어도
답변에서 전화번호를 안내할 때는 학사지원과(063-850-6788) 하나만 제시하라 — 여러 번호를
나열하면 학생이 어디로 전화해야 할지 헷갈린다. 비공식 참고용이라는 안내 문구는 화면에
별도로 표시되니 답변에 반복해서 넣지 마라.`;

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

// getGraduationStatus() 결과를 시스템 프롬프트에 심어서, "몇 학점 남았어?" 같은 개인화 질문에
// AI가 학칙 텍스트 일반론이 아니라 이 학생의 실제 이수 현황으로 답하게 한다. 이게 없으면 AI는
// 온보딩 프로필(학과/학번)만 알고 실제 이수과목/졸업요건 계산 결과는 전혀 몰라서 "구체적인 건
// 학사지원과에 문의하라"고 얼버무리는 문제가 있었다(실사용 확인, 2026-08-16) — 과목
// 관리/졸업요건 진단 쪽 로직(graduationService.js)이 챗봇과 완전히 분리된 경로였기 때문.
function buildGraduationStatusNote(graduationStatus) {
  if (!graduationStatus) return null;

  const { totalEarnedCredits, totalRequiredCredits, categories, certifications } = graduationStatus;
  const categoryLines = categories.map((c) => `  - ${c.category}: ${c.earnedCredits}/${c.requiredCredits}학점`).join('\n');
  const certLines = certifications
    .map((c) => `  - ${c.category}: ${c.satisfied ? '충족' : '미충족'} (${c.description})`)
    .join('\n');
  const remaining = Math.max(0, totalRequiredCredits - totalEarnedCredits);

  return `이 학생의 실제 이수 현황(학생이 과목 관리 화면에 직접 등록한 데이터 기준) — 근거
문서보다 이 데이터를 우선해서 "몇 학점 남았는지", "뭐가 부족한지" 같은 질문에 구체적인 숫자로
답하라. 이 데이터에 없는 내용(등록금, 수강신청 절차 등)에만 근거 문서를 사용하라.

총 이수학점: ${totalEarnedCredits}/${totalRequiredCredits}학점 (졸업까지 ${remaining}학점 남음)
카테고리별:
${categoryLines}
${certLines ? `졸업논문·졸업인증제:\n${certLines}` : ''}

주의:
- 전공필수(기본전공)와 전공선택은 학칙상 하나의 전공 요건(합산 학점)이다. 전공필수를 요건보다
  많이 들었으면 그 초과분이 전공선택 부족분을 상쇄한다고 설명하라 — 각각 독립된 요건인 것처럼
  말하지 마라.
- 일반선택은 학생이 따로 챙겨 들어야 하는 항목이 아니다 — 전공 초과 이수분이나 다른 이수
  과목으로 자동으로 채워진다. "일반선택 OO학점을 더 들어야 한다"고 안내하지 마라.
- 위 학점 수치는 상한이 적용된 값이라(예: 교양은 52학점까지만 인정) 학생이 실제로 들은 학점
  합계보다 작게 나올 수 있다 — 이는 정상이니 오류로 언급하지 마라.`;
}

function buildSystemPrompt(student, graduationStatus) {
  const parts = [SYSTEM_PROMPT, buildStudentProfileNote(student), buildGraduationStatusNote(graduationStatus)].filter(
    Boolean
  );
  return parts.join('\n\n');
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
async function getAIChatResponse(userMessage, relevantChunks, history = [], student = null, graduationStatus = null) {
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
      system: buildSystemPrompt(student, graduationStatus),
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

const CAREER_FOLLOWUP_SYSTEM_PROMPT = `너는 대학생의 진로를 함께 찾아주는 다정한 진로 상담사다.
학생이 방금 답한 내용에 짧게 공감한 뒤, 진로를 구체화하는 데 도움이 될 후속 질문을 딱 하나만 던져라.
실제 경험이나 구체적인 상황을 묻는 방식으로 하고, 질문 하나에 문장 1~2개를 넘기지 마라.
"좋은 질문이네요" 같은 형식적인 인사말로 시작하지 말고 바로 공감과 질문으로 들어가라.
아직 진로를 확정하거나 직업명을 나열하지 마라 — 지금은 질문만 한다.`;

const CAREER_CANDIDATES_SYSTEM_PROMPT = `너는 대학생의 진로를 추천하는 상담사다. 지금까지 나눈 대화를 바탕으로
이 학생에게 잘 맞을 만한 구체적인 진로(직업) 후보를 2~3개 제시하라.
학생의 전공과 관련 있으면서도 대화에서 실제로 드러난 성향·관심사에 근거해야 한다.
직업명은 뭉뚱그리지 말고 구체적으로 써라(예: "개발자"가 아니라 "백엔드 개발자").

정보가 부족해도 반드시 후보를 내야 한다 — "잘 모르겠다"는 답이 많았다면 그 자체(아직 방향을
못 정했다는 것)와 학생의 학과·전공을 근거 삼아 그 학과에서 가장 보편적인 진로들을 잠정적으로
제시하라. 정보 부족을 이유로 후보 제시를 거절하거나 되묻는 답을 하면 절대 안 된다.

그 외 설명이나 인사말 없이, 반드시 아래 JSON 배열 형식으로만 출력하라:
[{"careerName": "직업명", "reasoning": "학생의 어떤 답변(또는 학과)을 근거로 이 진로를 제시하는지 2~3문장"}]`;

const CAREER_ROADMAP_SYSTEM_PROMPT = `너는 대학생에게 진로에 맞는 수강 로드맵을 짜주는 상담사다.
반드시 사용자가 제공하는 "남은 교육과정 목록"에 있는 과목 중에서만 골라야 한다 — 목록에 없는
과목명을 지어내면 절대 안 된다. 이 학생이 목표 진로에 다가가는 데 도움이 될 과목을 4~8개 추천하라.
그 외 설명이나 인사말 없이, 반드시 아래 JSON 배열 형식으로만 출력하라(courseName은 목록에 있는
과목명과 정확히 똑같이 써라):
[{"grade": 3, "semester": 2, "courseName": "목록에 있는 정확한 과목명", "reason": "이 진로에 왜 도움이 되는지 1문장"}]`;

// 진로 상담 프롬프트(후속 질문/후보/로드맵) 전용 학생 프로필 — RAG 챗봇용 buildStudentProfileNote와
// 달리 "근거 문서" 관련 지시는 없고(진로 상담은 RAG 검색을 안 씀), 대신 학생을 "당신"으로
// 지칭하지 않도록 명시한다. 이름 정보를 안 주면 모델이 어색하게 "당신이 ~하셨다고" 식으로
// 쓰는 문제가 실사용으로 확인됨 — 이름 + "님"으로 부르게 한다.
// completedCourses: [{name, category}, ...] — 학생이 과목 관리에 실제로 등록해둔 이수 과목.
// "몇 학점 들었어?" 같은 질문에 "확인할 수 없다"고 답하는 문제(실사용 확인)를 막기 위해
// 참고 정보로 흘려보낸다. 다만 진로 판단 자체는 여전히 대화(성향·관심사)가 우선이라는
// 점을 같이 못박아, 다시 "이수 과목 분석형"으로 되돌아가지 않게 한다.
function buildCareerStudentNote(student, completedCourses) {
  if (!student) return null;

  const grade = getCurrentGrade(student.admission_year, student.leave_semesters);
  const parts = [
    `학과: ${student.department_name || '미상'}`,
    student.track_name ? `세부전공: ${student.track_name}` : null,
    grade ? `현재 학년: ${grade}학년` : null,
  ].filter(Boolean);

  const nameInstruction = student.name
    ? `학생을 2인칭으로 지칭할 때 "당신" 같은 표현은 절대 쓰지 마라 — "${student.name}님"처럼 이름에 "님"을 붙여 불러라.`
    : `학생을 2인칭으로 지칭할 때 "당신" 같은 표현은 쓰지 말고, 주어를 생략한 자연스러운 존댓말로 서술하라.`;

  const courseNote =
    completedCourses && completedCourses.length > 0
      ? `이 학생이 과목 관리에 등록한 이수 과목 — ${completedCourses.map((c) => `${c.name}(${c.category})`).join(', ')}.
학생이 자신이 들은 과목이나 이수 학점을 물으면 "확인할 수 없다"고 하지 말고 이 목록을 근거로 답하라.
다만 진로를 판단하는 주된 근거는 어디까지나 지금까지 나눈 대화(성향·관심사)다 — 이 목록은 학생이 직접
물었을 때 참고 답변용으로만 쓰고, 먼저 나서서 성적표 분석하듯 진로를 판단하지 마라.`
      : null;

  return [`이 학생의 프로필 — ${parts.join(', ')}.`, nameInstruction, courseNote].filter(Boolean).join('\n');
}

async function callClaude(system, messages, maxTokens = 500) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.AI_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ANTHROPIC_API_ERROR: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.content.map((block) => block.text).join('');
}

// 모델이 JSON 앞뒤로 ```json 코드펜스나 잡담을 붙이는 경우가 있어, 첫 '['부터 마지막 ']'까지만
// 잘라내 파싱한다. 실패하면 호출부가 빈 배열로 안전하게 폴백할 수 있도록 예외를 던진다.
function parseJsonArray(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('AI_RESPONSE_NOT_JSON_ARRAY');
  return JSON.parse(text.slice(start, end + 1));
}

// history: [{role: 'user'|'assistant', content}, ...] — 고정 질문 답변 + 자유 대화를 하나의
// 트랜스크립트로 이어 붙인 것. 마지막이 user 턴이어야 다음 assistant 질문을 생성할 수 있다.
async function getCareerFollowUp(history, student, completedCourses) {
  const studentNote = buildCareerStudentNote(student, completedCourses);
  const system = [CAREER_FOLLOWUP_SYSTEM_PROMPT, studentNote].filter(Boolean).join('\n\n');
  return callClaude(system, history, 300);
}

// 대화 이력을 종합해 진로 후보 2~3개를 뽑는다. 파싱 실패(모델이 JSON을 안 지켰을 때)는
// 호출부(careerService)가 빈 배열로 처리해 사용자에게 재시도를 안내할 수 있게 그대로 던진다.
//
// history는 항상 AI의 후속 질문(assistant 턴)으로 끝난다 — 학생이 아직 답하지 않은 상태에서
// "추천받기"를 누른 것이므로. Anthropic API에 그대로 넘기면 마지막 assistant 메시지를 새 턴이
// 아니라 "이어쓸 대상"으로 취급해 빈 응답을 반환하는 문제가 실측으로 확인됨 — 반드시 user
// 턴으로 대화를 마무리한 뒤 요청해야 한다.
async function generateCareerCandidates(history, student, completedCourses) {
  const studentNote = buildCareerStudentNote(student, completedCourses);
  const system = [CAREER_CANDIDATES_SYSTEM_PROMPT, studentNote].filter(Boolean).join('\n\n');
  const messages = [...history, { role: 'user', content: '여기까지의 대화를 바탕으로 진로 후보를 알려줘.' }];
  const text = await callClaude(system, messages, 800);
  return parseJsonArray(text);
}

// remainingCourses: [{grade, semester, courseName, category, credits}, ...] — 이 학생이
// 아직 안 들은 교육과정 과목만 담긴 닫힌 목록(careerService에서 계산). 이 목록 밖의 과목을
// 추천하면 careerService가 결과에서 걸러낸다(그라운딩 안전망).
async function generateCareerRoadmap(careerName, careerReasoning, remainingCourses, student) {
  const studentNote = buildCareerStudentNote(student);
  const system = [CAREER_ROADMAP_SYSTEM_PROMPT, studentNote].filter(Boolean).join('\n\n');
  const courseListText = remainingCourses
    .map((c) => `${c.grade}학년 ${c.semester}학기 - ${c.courseName} (${c.category}, ${c.credits}학점)`)
    .join('\n');
  const userContent = `목표 진로: ${careerName}\n추천 이유: ${careerReasoning}\n\n남은 교육과정 목록:\n${courseListText}`;
  const text = await callClaude(system, [{ role: 'user', content: userContent }], 1000);
  return parseJsonArray(text);
}

module.exports = {
  getAIChatResponse,
  rewriteSearchQuery,
  getCareerFollowUp,
  generateCareerCandidates,
  generateCareerRoadmap,
};
