const pool = require('../db');
const curriculumService = require('./curriculumService');
const curriculumContext = require('./curriculumContextService');
const regulationContext = require('./regulationContextService');
const { serviceGuideChunks } = require('./serviceGuide');

/**
 * server/services/chatContextService.js
 * 챗봇 한 번의 질문에 쓸 "근거 청크"를 모은다 — routes/chat.js에서 분리한 이유는 학번/학년도별로 어떤 데이터가
 * 조회되는지를 AI 호출 없이 테스트하기 위해서다. 연도 판단(yearContext)은 호출자가 한 번 정해서 넘기고,
 * 여기서는 모든 구조화 조회가 같은 yearContext를 쓴다(예전에는 조회마다 연도를 따로 읽어 서로 다른 연도를 썼다).
 *
 * 근거 우선순위(파트 3, DECISIONS D-31) — 앞쪽일수록 모델이 먼저 보고, 시스템 프롬프트도 같은 순서로 우선하라고 지시한다:
 *  ① 규정 판단 결과(regulationContextService: 이 학생에게 적용되는 규정·신뢰도·근거 조문 원문)
 *  ② 연도별 졸업요건·변경 이력·과목/요건 조회(구조화 데이터)
 *  ③ 직전 turn 인용 청크
 *  ④ RAG 검색 결과(학칙 원문 청크, 정리 문서, 교육과정 책자)
 * RAG가 ①과 같은 조문 원문을 또 가져오면 뺀다 — 같은 조문이 두 번 들어가면 판본 표시가 없는 쪽(RAG)이 판단과 다른
 * 근거처럼 보일 수 있어서다.
 */

// regulationJudgment: routes/chat.js가 RAG 검색 전에 미리 구한 판단(lookupRegulationJudgment 결과). 넘기지 않으면 여기서 구한다
// (테스트·다른 호출자 호환).
// progress: studentProgress.getStudentProgress 결과(이수 과목명 포함). "앞으로 들을 과목" 질문에서 개설 − 이수 청크(remaining)를 만드는 데 쓴다.
async function assembleStructuredChunks({ message, searchText, student, previousUserMessage, yearContext, regulationJudgment, progress = null }) {
  // 판단을 먼저 구한다 — 졸업요건 청크가 같은 판단 결과(입학유형 반영, 자료 없음 판정)의 값을 쓰기 때문이다(보정 라운드 A, D-35).
  const judgment = regulationJudgment !== undefined
    ? regulationJudgment
    : await regulationContext.lookupRegulationJudgment({ message, student, yearContext });
  const [graduation, history, curriculum, requirement, offeringResult, linkedMajor, microDegree] = await Promise.all([
    curriculumContext.lookupGraduationRequirements({ message, student, yearContext, judgment: judgment ? judgment.judgment : null }),
    curriculumContext.lookupChangeHistory({ message, contextText: previousUserMessage, student, yearContext }),
    curriculumService.lookupFromMessage(message, student, yearContext),
    curriculumService.lookupRequirementsFromMessage(searchText || message, student, yearContext),
    curriculumService.lookupOfferingChunks(message, student, yearContext, { completedCourseNames: progress ? progress.completedCourseNames : [] }),
    curriculumService.lookupLinkedMajorsFromMessage(message),
    curriculumService.lookupMicroDegreesFromMessage(message),
  ]);
  const regulation = judgment ? judgment.chunks : [];
  const [second, medical] = await Promise.all([
    secondMajorChunks({ message, student, yearContext, progress }),
    medicalSchoolChunks({ message, student, yearContext, progress }),
  ]);
  return {
    regulation, judgment: judgment ? judgment.judgment : null, graduation, history,
    curriculum: [...curriculum, ...second.curriculum, ...medical.curriculum], requirement,
    offering: [...offeringResult.offering, ...second.offering, ...medical.offering],
    remaining: [...offeringResult.remaining, ...second.remaining, ...medical.remaining],
    linkedMajor, microDegree,
    service: serviceGuideChunks(message),
  };
}

// "내 복수전공 과목 뭐 들어?"처럼 학과 이름 없이 제2전공을 말하면 과목·개설 조회가 주전공 학과만 봐서, 챗봇이 "제2전공 학과 과목 목록이
// 근거에 없다"고 답했다(2026-10-17 로컬 재현). 다전공 학생이 복수전공·부전공을 말하면 제2전공 학과로도 같은 조회를 한다.
const SECOND_MAJOR_RE = /복수\s*전공|복전|부\s*전공|제\s*2\s*전공|다전공/;
async function secondMajorChunks({ message, student, yearContext, progress }) {
  const empty = { curriculum: [], offering: [], remaining: [] };
  if (!student) return empty;
  // 연계·복합전공 학생(#412)이 "내 연계전공 과목"처럼 전공 이름 없이 물으면 그 전공의 과목 목록을 근거로 넣는다.
  if (student.second_department_id == null && student.second_linked_major) {
    if (!SECOND_MAJOR_RE.test(message || '') && !/연계|복합\s*전공/.test(message || '')) return empty;
    return { ...empty, curriculum: await curriculumService.lookupLinkedMajorsFromMessage(student.second_linked_major) };
  }
  if (student.second_department_id == null || !SECOND_MAJOR_RE.test(message || '')) return empty;
  // 제2전공 학과 기준으로 조회한다 — 세부전공(트랙)은 주전공 것이라 뺀다. 학번은 그대로(제2전공도 같은 학번의 편성을 따른다).
  const asSecond = { ...student, department_id: student.second_department_id, department_name: student.second_department_name, track_id: null, track_name: null };
  const [curriculum, offering] = await Promise.all([
    curriculumService.lookupFromMessage(message, asSecond, yearContext),
    curriculumService.lookupOfferingChunks(message, asSecond, yearContext, { completedCourseNames: progress ? progress.completedCourseNames : [] }),
  ]);
  return { curriculum, offering: offering.offering, remaining: offering.remaining };
}

