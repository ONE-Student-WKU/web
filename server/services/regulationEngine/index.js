const { CONFIDENCE, CONFIDENCE_LABEL_KO } = require('./constants');
const { makeFlag } = require('./flags');
const { normalizeInput, inputFromStudentRow, todayKst } = require('./context');
const { evaluate } = require('./evaluate');

/**
 * server/services/regulationEngine/index.js
 * 규정 판단 엔진의 진입점.
 *
 * 한 문장 요약: "입학년도·입학유형·학과·기준일"을 받아, 그 학생에게 지금 실제로 적용되는 규정 + 근거 조문 +
 * 변경 이력 + 신뢰도(확정/추정/자료없음)를 돌려준다. 과거 학번 문서를 "찾아주는" 게 아니라 "판단"한다.
 *
 * resolveRegulation은 어떤 입력에도 예외 대신 결과 객체를 돌려준다(입력 오류 → confidence NO_DATA + INVALID_INPUT 플래그).
 * 호출자(API/챗봇)가 try/catch 없이 신뢰도만 보고 "확인 필요" 안내로 분기할 수 있게 하기 위함이다.
 */

function invalidResult(errors) {
  const flag = makeFlag('INVALID_INPUT', { errors });
  return { input: null, department: null, confidence: CONFIDENCE.NO_DATA, confidenceLabel: CONFIDENCE_LABEL_KO.NO_DATA, rules: [], flags: [flag] };
}

/**
 * @param {object} rawInput  context.normalizeInput 주석 참고
 * @param {object} [opts]
 * @param {Function} [opts.loadData]  data 로더(기본 = DB). 테스트에서 가짜 데이터를 주입할 때 쓴다.
 * @param {string}   [opts.today]     'YYYY-MM-DD' — asOfDate 기본값을 고정할 때(테스트)
 */
async function resolveRegulation(rawInput, opts = {}) {
  const { ctx, errors } = normalizeInput(rawInput, { today: opts.today });
  if (!ctx) return invalidResult(errors);

  const loadData = opts.loadData || require('./dbProvider').loadData; // DB 모듈은 필요할 때만 불러온다(순수 테스트가 DB를 안 건드리게)
  const data = await loadData(ctx);
  const result = evaluate(ctx, data);
  return { ...result, department: data.department || null, confidenceLabel: CONFIDENCE_LABEL_KO[result.confidence] };
}

/**
 * 파트 2: 적용범위 판단(시행규칙 제5조·제13조①~④·제14조·제15조, 학칙 [별표 4]·부칙) + 졸업요건 + 변경 이력 + 데이터 등급을 한 번에.
 * 판단은 순수 함수 resolveApplicableRules(applicability.js), 여기는 DB 로더만 붙인다. 입력 오류도 예외 대신 결과 객체로 돌려준다.
 * @param {object} rawInput  applicability.js resolveApplicableRules 주석 참고
 * @param {object} [opts]  { loadData(ctx), today, withRequirements }
 */
async function resolveApplicableRulesForStudent(rawInput, opts = {}) {
  const { resolveApplicableRules } = require('./applicability');
  const { ctx } = normalizeInput(rawInput, { today: opts.today });
  if (!ctx) return resolveApplicableRules(rawInput, null, { today: opts.today }); // 입력 오류 결과를 같은 모양으로
  const loadData = opts.loadData || ((c) => require('./dbProvider').loadApplicabilityData(c, { withRequirements: opts.withRequirements !== false }));
  return resolveApplicableRules(rawInput, await loadData(ctx), { today: opts.today });
}

/**
 * 파트 3: 졸업진단(graduationService)용 — 졸업요건 값(파트 1 evaluate) + 데이터 검수 등급(칸별 신뢰도)만.
 * 졸업진단은 화면 진입·챗봇 질문마다 불리므로, 과목 변경 이력·적용범위 조회(resolveApplicableRulesForStudent)는 하지 않는다.
 * 예외 대신 결과 객체(입력 오류 = NO_DATA)를 돌려주는 건 resolveRegulation과 같다.
 */
async function resolveRequirementsForStudent(rawInput, opts = {}) {
  const { annotateRequirements } = require('./applicability');
  const { ctx, errors } = normalizeInput(rawInput, { today: opts.today });
  if (!ctx) return invalidResult(errors);
  const loadData = opts.loadData || ((c) => require('./dbProvider').loadData(c, { withHistory: false }));
  const data = await loadData(ctx);
  const annotated = annotateRequirements(ctx, evaluate(ctx, data), data.department ? data.department.name : null);
  return { ...annotated, department: data.department || null, confidenceLabel: CONFIDENCE_LABEL_KO[annotated.confidence] };
}

module.exports = { resolveRegulation, resolveApplicableRulesForStudent, resolveRequirementsForStudent, inputFromStudentRow, todayKst, CONFIDENCE };
