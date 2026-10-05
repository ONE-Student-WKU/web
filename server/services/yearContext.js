/**
 * server/services/yearContext.js
 * 챗봇 질문에서 "어느 학년도/학번 기준으로 답해야 하는지"를 한 곳에서 정하는 순수 함수 모음.
 *
 * 질문에는 서로 다른 두 가지 연도가 섞여 나온다.
 *  - 학번(입학년도): "2021학번인데" — 이 학생에게 적용되는 교육과정을 정한다. (cohort)
 *  - 학년도: "2024학년도 졸업요건" — 그 해 교육과정 책자의 내용을 묻는다. (asked)
 * 예전에는 연도를 첫 번째 것만 읽었고(학번과 학년도도 서로 다른 함수가 따로 읽어서 같은 질문에서도 서로 다른
 * 연도를 썼다) 그래서 연도 비교 질문이나 "내 학번 vs 현재 규정" 질문을 처리하지 못했다.
 *
 * 기준일(asOfDate, 파트 2 추가): 위 두 연도와 별개로 "어느 날짜 시점의 규정으로 판단하나". 규정 판단 엔진
 * (regulationEngine.resolveApplicableRulesForStudent)은 학번이 같아도 기준일에 따라 결과가 달라진다(부칙 시행일, 개편 학년도,
 * 보유 원문 판본). 기준일은 mode/targetYears/bookYears 계산에 쓰지 않는다 — 기존 모드 판정을 바꾸지 않기 위해 결과에 필드만 더한다.
 */

const { isValidIsoDate, todayKst, academicTermOf } = require('./regulationEngine/context');

// 4자리 연도 + 학년도/년도/년. "2022학년도"의 끝 '2'가 "2학년"으로 읽히지 않도록 4자리를 먼저 통째로 잡는다.
const ASKED_YEAR_RE = /(?<!\d)(\d{4})\s*(?:학년도|년도|년)/g;
// "21학번", "2021학번". 2자리는 이 학교 재학생 학번이 전부 20xx라 2000을 더한다.
const COHORT_RE = /(?<!\d)(\d{2}|\d{4})\s*학번/g;

const HISTORY_RE = /언제\s*(부터|까지|쯤)?\s*(바뀌|바뀐|변경|달라|없어|폐지|생겼|생긴|신설|필수|선택)|바뀌었|바뀐\s*(거|건|게|이유|적)|변경(됐|되었|된|이\s*있)|없어졌|없어진|폐지(됐|되었|된)|신설(됐|되었|된)|예전|과거|이전에는|옛날|원래|왜\s*지금|달라졌|개정|언제\s*생겼/;
const COMPARE_RE = /차이|비교|달라|다른\s*점|어떻게\s*다|바뀌었/;
const REQUIREMENT_RE = /졸업\s*(요건|학점|조건|하려면|이수)|이수\s*(학점|기준|요건)|몇\s*학점|총\s*학점|졸업요건|요건/;
// 연도가 나와도 "그 학기에 실제 개설된 과목"을 묻는 질문일 때만 개설 이력(course_offerings)을 조회한다.
const OFFERING_RE = /개설|들을\s*수|시간표|수강\s*가능|어떤\s*과목|무슨\s*과목|과목\s*(목록|리스트|뭐)|수업/;

// 후속 질문의 단서("그럼", "왜 …"). 연도 이어받기는 이런 후속 질문이거나 요건·이력·비교를 묻는 질문일 때만 한다 —
// 아무 관련 없는 새 질문("점심 메뉴 추천해줘")이 직전 질문의 연도를 물려받으면 엉뚱한 연도 자료가 붙는다.
const FOLLOWUP_RE = /^\s*(그럼|그러면|그런데|그건|그거|그게|이건|이거|왜|어째서|그래서|그때|거기|그것)/;

// 질문 속 날짜(기준일 후보): "2026년 3월 1일", "2026.3.1", "2026-03-01". 연·월·일이 다 있을 때만 — "2026년"만 있으면 학년도(ASKED_YEAR_RE)다.
const AS_OF_DATE_RE = /(?<!\d)(\d{4})\s*(?:년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일|[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2}))(?!\d)/;

