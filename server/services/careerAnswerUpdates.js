/**
 * server/services/careerAnswerUpdates.js
 * 진로 탐색에서 처음 답변(고정 질문)을 고친 기록을 다룬다(순수 함수, 이슈 #245 / #378 결정 14-1 C·14-2 A·14-3 A).
 *
 * 왜 이렇게 하나: 예전에는 답을 고치면 대화 맨 앞의 고정 답변을 그대로 덮어써서, AI가 "학생이 생각을 바꿨다"는 사실을 알 수 없었고
 * (뒤에 이어지는 질문은 옛 답 기준이라 앞뒤가 어긋남) 고쳐도 AI 반응이 없었다. 이제는 원래 답을 남겨 두고 바뀐 내용을
 * 학생 메시지 하나로 기록한다. 그 메시지의 내용은 화면 언어와 무관한 표식 + JSON이라, 화면은 번역해서 보여 주고
 * AI에게 보낼 때는 한국어 문장으로 바꾼다(historyForAi).
 *  - CONTINUE(이어서 대화): 기록을 남기고 AI가 바뀐 답을 반영해 곧바로 한 번 응답한다.
 *  - RESTART(처음부터 다시): 같은 상담 안에서 그 기록 이후만 새 대화로 본다. 이전 대화는 지우지 않고 화면·AI에서 감춘다.
 * 기록 메시지는 학생(user) 메시지라 상담당 자유 대화 한도(15번)에 들어간다 — "다시 시작"을 반복해 한도를 우회하지 못한다.
 * 화면(client/src/pages/CareerExploration.jsx)도 같은 표식을 읽는다.
 */

const ANSWERS_UPDATE_MARKER = '[[FIXED_ANSWERS_UPDATE]]';
const UPDATE_MODES = ['CONTINUE', 'RESTART'];

/** 기록 메시지 내용 → { mode, changes: [{ index, question, before, after }], answers: string[] } | null(기록이 아님). */
function parseAnswersUpdate(content) {
  if (typeof content !== 'string' || !content.startsWith(ANSWERS_UPDATE_MARKER)) return null;
  try {
    const value = JSON.parse(content.slice(ANSWERS_UPDATE_MARKER.length));
    return value && UPDATE_MODES.includes(value.mode) && Array.isArray(value.answers) ? value : null;
  } catch {
    return null;
  }
}

function buildAnswersUpdate(mode, changes, answers) {
  return ANSWERS_UPDATE_MARKER + JSON.stringify({ mode, changes, answers });
}

/** 지금 유효한 처음 답변(마지막 기록의 answers, 기록이 없으면 대화 맨 앞의 원래 답). */
function currentFixedAnswers(messages, fixedCount) {
  let answers = Array.from({ length: fixedCount }, (_, i) => (messages[i * 2 + 1] ? messages[i * 2 + 1].content : ''));
  for (const m of messages.slice(fixedCount * 2)) {
    const update = m.role === 'user' ? parseAnswersUpdate(m.content) : null;
    if (update) answers = update.answers;
  }
  return answers;
}

/**
 * AI에게 보낼 대화 기록. 고정 질문 블록은 지금 유효한 답으로 채우고, "다시 시작" 기록이 있으면 그 이후만 이어 붙인다.
 * "이어서 대화" 기록은 "학생이 처음 답변을 바꿨다: 「질문」 이전 → 새"라는 한국어 문장으로 바꾼다(AI 컨텍스트는 한국어 원문 — CLAUDE.md).
 */
function historyForAi(messages, fixedCount) {
  const fixedEnd = fixedCount * 2;
  const answers = currentFixedAnswers(messages, fixedCount);
  const head = messages.slice(0, fixedEnd).map((m, i) => (i % 2 === 1 ? { ...m, content: answers[(i - 1) / 2] } : m));
  let rest = messages.slice(fixedEnd);
  const lastRestart = rest.map((m) => (m.role === 'user' ? parseAnswersUpdate(m.content) : null)).map((u) => u && u.mode === 'RESTART').lastIndexOf(true);
  if (lastRestart >= 0) rest = rest.slice(lastRestart + 1);
  const converted = rest.map((m) => {
    const update = m.role === 'user' ? parseAnswersUpdate(m.content) : null;
    if (!update) return m;
    // 이전 답과 새 답을 둘 다 학생 생각으로 읽지 않게 "이전 답은 취소"를 분명히 적는다(실제 AI 확인: 둘 다 힘든 걸로 읽은 적이 있다).
    const lines = update.changes.map((c) => `「${c.question}」: 이전 "${c.before}" → 새 "${c.after}"`).join(' / ');
    return { ...m, content: `(학생이 처음 답변을 고쳤다 — 이전 답은 취소하고 새 답으로 바꿨다) ${lines}. 이제 새 답만 학생의 답으로 보고 대화를 이어가라. 왜 바꿨는지 가볍게 물어봐도 좋다.` };
  });
  return [...head, ...converted];
}

/** 이번에 보낸 답과 지금 유효한 답을 비교해 바뀐 질문만. */
function diffFixedAnswers(current, fixedAnswers) {
  return fixedAnswers
    .map((a, index) => ({ index, question: a.question, before: current[index], after: a.answer }))
    .filter((c) => c.before !== c.after);
}

module.exports = { ANSWERS_UPDATE_MARKER, UPDATE_MODES, parseAnswersUpdate, buildAnswersUpdate, currentFixedAnswers, historyForAi, diffFixedAnswers };
