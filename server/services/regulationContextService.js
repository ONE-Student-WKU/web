const pool = require('../db');
const { resolveApplicableRulesForStudent, inputFromStudentRow } = require('./regulationEngine');
const { resolveDepartment, schedule4Line } = require('./curriculumContextService');
const { getDepartmentChain } = require('./curriculumHistoryService');
const { dbDateToIso } = require('./regulationEngine/context');

/**
 * server/services/regulationContextService.js
 * 챗봇 근거 청크 중 "규정 판단 결과"를 만든다 — 규정 판단 엔진(resolveApplicableRules)이 이 학생에게 기준일에 적용된다고
 * 판단한 규정·근거 조문·변경 기록·신뢰도를 사람이 읽는 문장으로 바꿔 **최우선 근거**로 넣는다.
 *
 * 왜 별도 청크로 넣는가: 예전 챗봇은 학칙 조문을 RAG 유사도로만 찾았다. 그러면 "이 조문이 이 학생에게 적용되나"는
 * 모델이 추측해야 하고, 근거가 약한 구간에서도 그럴듯하게 단정한다(RISKS R-05). 판단은 코드가 하고, 모델은 판단 결과를
 * 설명만 하게 한다. 신뢰도별 "답변 지침"을 청크 본문에 함께 넣는 이유는 AI 호출 없이도(테스트에서) 단정 금지 지시가
 * 실제 근거에 들어갔는지 확인할 수 있게 하기 위해서다.
 *
 * 순수 포맷터(formatJudgmentChunks)와 DB 조회(lookupRegulationJudgment)를 나눴다 — 포맷은 DB 없이 테스트한다.
 */

// 규정·학사 판단이 필요한 질문일 때만 판단 청크를 넣는다. 아무 질문에나 넣으면 "관련 규정 없음" 안내(NOT_FOUND)가
// 사라지고 무관한 질문에도 규정 문단이 붙는다.
const REGULATION_QUESTION_RE = /경과조치|적용|이수|필수|선택|폐지|폐설|없어졌|전과|편입|개편|학칙|규정|졸업|면제|들어야|안\s*들어도|학점|요건|기준|인정|바뀌|바뀐/;

const DOC_LABEL = { ENFORCEMENT_RULES: '학칙시행규칙', ACADEMIC_REGULATIONS: '학칙', CLASS_MANAGEMENT: '수업관리규정' };
const ENROLLMENT_LABEL = { GENERAL: '일반 재학생', TRANSFER_ADMISSION: '편입생', MAJOR_CHANGE: '전과생' };
const STATUS_LABEL = { APPLIES: '적용', CONDITIONAL: '조건부', UNKNOWN: '판단 불가(자료 부족)' };
const ACADEMIC_OFFICE = '학사지원과(063-850-5228)';
const CONFIDENCE_LABEL = { CONFIRMED: '확정', ESTIMATED: '추정', INSUFFICIENT: '자료 불충분(확인 필요)', NO_DATA: '자료없음' };
const MAX_COURSE_NAMES = 5;
const MAX_ARTICLE_CHUNKS = 4;
const MAX_ARTICLE_CHARS = 1200;

// 신뢰도별 답변 지침 — 확정이 아니면 단정 금지를 명시한다(평가 세트가 이 문구를 검사한다).
// 전체 신뢰도는 "가장 낮은 항목" 기준이라, 지침은 항목별로 적용하게 쓴다 — 예: 과목 자료가 C등급이라 전체가 "자료 불충분"이어도
// 졸업학점 표(확정)까지 얼버무리면 오히려 틀린 안내가 된다. 신뢰도가 낮은 항목만 단정하지 않게 한다.
const ANSWER_GUIDE = {
  CONFIRMED: '아래 규정 판단은 모두 보유한 규정 원문과 검수된 자료로 확인된 것이다. 근거 조문을 함께 밝혀 답하라.',
  ESTIMATED: `아래 항목 중 신뢰도가 "추정"인 것은 단정하지 마라 — "추정"이라고 밝히고 "확인 필요 사항"의 이유를 설명한 뒤, 확정은 학과 또는 ${ACADEMIC_OFFICE}에 확인하도록 안내하라. 신뢰도가 "확정"인 항목은 근거 조문과 함께 답해도 된다.`,
  INSUFFICIENT: `아래 항목 중 신뢰도가 "자료 불충분" 또는 "추정"인 것은 근거 자료가 검증되지 않았거나 해석이 갈린다. 그 항목(특히 과목별 면제·이수 여부)은 단정하지 말고 자료가 확인되지 않았다고 먼저 밝힌 뒤 학과 또는 ${ACADEMIC_OFFICE} 확인을 안내하라. 신뢰도가 "확정"인 항목은 근거 조문과 함께 답해도 된다.`,
  NO_DATA: `이 학생에 대해 판단할 자료가 없다. 다른 학번·학과 자료로 추정해 답하지 말고 자료가 없다고 밝힌 뒤 ${ACADEMIC_OFFICE} 확인을 안내하라.`,
};