function unique(list) {
  return [...new Set(list)];
}

function extractAskedYears(text) {
  if (!text) return [];
  return unique([...String(text).matchAll(ASKED_YEAR_RE)].map((m) => Number(m[1])));
}

function extractCohorts(text) {
  if (!text) return [];
  return unique(
    [...String(text).matchAll(COHORT_RE)].map((m) => (m[1].length === 4 ? Number(m[1]) : 2000 + Number(m[1])))
  );
}

/** 질문 속 날짜 → 'YYYY-MM-DD'(실제 있는 날짜만). 없으면 null. */
function extractAsOfDate(text) {
  const m = AS_OF_DATE_RE.exec(String(text || ''));
  if (!m) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const iso = `${m[1]}-${pad(m[2] ?? m[4])}-${pad(m[3] ?? m[5])}`;
  return isValidIsoDate(iso) ? iso : null;
}

function detectIntents(text) {
  const t = String(text || '');
  return {
    history: HISTORY_RE.test(t),
    compare: COMPARE_RE.test(t),
    requirement: REQUIREMENT_RE.test(t),
    offering: OFFERING_RE.test(t),
  };
}

/**
 * 질문 속 연도 → 책자(RAG 문서) 학년도. 책자가 있는 해면 그 해, 없으면 그 뒤 가장 가까운 책자
 * (뒤 책자에는 이전 학번용 표가 함께 실려 있는 경우가 많다), 그래도 없으면 가장 최신 책자.
 */
function resolveBookYear(year, availableBookYears) {
  if (!availableBookYears || availableBookYears.length === 0) return null;
  const sorted = [...availableBookYears].sort((a, b) => a - b);
  if (sorted.includes(year)) return year;
  const later = sorted.find((y) => y > year);
  return later ?? sorted[sorted.length - 1];
}

/**
 * @param {object} p
 * @param {string} p.message                 이번 질문
 * @param {string} [p.previousUserMessage]   직전 사용자 질문 — 이번 질문에 연도가 전혀 없을 때만 보조로 쓴다("왜 그래?" 후속 질문)
 * @param {number} [p.profileCohort]         온보딩에 입력한 입학년도
 * @param {number[]} [p.availableBookYears]  RAG에 들어 있는 교육과정 책자 학년도
 * @param {string} [p.asOfDate]              호출자가 정한 기준일('YYYY-MM-DD'). 질문에 날짜가 있으면 질문이 우선한다
 * @param {string} [p.today]                 오늘(KST) 고정값 — 테스트용. 없으면 todayKst()
 * @returns {object} 아래 필드. targetYears는 구조화 조회(과목/요건)를 돌릴 학번·학년도 목록.
 *   asOfDate / asOfSource(message | caller | previous | today) / asOfTerm: 규정 판단 기준일(모드 계산과 무관).
 *   mode: COHORT(내 학번 기준) | SPECIFIC_YEAR(특정 학년도) | COMPARE(연도 비교·적용 여부) | HISTORY(변경 이력) | DEFAULT(연도 정보 없음 → 최신)
 */