// 예과 학생이 앞으로 들을 과목을 물었는데 다음 수강 학기가 본과로 넘어가면(studentProgress.markMedicalSchoolTerms), 주전공(예과) 조회만으로는
// 그 학기 과목이 근거에 없다 — 본과 학과로도 같은 조회를 한다(#412, 예과 2학년 다음 학기). 세부전공은 없고 학번은 그대로다.
async function medicalSchoolChunks({ message, student, yearContext, progress }) {
  const empty = { curriculum: [], offering: [], remaining: [] };
  const term = progress && (progress.upcomingTerms || []).find((t) => t.medicalSchool);
  if (!student || !term || !yearContext || yearContext.questionIntent !== 'NEXT_TERM_PLANNING') return empty;
  const [[dept]] = await pool.query('SELECT id, name FROM departments WHERE name = ?', [term.medicalSchool.departmentName]);
  if (!dept) return empty;
  const asMedical = { ...student, department_id: dept.id, department_name: dept.name, track_id: null, track_name: null };
  const [curriculum, offering] = await Promise.all([
    curriculumService.lookupFromMessage(message, asMedical, yearContext),
    curriculumService.lookupOfferingChunks(message, asMedical, yearContext, { completedCourseNames: progress.completedCourseNames || [] }),
  ]);
  return { curriculum, offering: offering.offering, remaining: offering.remaining };
}

/**
 * RAG 청크가 판단 쪽 조문 원문과 같은 조문인가. RAG 원문 문서 제목은 "원광대학교 학칙 전문"/"원광대학교 학칙시행규칙 전문"이고
 * 원문 청크는 조 단위라 "제13조(…"로 시작한다. 제목은 완전 일치로 본다 — "학칙"이 "학칙시행규칙"에 포함돼 부분 일치는 틀린다.
 */
function duplicatesJudgedArticle(chunk, articleChunks) {
  const text = String(chunk.content || '').trimStart();
  return articleChunks.some((a) => chunk.documentTitle === a.ragDocumentTitle && text.startsWith(`${a.articleKey}(`));
}

// 구조화 근거 + 직전 turn 인용 + RAG 검색 결과를 하나의 목록으로 합친다(chunkId 중복 제거).
// 직전 turn 청크 중 다른 해 책자의 것은 이번 질문의 학년도와 섞이지 않도록 뺀다.
// previousHistory: 직전 질문으로 다시 만든 변경 이력 청크(routes/chat.js). 이번 질문의 이력 바로 뒤에 두고, 같은 청크는 한 번만 넣는다.
function mergeChunks({ structured, previousHistory = [], previousCitedChunks = [], freshChunks = [], yearContext }) {
  const allowedBookYears = new Set(yearContext.bookYears);
  const previous = previousCitedChunks.filter((c) => c.bookYear == null || allowedBookYears.size === 0 || allowedBookYears.has(c.bookYear));
  const regulation = structured.regulation || [];
  const articleChunks = regulation.filter((c) => c.articleKey);
  const fresh = freshChunks.filter((c) => !duplicatesJudgedArticle(c, articleChunks));

  const merged = [];
  const seen = new Set();
  for (const c of [
    ...regulation,
    ...structured.graduation,
    ...structured.history,
    ...previousHistory,
    ...structured.curriculum,
    ...structured.requirement,
    // 개설 − 이수 목록이 개설 목록보다 먼저: 같은 학기의 "아직 안 들은 과목"이 모델에 먼저 보이게(remaining이 없는 호출도 있다).
    ...(structured.remaining || []),
    ...structured.offering,
    ...structured.linkedMajor,
    ...structured.microDegree,
    // 서비스(ONE Student) 기능 안내 — 학칙과 겹치지 않아 순서는 중요하지 않다. 서비스 질문에 다른 근거가 없어도 답할 수 있게 넣는다.
    ...(structured.service || []),
    ...previous,
    ...fresh,
  ]) {
    if (seen.has(c.chunkId)) continue;
    seen.add(c.chunkId);
    merged.push(c);
  }
  return merged;
}

module.exports = { assembleStructuredChunks, mergeChunks };