function articleLabel(rule) {
  const [doc, key] = String(rule.basis.articleRef).split(':');
  return `${DOC_LABEL[doc] || doc} ${key}${rule.basis.paragraph ? ` ${rule.basis.paragraph}` : ''}`;
}

const names = (items) => items.slice(0, MAX_COURSE_NAMES).map((i) => i.courseName).join(', ') + (items.length > MAX_COURSE_NAMES ? ` 외 ${items.length - MAX_COURSE_NAMES}개` : '');

/** 제13조 과목 경과조치 요약(과목이 수백 개일 수 있어 개수 + 예시 몇 개만). */
function courseTransitionLines(rules) {
  const lines = [];
  const r2 = rules.find((r) => r.ruleCode === 'ENF13_2_REQUIRED_TO_ELECTIVE_OR_ABOLISHED');
  if (r2 && r2.details) {
    if (r2.details.exempt.length) lines.push(`- 필수→선택 변경·폐설로 이수하지 않아도 되는 과목(②): ${r2.details.exempt.length}개 — ${names(r2.details.exempt)}`);
    if (r2.details.unclassified.length) lines.push(`- 필수에서 전공기초·전공심화 등으로 바뀐 과목(필수/선택 정의 없음, 면제 여부 판단 안 함): ${r2.details.unclassified.length}개`);
  }
  const r3 = rules.find((r) => r.ruleCode === 'ENF13_3_ELECTIVE_TO_REQUIRED_LOWER_GRADE');
  if (r3 && r3.details) {
    const c = r3.details.courses;
    if (c.length) {
      const ambiguous = c.filter((x) => x.alternatives && x.alternatives.length);
      lines.push(`- 선택→필수로 바뀐 과목(③): ${c.length}개 — 저학년 개설이라 면제 ${c.filter((x) => x.exempt === true).length}개, 이수 필요 ${c.filter((x) => x.exempt === false).length}개, 판단 불가 ${c.filter((x) => x.exempt == null).length}개` +
        (ambiguous.length ? `; 이 중 ${ambiguous.length}개는 "재학 중인 학년" 해석에 따라 결과가 달라짐(${names(ambiguous)})` : ''));
    }
    if (r3.details.newRequired.length) lines.push(`- 입학 후 새로 생긴 필수과목: ${r3.details.newRequired.length}개 — 제13조에 규정이 없어 이수 여부는 학과 확인 필요(${names(r3.details.newRequired)})`);
  }
  const r4 = rules.find((r) => r.ruleCode === 'ENF13_4_CATEGORY_AT_REGISTRATION');
  if (r4 && r4.details && r4.details.courses.length) lines.push(`- 이수구분이 바뀐 과목(④): ${r4.details.courses.length}개 — 그 과목을 수강한 학년도·학기의 이수구분으로 인정`);
  return lines;
}

/** 졸업요건 값(파트 1 evaluate + 데이터 등급)의 신뢰도 한 줄. 숫자 자체는 학번별 졸업요건 청크에 있다. */
function requirementLine(requirements) {
  if (!requirements) return null;
  const rule = requirements.rules.find((r) => r.id === 'REQUIREMENTS');
  if (!rule) return null;
  if (!rule.value) return `졸업요건 값: 이 학과·학번 자료 없음(신뢰도: ${CONFIDENCE_LABEL[rule.confidence]}) — 다른 학번 값으로 대신 답하지 마라.`;
  // 합계만 검수되고 칸별 분할은 검수 안 된 카테고리(교양필수·교양선택) — confidenceNote가 달린 칸. 총량 신뢰도와 비교하면
  // [별표 4] 불일치처럼 총량만 낮아지는 경우에 엉뚱한 카테고리가 나열된다.
  const split = rule.value.categories.filter((c) => c.confidenceNote).map((c) => c.category);
  const line = `졸업요건 값: 총 ${rule.value.totalRequiredCredits ?? '(편입생 — 총량 미확정)'}학점, 신뢰도 ${CONFIDENCE_LABEL[rule.confidence]}` +
    (split.length ? ` (${split.join('·')} 분할은 합계만 검수돼 추정)` : '');
  return rule.value.schedule4 ? `${line}
${schedule4Line(rule.value.schedule4)}` : line;
}