function resolveYearContext({ message, previousUserMessage = null, profileCohort = null, availableBookYears = [], asOfDate = null, today = null }) {
  let askedYears = extractAskedYears(message);
  let messageCohorts = extractCohorts(message);
  const intents = detectIntents(message);
  const explicitAskedYears = askedYears; // 이번 질문에 직접 나온 학년도(이어받은 것 제외) — 개설 이력 조회 같은 단순 조회용

  // 이번 질문에 연도 표현이 하나도 없고 후속 질문처럼 보이면 직전 질문의 연도를 이어받는다.
  let inheritedFromPrevious = false;
  const followUpLike = FOLLOWUP_RE.test(message || '') || intents.history || intents.compare || intents.requirement;
  if (askedYears.length === 0 && messageCohorts.length === 0 && previousUserMessage && followUpLike) {
    const prevAsked = extractAskedYears(previousUserMessage);
    const prevCohorts = extractCohorts(previousUserMessage);
    if (prevAsked.length || prevCohorts.length) {
      askedYears = prevAsked;
      messageCohorts = prevCohorts;
      inheritedFromPrevious = true;
    }
  }

  const applicableCohort = messageCohorts[0] ?? profileCohort ?? null;
  const cohortSource = messageCohorts.length > 0 ? 'message' : profileCohort ? 'profile' : null;
  const latestBookYear = availableBookYears.length ? Math.max(...availableBookYears) : null;

  let mode = 'DEFAULT';
  let targetYears = [];

  if (askedYears.length >= 2 || (askedYears.length === 1 && messageCohorts.length > 0 && !messageCohorts.includes(askedYears[0]))) {
    // 두 연도를 비교하거나, "내 학번(2021) 말고 2026학년도 기준을 적용해도 되나" 같은 적용 여부 질문.
    mode = 'COMPARE';
    targetYears = unique([...(messageCohorts.length ? [messageCohorts[0]] : []), ...askedYears]);
  } else if (messageCohorts.length >= 2) {
    mode = 'COMPARE';
    targetYears = unique(messageCohorts);
  } else if (intents.history) {
    mode = 'HISTORY';
    targetYears = applicableCohort ? [applicableCohort] : [];
  } else if (askedYears.length === 1) {
    mode = 'SPECIFIC_YEAR';
    targetYears = [askedYears[0]];
  } else if (applicableCohort) {
    mode = 'COHORT';
    targetYears = [applicableCohort];
  }

  // 비교 의도("차이/비교")인데 연도가 하나뿐이면 학생 학번과 그 연도를 비교한다.
  if (mode === 'SPECIFIC_YEAR' && intents.compare && applicableCohort && applicableCohort !== askedYears[0]) {
    mode = 'COMPARE';
    targetYears = unique([applicableCohort, askedYears[0]]);
  }

  // RAG 책자 학년도: HISTORY는 학생 학번 책자 + 최신 책자(규정이 어떻게 바뀌었는지 양쪽을 봐야 함).
  let bookYears;
  if (mode === 'DEFAULT') {
    bookYears = latestBookYear ? [latestBookYear] : [];
  } else if (mode === 'HISTORY') {
    const own = targetYears.map((y) => resolveBookYear(y, availableBookYears));
    bookYears = unique([...own, latestBookYear].filter((y) => y != null));
  } else {
    bookYears = unique(targetYears.map((y) => resolveBookYear(y, availableBookYears)).filter((y) => y != null));
  }

  // 기준일: 질문의 날짜 > 호출자 지정 > (후속 질문이면) 직전 질문의 날짜 > 오늘.
  let resolvedAsOf = extractAsOfDate(message);
  let asOfSource = 'message';
  if (!resolvedAsOf && asOfDate && isValidIsoDate(asOfDate)) [resolvedAsOf, asOfSource] = [asOfDate, 'caller'];
  if (!resolvedAsOf && previousUserMessage && followUpLike) {
    const prev = extractAsOfDate(previousUserMessage);
    if (prev) [resolvedAsOf, asOfSource] = [prev, 'previous'];
  }
  if (!resolvedAsOf) [resolvedAsOf, asOfSource] = [today && isValidIsoDate(today) ? today : todayKst(), 'today'];

  return {
    mode,
    askedYears,
    explicitAskedYears,
    messageCohorts,
    profileCohort: profileCohort ?? null,
    applicableCohort,
    cohortSource,
    targetYears,
    bookYears,
    latestBookYear,
    intents,
    inheritedFromPrevious,
    asOfDate: resolvedAsOf,
    asOfSource,
    asOfTerm: academicTermOf(resolvedAsOf),
  };
}

module.exports = {
  extractAskedYears,
  extractCohorts,
  extractAsOfDate,
  detectIntents,
  resolveBookYear,
  resolveYearContext,
};
