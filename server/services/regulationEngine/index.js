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

module.exports = { resolveRegulation, inputFromStudentRow, todayKst, CONFIDENCE };