function historyLine(history) {
  if (!history || history.years.length === 0) return null;
  const parts = history.years.map((y) => `${y.year}학년도 과목 ${y.courses.label}${y.courses.count ? `(${y.courses.count}건)` : ''}${y.inEffect ? '' : '(기준일 이후)'}`);
  return `학년도별 교육과정 변경 기록(입학 이후): ${parts.join(' / ')}`;
}

/**
 * 판단 결과 → 근거 청크 [판단 요약, 근거 조문들]. articles: { 'DOC:키': { title, body, versionLabel } } (없으면 조문 청크 생략).
 * subject: { departmentName, cohort, enrollmentType, hypothetical } — hypothetical이면 질문 속 학번·학과(일반 재학생 가정).
 */
function formatJudgmentChunks(judgment, subject, articles = {}) {
  const { departmentName, cohort, enrollmentType, hypothetical } = subject;
  const label = judgment.confidenceLabel;
  const asOf = judgment.input ? judgment.input.asOfDate : null;
  const active = (judgment.rules || []).filter((r) => r.status !== 'NOT_APPLICABLE');

  const lines = [
    `[규정 판단 결과 — ${departmentName} ${cohort}학번 ${ENROLLMENT_LABEL[enrollmentType] || enrollmentType} 기준, 기준일 ${asOf}. 다른 근거 문서와 다르면 이 판단을 우선한다]`,
  ];
  if (hypothetical) lines.push('※ 질문에 나온 학번·학과 기준이며 입학유형은 일반 재학생으로 가정했다(학생 본인 프로필과 다를 수 있음).');
  lines.push(`전체 신뢰도: ${label}`);
  lines.push(`답변 지침: ${ANSWER_GUIDE[judgment.confidence]}`);

  if (active.length) {
    lines.push('적용되는 규정:');
    for (const r of active) {
      lines.push(`- [${STATUS_LABEL[r.status] || r.status}] ${articleLabel(r)}: ${r.effect} — ${r.reason} (신뢰도: ${r.confidenceLabel}${r.critical ? '' : ', 참고'})`);
    }
  }
  const req = requirementLine(judgment.requirements);
  if (req) lines.push(req);
  const transitions = courseTransitionLines(active);
  if (transitions.length) lines.push('과목 경과조치(학칙시행규칙 제13조):', ...transitions);
  const hist = historyLine(judgment.history);
  if (hist) lines.push(hist);
  if (judgment.history && judgment.history.years.some((y) => y.courses.status === 'NOT_VERIFIED')) {
    lines.push('※ "기록 없음(검증 안 됨)"인 학년도는 변경이 없었다는 뜻이 아니다 — 그 해 자료가 검증되지 않았다. "변경 없다"고 답하지 마라.');
  }

  const caveats = [...new Map((judgment.flags || []).filter((f) => f.level !== 'INFO').map((f) => [f.code, f.message])).values()];
  if (caveats.length) lines.push('확인 필요 사항:', ...caveats.slice(0, 8).map((m) => `- ${m}`));

  const chunks = [{
    chunkId: `regulation-judgment-${judgment.department ? judgment.department.id : 'x'}-${cohort}-${enrollmentType}-${asOf}`,
    documentTitle: `${departmentName} ${cohort}학번 적용 규정 판단 (신뢰도: ${label})`,
    content: lines.join('\n'),
    confidence: judgment.confidence,
  }];

  // 근거 조문 원문: 적용·조건부·판단 불가인 규칙의 조문(본문·부칙만 — 별표는 표라서 원문이 길고 깨져 있어 제목만 위에서 인용).
  const refs = [...new Set(active.map((r) => r.basis.articleRef))].filter((ref) => articles[ref]).slice(0, MAX_ARTICLE_CHUNKS);
  for (const ref of refs) {
    const a = articles[ref];
    const [doc, key] = ref.split(':');
    const body = a.body.length > MAX_ARTICLE_CHARS ? `${a.body.slice(0, MAX_ARTICLE_CHARS)}…(이하 생략)` : a.body;
    chunks.push({
      chunkId: `regulation-article-${ref}`,
      documentTitle: `${DOC_LABEL[doc] || doc} ${key} 원문 (현행 ${a.versionLabel} 개정본${a.lastAmendedOn ? `, 최근 개정 ${a.lastAmendedOn}` : ''})`,
      content: body,
      articleRef: ref,
      articleKey: key,
      // RAG(seedRegulations)가 같은 원문을 넣을 때 쓰는 문서 제목 — chatContextService.mergeChunks가 중복 조문을 빼는 데 쓴다.
      ragDocumentTitle: `원광대학교 ${DOC_LABEL[doc] || doc} 전문`,
    });
  }
  return chunks;
}

