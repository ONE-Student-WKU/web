/**
 * server/services/crisis.js
 * 진로 탐색 대화에서 학생의 위기 신호(자살·자해를 암시하는 말)를 감지한다.
 *
 * 진로 후보는 "JSON만 출력"하는 호출이라 안전 안내를 넣을 자리가 없고, 위기 직후에 직업 후보를 내미는 것은 부적절하다.
 * 그래서 후보 생성 전에 서버가 대화를 검사해, 신호가 있으면 AI를 부르지 않고 도움 안내로 대신한다(careerService.generateCandidates).
 *
 * 키워드 기반이라 놓치는 표현도 있고, 과하게 잡는 경우도 있다 — 과하게 잡아도 비용은 "후보가 한 번 안 나오고 안내가 뜬다"뿐이라
 * 놓치는 쪽보다 낫다고 보고 넓게 잡되, "힘들어 죽겠다", "다 포기하고 싶다"처럼 흔한 관용·피로 표현은 잡지 않는다.
 */

const CRISIS_PATTERNS = [
  /죽고\s*(?:만\s*)?싶(?!지\s*(?:는\s*)?않|진\s*않)/, // 죽고 싶다 / 죽고싶어 (부정형 "죽고 싶지 않다"는 제외)
  /죽어\s*버(?:리|릴|려)/, // 죽어버릴까, 죽어버리고 싶다, 죽어버려야지
  /죽을까/, // 그냥 죽을까
  /죽는\s*(?:게|것이)\s*(?:낫|나을|차라리)/, // 죽는 게 낫겠다
  /자살/,
  /자해/,
  /극단적\s*(?:인\s*)?선택/,
  /(?:스스로|내|제)\s*목숨/, // 스스로 목숨을 끊고
  /목숨을?\s*끊/,
  /(?:사라|없어)(?:져\s*버리|지)고\s*싶/, // 사라지고 싶다, 없어지고 싶다
  /살기\s*(?:가\s*)?싫/, // 살기 싫다
  /살고\s*싶지\s*(?:가\s*)?않/, // 살고 싶지 않다
  /살\s*(?:이유|의미|가치)(?:가|도)?\s*없/, // 살 이유가 없다
  /(?:삶|인생|목숨)을?\s*(?:끝내|포기)/, // 삶을 끝내고, 인생을 포기
  /kill\s+my\s*self|suicid|want\s+to\s+die|end\s+my\s+life|hurt\s+my\s*self|self[-\s]?harm/i,
];

function detectCrisis(text) {
  if (typeof text !== 'string' || text.trim() === '') return false;
  return CRISIS_PATTERNS.some((re) => re.test(text));
}

// 최근 학생(user) 메시지 n개에 위기 신호가 있는지. 아주 오래전에 한 말 때문에 세션이 영영 막히지 않도록 최근 것만 본다.
// 맨 앞 고정 질문 답변은 선택지라 걸릴 일이 없고, 자유 대화가 짧으면 자연스럽게 그 앞의 답변까지 함께 검사된다.
function hasRecentCrisis(messages, recentUserTurns = 6) {
  const userContents = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && m.role === 'user')
    .map((m) => m.content)
    .slice(-recentUserTurns);
  return userContents.some(detectCrisis);
}

module.exports = { detectCrisis, hasRecentCrisis };
