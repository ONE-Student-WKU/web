/**
 * server/services/koreanSearch.js
 * 한국어 검색용 순수 함수 모음 — 과목 카탈로그 검색(courseService.searchCatalog)과 게시글 검색(communityService)이 같이 쓴다.
 * DB에 검색용 컬럼을 두지 않고(마이그레이션·재시딩 없이), 이미 읽어 온 행을 메모리에서 걸러 정렬하는 방식이다.
 *
 * 매칭 단계(숫자가 작을수록 우선):
 *   EXACT_PREFIX  이름이 검색어로 시작
 *   CONTAINS      이름이 검색어를 포함
 *   ALIAS         학생들이 쓰는 약칭·표기 차이(searchAliases.js)로 일치
 *   CHOSEONG      검색어가 초성뿐일 때 이름의 초성과 일치 (시작 > 포함)
 *   SECONDARY     보조 필드(교수명 등)에서 일치
 *   FUZZY         위 어디에도 없을 때만 — 자모 단위로 한두 글자 틀린 오타 허용
 */

const MATCH = {
  EXACT_PREFIX: 0,
  CONTAINS: 1,
  ALIAS: 2,
  CHOSEONG_PREFIX: 3,
  CHOSEONG_CONTAINS: 4,
  SECONDARY: 5,
  FUZZY: 6,
};

// 비교용 정규화 — 공백·문장부호(가운뎃점, 괄호, 마침표 등)를 지우고 소문자로.
// "컴퓨터 네트워크"="컴퓨터네트워크", "졸업(시험·작품)논문"="졸업시험작품논문".
function normalizeForSearch(text) {
  return String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const SYLLABLE_START = 0xac00;
const SYLLABLE_END = 0xd7a3;

function isSyllable(code) {
  return code >= SYLLABLE_START && code <= SYLLABLE_END;
}

// 완성형 한글의 초성만 뽑는다("알고리즘" → "ㅇㄱㄹㅈ"). 한글이 아닌 글자는 그대로 둔다.
function toChoseong(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out += isSyllable(code) ? CHO[Math.floor((code - SYLLABLE_START) / 588)] : ch;
  }
  return out;
}

// 초·중·종성으로 풀어 한 글자씩의 배열로 만든다("조" → ["ㅈ","ㅗ"]). 오타(ㅗ/ㅛ 혼동, 받침 유무)를 글자 단위가 아니라
// 자모 단위 거리로 재려는 용도.
function toJamo(text) {
  const out = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (isSyllable(code)) {
      const idx = code - SYLLABLE_START;
      out.push(CHO[Math.floor(idx / 588)], JUNG[Math.floor((idx % 588) / 28)]);
      const jong = JONG[idx % 28];
      if (jong) out.push(jong);
    } else {
      out.push(ch);
    }
  }
  return out;
}

// 검색어가 초성(ㄱ~ㅎ 자음)으로만 이뤄졌는지 — "ㅇㄱㄹㅈ" 같은 입력.
function isChoseongQuery(normalizedQuery) {
  return normalizedQuery.length > 0 && /^[ㄱ-ㅎ]+$/.test(normalizedQuery);
}

// pattern이 text의 "어느 부분 문자열과든" 최소 몇 글자(자모)만 다르면 같아지는지(Sellers 알고리즘, 시작 위치는 자유).
function minSubstringDistance(pattern, text) {
  const m = pattern.length;
  const n = text.length;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    const cur = new Array(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const sub = prev[j - 1] + (pattern[i - 1] === text[j - 1] ? 0 : 1);
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, sub);
    }
    prev = cur;
  }
  return Math.min(...prev);
}

// 오타 허용 자모 수 — 검색어가 짧으면 엉뚱한 과목이 걸리므로 허용하지 않는다.
function allowedTypos(queryJamoLength) {
  if (queryJamoLength <= 4) return 0; // 두 글자 안팎("수학" ↔ "수확")은 오타가 아니라 다른 말일 가능성이 크다
  if (queryJamoLength <= 8) return 1;
  return 2;
}