async function loadArticles(refs) {
  if (refs.length === 0) return {};
  const pairs = refs.map((r) => r.split(':'));
  const [rows] = await pool.query(
    `SELECT v.doc_code, a.article_key, a.title, a.body, a.section, a.last_amended_on, v.version_label
     FROM regulation_articles a JOIN regulation_versions v ON v.id = a.version_id
     WHERE v.text_held = 1 AND a.section <> 'SCHEDULE' AND (v.doc_code, a.article_key) IN (?)`,
    [pairs]
  );
  const iso = dbDateToIso;
  return Object.fromEntries(rows.map((r) => [`${r.doc_code}:${r.article_key}`, { title: r.title, body: r.body, versionLabel: r.version_label, lastAmendedOn: iso(r.last_amended_on) }]));
}

/**
 * 이 질문의 판단 대상(학번·학과·입학유형). 질문에 학번/학과가 따로 나오면 그쪽(입학유형은 일반 재학생 가정),
 * 아니면 학생 프로필. 학번이나 학과를 알 수 없으면 null — 판단하지 않는다(엉뚱한 학생 기준으로 단정하지 않게).
 */
async function resolveJudgmentSubject({ message, student, yearContext }) {
  let department = await resolveDepartment(message, student);
  const cohort = yearContext.applicableCohort;
  if (!department || !cohort) return null;
  // "학과가 공학3계열로 바뀌면 내 과목은?"처럼 본인 학과의 개편 전후 학과를 언급한 질문은 본인 기준으로 판단한다.
  // 언급된 학과를 그대로 쓰면 "공학3계열 2022학번"처럼 존재하지 않는 조합을 판단하게 된다(평가 세트 E25).
  if (department.source === 'message' && student && student.department_id && department.id !== student.department_id) {
    const chain = await getDepartmentChain(student.department_id);
    if (chain.departmentIds.includes(department.id)) department = (await resolveDepartment('', student)) || department;
  }
  // "20학번인데 …"처럼 본인 학번·학과를 질문에서 말해도, 프로필과 같은 학번·학과면 본인 질문이다 — 출처(message/profile)가 아니라
  // 값으로 비교한다. 예전에는 출처가 message면 가정(일반 재학생)으로 바뀌어 전과·편입 정보가 사라졌다(F-3).
  const isProfile = Boolean(student && student.department_id != null && student.department_id === department.id && student.admission_year === cohort);
  const base = isProfile && student ? inputFromStudentRow(student) : { enrollmentType: 'GENERAL' };
  return {
    input: { ...base, admissionYear: cohort, departmentId: department.id, asOfDate: yearContext.asOfDate },
    departmentName: department.name,
    cohort,
    enrollmentType: base.enrollmentType || 'GENERAL',
    hypothetical: !isProfile,
  };
}

/**
 * 챗봇용 판단: routes/chat.js가 RAG 검색 전에 호출한다. 실패해도 챗봇 전체를 막지 않는다(null) — 판단은 근거를
 * 보태는 것이지 답변의 필수 조건이 아니다. 단, 실패 사실은 로그로 남긴다.
 */
async function lookupRegulationJudgment({ message, student, yearContext }) {
  const intents = yearContext.intents || {};
  if (!(intents.requirement || intents.history || intents.compare || REGULATION_QUESTION_RE.test(message || ''))) return null;
  try {
    const subject = await resolveJudgmentSubject({ message, student, yearContext });
    if (!subject) return null;
    // withRequirements: 졸업요건 값의 판단 보류(#260)·자료 없음까지 신뢰도에 넣는다. 빼면 요건 쪽 보류가 있는 학과도
    // 적용범위만 보고 "확정"이 나와 챗봇이 단정한다(평가 세트 E16·E19·E29가 잡은 문제, D-33).
    const judgment = await resolveApplicableRulesForStudent(subject.input, { withRequirements: true });
    const refs = [...new Set((judgment.rules || []).filter((r) => r.status !== 'NOT_APPLICABLE').map((r) => r.basis.articleRef))];
    const articles = await loadArticles(refs);
    return { judgment, subject, chunks: formatJudgmentChunks(judgment, subject, articles) };
  } catch (err) {
    console.error('[regulationContext] 규정 판단 실패:', err.message);
    return null;
  }
}

module.exports = { lookupRegulationJudgment, formatJudgmentChunks, resolveJudgmentSubject, REGULATION_QUESTION_RE, ANSWER_GUIDE };
