/**
 * server/services/answerGuard.js
 * AI 응답 후처리 가드(R-05 잔여, 보정 라운드 B의 B-27, DECISIONS D-49). 순수 함수 — AI를 호출하지 않는다.
 *
 * 왜 필요한가: 신뢰도가 확정이 아닐 때 "단정하지 마라"는 지시는 근거(프롬프트)에만 있고, 모델이 실제로 지켰는지 확인하는 코드가 없었다.
 * 지시를 어긴 답변이 그대로 저장·표시되면 "추정"인 내용이 확정처럼 읽힌다.
 *
 * 무엇을 검사하는가(설계 선택): "단정하는 말투"를 찾는 게 아니라 **"확정이 아니라는 표시가 하나라도 있는가"**를 본다.
 * 단정 말투 탐지("반드시", "~입니다" 등)는 한국어에서 정상 문장과 구분이 안 돼 오탐·미탐이 많다. 반대로 "추정/확인 필요/학사지원과" 같은
 * 단서 표현은 지시를 지킨 답변에 거의 항상 들어 있어서, 단서가 전혀 없을 때만 고정 안내문을 **덧붙이면** 오탐의 비용이 "중복 안내문"뿐이다
 * (답변 본문은 바꾸거나 지우지 않는다).
 */

const ACADEMIC_OFFICE = '학사지원과(063-850-5228)';

// 지시를 지킨 답변이 쓰는 단서 표현. 하나라도 있으면 그대로 둔다.
const HEDGE_RE = /추정|확정(?:이|은|할|되지|된 것은)\s*(?:아니|아닌|수\s*없|않)|확인(?:이)?\s*(?:필요|해\s*(?:주|보|야)|하시|바랍|되지)|확인되지|학사지원과|학과(?:에|로|에서)?\s*(?:문의|확인)|자료(?:가)?\s*(?:없|부족|불충분)|단정(?:할|하기)?\s*(?:수\s*)?(?:없|어렵|힘들)/;

// 영어 답변용 — 단서 표현을 한 번이라도 썼으면(추정/확인 필요/학사지원과 안내 등) 덧붙이지 않는다. 한국어 정규식과 같은 원칙(오탐 비용 = 중복 안내문).
// 영어 답변도 부서명을 "Academic Affairs Office (학사지원과)"처럼 한국어와 함께 적게 하므로 HEDGE_RE로도 함께 검사한다.
const HEDGE_RE_EN = /\bestimat|\bnot (?:been )?(?:confirmed|definitive|certain|final)\b|\bunconfirmed\b|\b(?:check|confirm|verify)\b[^.]{0,40}\b(?:with|against)\b|\bneeds? (?:to be )?(?:confirm|verif|check)|\bacademic affairs\b|\b(?:no|insufficient|lack of|limited) (?:data|information|source|material)|\bcannot be (?:sure|certain|determined)\b|\bunable to (?:confirm|determine)\b|\buncertain\b/i;

const NOTICE = {
  ESTIMATED: `※ 위 내용은 확정된 규정이 아니라 추정이에요. 정확한 적용 여부는 학과 또는 ${ACADEMIC_OFFICE}에 확인해 주세요.`,
  INSUFFICIENT: `※ 위 내용에는 근거 자료가 검증되지 않았거나 해석이 갈리는 부분이 있어요. 단정하지 말고 학과 또는 ${ACADEMIC_OFFICE}에 확인해 주세요.`,
  NO_DATA: `※ 이 학번·학과에 대한 규정 자료가 시스템에 없어요. 위 내용을 확정으로 받아들이지 말고 학과 또는 ${ACADEMIC_OFFICE}에 확인해 주세요.`,
};

const NOTICE_EN = {
  ESTIMATED: `※ The above is an estimate, not a confirmed rule. Please confirm with your department or the Academic Affairs Office (학사지원과, 063-850-5228) whether it applies to you.`,
  INSUFFICIENT: `※ Some of the above could not be verified from the source material, or can be interpreted in more than one way. Please do not treat it as definitive; confirm with your department or the Academic Affairs Office (학사지원과, 063-850-5228).`,
  NO_DATA: `※ The system has no regulation data for this student ID and department. Please do not treat the above as confirmed; check with your department or the Academic Affairs Office (학사지원과, 063-850-5228).`,
};

/**
 * @param {string} answer  AI 답변
 * @param {{ confidence: string }|null} judgment  이번 질문의 규정 판단 결과(없으면 가드하지 않는다)
 * @param {'ko'|'en'} [language]  답변 언어 — 영어면 영어 단서 표현을 보고 영어 안내문을 덧붙인다.
 * @returns {{ answer: string, guarded: boolean, reason: string|null }}
 */
function guardAnswer(answer, judgment, language = 'ko') {
  const text = typeof answer === 'string' ? answer : '';
  const english = language === 'en';
  const notice = judgment && (english ? NOTICE_EN : NOTICE)[judgment.confidence];
  if (!notice || !text.trim()) return { answer, guarded: false, reason: null };
  if (HEDGE_RE.test(text) || (english && HEDGE_RE_EN.test(text))) return { answer, guarded: false, reason: null };
  return { answer: `${text.trimEnd()}\n\n${notice}`, guarded: true, reason: `${judgment.confidence}인데 단서 표현 없음` };
}

module.exports = { guardAnswer, HEDGE_RE, HEDGE_RE_EN, NOTICE, NOTICE_EN };
