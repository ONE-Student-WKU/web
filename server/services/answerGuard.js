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

// 학칙 [별표 4]와 교육과정 책자의 졸업학점이 다른 학생인데 답변이 한쪽 값만 말한 경우(이슈 #304 1번). 위 단서 검사는
// "확인 필요" 같은 표현이 어디에든(소제목에라도) 있으면 통과라, 본문이 "두 자료가 일치"라고 단정해도 걸러지지 않았다.
// 말투 대신 숫자로 본다 — 졸업학점을 말했는데(두 값 중 하나라도 "N학점"으로 나옴) 두 값이 다 나오지 않으면 둘 다 밝히는 안내를 덧붙인다.
function schedule4MismatchOf(judgment) {
  const rule = judgment.requirements && (judgment.requirements.rules || []).find((r) => r.id === 'REQUIREMENTS');
  const s4 = rule && rule.value && rule.value.schedule4;
  return s4 && s4.match === false ? s4 : null;
}

function mentionsCredits(text, credits, english) {
  const unit = english ? '\\s*credits?\\b' : '\\s*학점';
  return new RegExp(`(^|\\D)${credits}${unit}`, 'i').test(text);
}

function schedule4Notice(s4, english) {
  return english
    ? `※ The required graduation credits differ between the university regulations (Schedule 4: ${s4.schedule4Credits} credits) and the curriculum booklet (${s4.bookCredits} credits). Please confirm which applies to you with your department or the Academic Affairs Office (학사지원과, 063-850-5228).`
    : `※ 졸업학점은 학칙 [별표 4](${s4.schedule4Credits}학점)와 교육과정 책자(${s4.bookCredits}학점)가 서로 달라요. 어느 쪽이 적용되는지 학과 또는 ${ACADEMIC_OFFICE}에 확인해 주세요.`;
}

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

  const s4 = schedule4MismatchOf(judgment);
  if (s4 && [s4.schedule4Credits, s4.bookCredits].filter((c) => mentionsCredits(text, c, english)).length === 1) {
    return { answer: `${text.trimEnd()}\n\n${schedule4Notice(s4, english)}`, guarded: true, reason: '졸업학점 두 자료 중 한 값만 답함' };
  }

  if (HEDGE_RE.test(text) || (english && HEDGE_RE_EN.test(text))) return { answer, guarded: false, reason: null };
  return { answer: `${text.trimEnd()}\n\n${notice}`, guarded: true, reason: `${judgment.confidence}인데 단서 표현 없음` };
}

// 전화번호(지역번호부터, 예: 063-850-5228). 근거 문서와 코드에 적힌 번호인지 숫자만 떼어 비교한다.
const PHONE_RE = /(?<!\d)0\d{1,2}[-.)\s]{1,2}\d{3,4}[-.\s]\d{4}(?!\d)/g;
// 코드가 직접 안내하는 번호(위 안내문·규정 판단 근거) — 근거 문서에 없어도 맞는 번호다.
const KNOWN_PHONE_NUMBERS = [ACADEMIC_OFFICE];
const digitsOf = (text) => text.replace(/\D/g, '');

const PHONE_REMOVED_NOTICE = {
  ko: '※ 근거 자료에서 확인되지 않은 전화번호는 답변에서 뺐어요. 부서 연락처는 학교 홈페이지에서 확인해 주세요.',
  en: '※ Phone numbers that could not be found in the source material were removed from this answer. Please check department contacts on the university website.',
};

/**
 * 근거에 없는 전화번호를 지운다(2026-10-15 점검 — 모델이 "학사지원과(063-850-5092)"처럼 자료 어디에도 없는 번호를 지어냈다). 순수 함수.
 * 프롬프트로 "근거에 있는 번호만 안내하라"고 이미 지시하지만 지키지 않은 답변이 나와서, 번호는 코드로 확인한다.
 * 번호만 빼고 부서명은 남긴다("학사지원과(063-…)에" → "학사지원과에"). 지운 번호가 있으면 안내 한 줄을 덧붙인다.
 * @param {string} answer
 * @param {string[]} sourceTexts  이번 답변의 근거 문서 내용
 * @param {'ko'|'en'} [language]
 * @returns {{ answer: string, removed: string[] }}
 */
function removeUnverifiedPhoneNumbers(answer, sourceTexts, language = 'ko') {
  const text = typeof answer === 'string' ? answer : '';
  const allowed = new Set([...KNOWN_PHONE_NUMBERS, ...(sourceTexts || [])].flatMap((t) => (String(t || '').match(PHONE_RE) || []).map(digitsOf)));
  const removed = (text.match(PHONE_RE) || []).filter((n) => !allowed.has(digitsOf(n)));
  if (removed.length === 0) return { answer, removed };

  let out = text;
  for (const n of new Set(removed)) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`\\s*\\(\\s*${esc}\\s*\\)`, 'g'), '') // 학사지원과(번호) → 학사지원과
      .replace(new RegExp(`\\s*[,·]\\s*${esc}`, 'g'), '') // (학사지원과, 번호) → (학사지원과)
      .replace(new RegExp(`\\s*${esc}`, 'g'), ''); // 학사지원과 번호로 → 학사지원과로
  }
  return { answer: `${out.trimEnd()}\n\n${PHONE_REMOVED_NOTICE[language === 'en' ? 'en' : 'ko']}`, removed };
}

module.exports = { guardAnswer, removeUnverifiedPhoneNumbers, HEDGE_RE, HEDGE_RE_EN, NOTICE, NOTICE_EN, PHONE_REMOVED_NOTICE };