/**
 * 검색 대상 한 건을 미리 계산해 둔다 — 같은 행을 검색마다 다시 풀지 않도록 캐시에 이 형태로 보관한다.
 * primary: 주 검색 필드(과목명, 글 제목), secondary: 보조 필드 목록(교수명 등).
 */
function prepareEntry(primary, secondary = []) {
  const normalized = normalizeForSearch(primary);
  return {
    normalized,
    choseong: toChoseong(normalized),
    jamo: null, // 오타 허용 단계에서만 필요 — 처음 쓸 때 계산(대부분의 검색은 거기까지 안 간다)
    secondary: secondary.filter(Boolean).map(normalizeForSearch),
  };
}

/**
 * 검색어 한 개를 미리 계산해 둔다.
 * aliasExpansions: 약칭을 정식 표기로 바꾼 정규화 검색어 목록(searchAliases.expandAliases).
 */
function prepareQuery(rawQuery, aliasExpansions = []) {
  const normalized = normalizeForSearch(rawQuery);
  const jamo = toJamo(normalized);
  return { normalized, aliasExpansions, jamo, choseongOnly: isChoseongQuery(normalized), typos: allowedTypos(jamo.length) };
}

// 오타 허용을 뺀 정확 매칭 단계 — 일치하지 않으면 null.
function exactMatchLevel(entry, query) {
  const { normalized, choseong } = entry;
  if (normalized.startsWith(query.normalized)) return MATCH.EXACT_PREFIX;
  if (normalized.includes(query.normalized)) return MATCH.CONTAINS;
  if (query.aliasExpansions.some((alias) => normalized.includes(alias))) return MATCH.ALIAS;
  if (query.choseongOnly) {
    if (choseong.startsWith(query.normalized)) return MATCH.CHOSEONG_PREFIX;
    if (choseong.includes(query.normalized)) return MATCH.CHOSEONG_CONTAINS;
  }
  if (entry.secondary.some((s) => s.includes(query.normalized))) return MATCH.SECONDARY;
  return null;
}

function fuzzyDistance(entry, query) {
  if (query.typos === 0 || query.choseongOnly) return null;
  if (!entry.jamo) entry.jamo = toJamo(entry.normalized);
  const distance = minSubstringDistance(query.jamo, entry.jamo);
  return distance <= query.typos ? distance : null;
}

/**
 * entries(prepareEntry 결과 + 원본 item)를 검색어로 걸러 정렬한다. 같은 단계 안에서는 들어온 순서를 지킨다(안정 정렬 —
 * 호출 쪽이 이름순 등으로 미리 정렬해 둔다).
 * 정확 매칭이 하나라도 있으면 그것만 돌려주고, 하나도 없을 때만 오타 허용 결과(거리 가까운 순)를 돌려준다.
 *
 * @param {Array<{ item: any, entry: ReturnType<typeof prepareEntry> }>} rows
 * @param {ReturnType<typeof prepareQuery>} query
 * @returns {Array<{ item: any, level: number }>}
 */
function rankEntries(rows, query, { limit = Infinity } = {}) {
  if (!query.normalized) return [];
  const exact = [];
  for (const row of rows) {
    const level = exactMatchLevel(row.entry, query);
    if (level !== null) exact.push({ item: row.item, level });
  }
  if (exact.length > 0) return exact.sort((a, b) => a.level - b.level).slice(0, limit);

  const fuzzy = [];
  for (const row of rows) {
    const distance = fuzzyDistance(row.entry, query);
    if (distance !== null) fuzzy.push({ item: row.item, level: MATCH.FUZZY, distance });
  }
  return fuzzy.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

module.exports = {
  MATCH,
  normalizeForSearch,
  toChoseong,
  toJamo,
  isChoseongQuery,
  minSubstringDistance,
  allowedTypos,
  prepareEntry,
  prepareQuery,
  rankEntries,
};
