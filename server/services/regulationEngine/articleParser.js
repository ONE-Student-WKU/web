/**
 * server/services/regulationEngine/articleParser.js
 * 규정 원문 txt(db/regulations/_source/*.txt) → 조문 단위 행 + 개정 표시 + 판본(부칙) 목록 + 조문 간 관계. 순수 함수(파일·DB 없음).
 *
 * 왜 필요한가: RAG 시드(seedRegulations)는 원문을 "검색용 청크"로만 자르고 조문 번호·개정일을 구조로 남기지 않는다.
 * 판단 엔진은 "제13조 ②가 언제부터 시행됐나 / 이 조문이 바뀐 적이 있나"를 물어야 해서 조문을 행으로, 개정 표시를 날짜로 둔다.
 *
 * 한계(의도적): 레포에는 현행 최종본만 있다. <개정 2026. 6. 26.> 표시는 "그 날 바뀌었다"만 알려줄 뿐 이전 문구는 모른다.
 * 그래서 파서는 날짜만 뽑고 이전 문구를 추측하지 않는다. 표시가 없는 조문도 "개정 없음"이 아니라 "표시 없음"이다.
 */

// 개정 표시의 종류 단어. 수업관리규정은 '항신설'·'호신설'·'단서신설'·'본조신설'처럼 세분한다.
const MARKER_KINDS = ['전문개정', '본조신설', '단서신설', '항신설', '호신설', '조신설', '신설', '개정', '삭제'];
const KIND_RE = new RegExp(MARKER_KINDS.join('|'), 'g');
// 날짜: '2026. 6. 26.' 또는 '‘22.02.25'·'’20.07.03'·"'22.10.18"(2자리 연도 + 곡선/직선 따옴표). 마지막 점은 있어도 없어도 된다.
const DATE_RE = /(?:(\d{4})|[‘’'](\d{2}))\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\.?/g;
const BRACKET_RE = /<([^<>]{0,200})>/g;

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 2자리 연도 → 4자리. 수업관리규정(1980 제정)의 ‘01·’22 표기 해석: 70~99는 1900년대, 00~69는 2000년대.
 * 원문 표지의 제정(1980)·개정(2022~2026) 연도와 부칙 날짜 목록이 모두 이 규칙과 맞는다(DECISIONS D-26).
 */
function expandYear(two) {
  const n = Number(two);
  return n >= 70 ? 1900 + n : 2000 + n;
}

function isoFrom(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function datesIn(text) {
  const out = [];
  for (const m of text.matchAll(DATE_RE)) {
    const y = m[1] ? Number(m[1]) : expandYear(m[2]);
    out.push({ index: m.index, date: isoFrom(y, Number(m[3]), Number(m[4])) });
  }
  return out;
}

/**
 * 한 줄의 <...> 개정 표시들 → [{ kind, dates }]. 날짜가 없는 꺾쇠(<그림>, <의학과>)는 무시한다.
 * 꺾쇠 안에 종류 단어가 없으면(예: "삭제 <2026. 4. 10.>") 꺾쇠 바로 앞 단어를 본다. 그래도 없으면 UNSPECIFIED.
 * 꺾쇠 하나에 여러 종류가 섞이면(<항신설 ‘20.07.03, 개정 ‘22.02.25>) 각 날짜는 바로 앞에 나온 종류를 따른다.
 */
function parseMarkers(line) {
  const markers = [];
  for (const b of line.matchAll(BRACKET_RE)) {
    const inner = b[1];
    const dates = datesIn(inner);
    if (dates.length === 0) continue;
    const kinds = [...inner.matchAll(KIND_RE)].map((k) => ({ index: k.index, kind: k[0] }));
    let fallback = 'UNSPECIFIED';
    if (kinds.length === 0) {
      const before = line.slice(Math.max(0, b.index - 6), b.index);
      const k = MARKER_KINDS.find((w) => before.includes(w));
      if (k) fallback = k;
    }
    const byKind = new Map();
    for (const d of dates) {
      const prev = kinds.filter((k) => k.index < d.index).pop();
      const kind = prev ? prev.kind : (kinds[0] ? kinds[0].kind : fallback);
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind).push(d.date);
    }
    for (const [kind, ds] of byKind) markers.push({ kind, dates: ds });
  }
  return markers;
}

// --- 줄 분류 ---
const CHAPTER_RE = /^\s*제(\d+)장\s*(.*)$/;
const SECTION_RE = /^\s*제(\d+)절\s*(.*)$/;
const ARTICLE_RE = /^제(\d+)조(?:의(\d+))?\s*\(([^)]*)\)\s*(.*)$/;
const ADDENDUM_RE = /^부\s*칙\s*(?:\(([^)]*)\))?\s*$/;
const SCHEDULE_RE = /^【\s*(별표|별지)\s*(?:제\s*)?(\d+)\s*(?:호\s*)?(?:서식)?\s*】\s*(.*)$/;
// 별표 안의 하위표 번호(󰊱󰊲󰊳󰊴 — HWP 변환 시 사설 영역 문자로 나오는 원문자 ①②③④).
const SUBTABLE_CHARS = ['\u{F02B1}', '\u{F02B2}', '\u{F02B3}', '\u{F02B4}', '\u{F02B5}', '\u{F02B6}'];

function subtableIndex(line) {
  const t = line.trimStart();
  const i = SUBTABLE_CHARS.findIndex((c) => t.startsWith(c));
  return i === -1 ? null : i + 1;
}

/** 표지의 '제정 1976. 03. 01.' / '전부개정 2026. 02. 05.' / '개정 2026. 04. 10' 줄. */
const HEADER_HISTORY_RE = /^(제정|전부개정|개정)\s+(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\.?\s*$/;

/** 부칙 본문에서 시행일 찾기. 확인 가능한 형태만 CONFIRMED, 학기 표현은 학기 시작일로 환산해 ESTIMATED. */
function parseEffectiveDate(body, promulgatedOn) {
  const ymd = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*부터\s*시행/.exec(body);
  if (ymd) return { date: isoFrom(Number(ymd[1]), Number(ymd[2]), Number(ymd[3])), confidence: 'CONFIRMED', basis: ymd[0] };
  const promulgation = /공포한\s*날(?:로)?\s*부터\s*시행/.exec(body);
  if (promulgation && promulgatedOn) return { date: promulgatedOn, confidence: 'CONFIRMED', basis: promulgation[0] };
  // "2012년 1학기부터", "2020학년도 2학기부터" — 학기 시작일(학칙 제22조: 1학기 3/1, 2학기 9/1)로 환산. 그 해 학칙의
  // 학기 시작일이 지금과 같았는지는 확인하지 않았으므로 추정.
  const term = /(\d{4})(?:학년도|년)\s*제?\s*([12])\s*학기\s*부터/.exec(body);
  if (term) return { date: isoFrom(Number(term[1]), term[2] === '1' ? 3 : 9, 1), confidence: 'ESTIMATED', basis: term[0] };
  return { date: null, confidence: 'UNKNOWN', basis: null };
}

function labelDate(label) {
  if (!label) return null;
  const d = datesIn(label.replace(/(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/, '$1. $2. $3.'))[0];
  return d ? d.date : null;
}

/**
 * 원문 txt → { header, articles, addenda }.
 *  - header: [{ kind: '제정'|'전부개정'|'개정', date }]
 *  - articles: [{ articleKey, articleNo, section, title, chapter, body, amendmentMarkers, lastAmendedOn, ord }]
 *  - addenda: [{ label, promulgatedOn, effective: { date, confidence, basis }, body }]
 */
function parseRegulationText(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const header = [];
  const articles = [];
  const addenda = [];
  const usedKeys = new Map();

  let chapter = null;
  let mode = 'PREAMBLE'; // PREAMBLE → BODY → ADDENDUM → SCHEDULE
  let current = null;
  let addendum = null;
  let schedule = null; // { kind, no, title }

  const uniqueKey = (key) => {
    const n = (usedKeys.get(key) || 0) + 1;
    usedKeys.set(key, n);
    return n === 1 ? key : `${key}#${n}`; // 같은 별표가 학년도별로 여러 번 나오는 경우(학칙 [별표 1] 3회)
  };
  const flush = () => {
    if (!current) return;
    current.body = current.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    delete current.lines;
    const dates = current.amendmentMarkers.flatMap((m) => m.dates).sort();
    current.lastAmendedOn = dates.length ? dates[dates.length - 1] : null;
    current.ord = articles.length;
    articles.push(current);
    current = null;
  };
  const start = (fields, firstLine) => {
    flush();
    current = { chapter: null, title: null, articleNo: null, ...fields, articleKey: uniqueKey(fields.articleKey), amendmentMarkers: [], lines: [] };
    if (firstLine != null) addLine(firstLine);
  };
  const addLine = (line) => {
    current.lines.push(line);
    current.amendmentMarkers.push(...parseMarkers(line));
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();

    if (mode === 'PREAMBLE') {
      const h = HEADER_HISTORY_RE.exec(trimmed);
      if (h) header.push({ kind: h[1], date: isoFrom(Number(h[2]), Number(h[3]), Number(h[4])) });
    }

    const add = ADDENDUM_RE.exec(trimmed);
    if (add && mode !== 'SCHEDULE') {
      flush();
      mode = 'ADDENDUM';
      const label = add[1] ? add[1].trim() : null;
      addendum = { label, promulgatedOn: labelDate(label), lines: [] };
      addenda.push(addendum);
      continue;
    }

    const sch = SCHEDULE_RE.exec(trimmed);
    if (sch) {
      mode = 'SCHEDULE';
      schedule = { kind: sch[1], no: Number(sch[2]), title: sch[3].trim() };
      start({ articleKey: `${sch[1]}${sch[2]}`, section: 'SCHEDULE', title: `【${sch[1]} ${sch[2]}】${schedule.title}` }, line);
      continue;
    }
    if (mode === 'SCHEDULE') {
      const sub = subtableIndex(trimmed);
      if (sub != null && schedule) {
        start({ articleKey: `${schedule.kind}${schedule.no}-${sub}`, section: 'SCHEDULE', title: trimmed.slice(2).trim() }, line);
        continue;
      }
      if (current) addLine(line);
      continue;
    }

    if (mode === 'ADDENDUM') {
      addendum.lines.push(line);
      const art = ARTICLE_RE.exec(trimmed);
      if (art) {
        start({ articleKey: `부칙(${addendum.label || '제정'})제${art[1]}조`, articleNo: Number(art[1]), section: 'ADDENDUM', title: art[3] }, line);
      } else if (current && current.articleKey.startsWith(`부칙(${addendum.label || '제정'})`)) {
        addLine(line);
      } else if (trimmed) {
        // 조 없이 한 문장뿐인 부칙("본 시행규칙은 ... 시행한다")은 부칙 전체를 한 행으로.
        start({ articleKey: `부칙(${addendum.label || '제정'})`, section: 'ADDENDUM' }, line);
      }
      continue;
    }

    const ch = CHAPTER_RE.exec(trimmed);
    if (ch) {
      flush();
      mode = 'BODY';
      chapter = `제${ch[1]}장 ${ch[2].replace(/\s+/g, ' ').trim()}`.trim();
      continue;
    }
    if (SECTION_RE.test(trimmed) && mode === 'BODY') {
      flush();
      continue;
    }
    const art = ARTICLE_RE.exec(trimmed);
    if (art) {
      mode = 'BODY';
      const key = art[2] ? `제${art[1]}조의${art[2]}` : `제${art[1]}조`;
      start({ articleKey: key, articleNo: Number(art[1]), section: 'BODY', title: art[3].trim(), chapter }, line);
      continue;
    }
    if (current && mode === 'BODY') addLine(line);
  }
  flush();

  for (const a of addenda) {
    a.body = a.lines.join('\n').trim();
    delete a.lines;
    a.effective = parseEffectiveDate(a.body, a.promulgatedOn);
  }
  return { header, articles, addenda };
}

// --- 조문 간 관계(휴리스틱) ---
const DOC_NAME_TO_CODE = Object.freeze({
  '원광대학교 학칙': 'ACADEMIC_REGULATIONS',
  '원광대학교 학칙시행규칙': 'ENFORCEMENT_RULES',
});

/**
 * 조문 본문에서 다른 조문으로의 관계를 뽑는다.
 *  - "제N조에도 불구하고" → OVERRIDES(특칙이 일반 규정을 덮음)
 *  - "[별표 N]" → DELEGATES_TO(같은 문서의 별표)
 *  - "「다른 규정」 제N조" → REFERS(다른 문서 — 이름을 아는 문서면 doc 코드, 모르면 to_ref 문자열만)
 *  - "제N조" → REFERS(같은 문서). 바로 앞이 "법 "/"령 "이면 외부 법령이라 to_ref로만 남긴다.
 * 결과: [{ relation, toDoc, toKey, toRef }]. toDoc이 null이면 연결할 수 없는 외부 대상(toRef만).
 * 문장 해석이 아니라 패턴 매칭이므로 source='PARSED'로 저장하고, 판단에 쓰는 관계는 applicability.json에 MANUAL로 둔다.
 */
function extractRelations(body, selfDoc, selfKey) {
  const out = [];
  const seen = new Set();
  const push = (r) => {
    const k = `${r.relation}|${r.toDoc}|${r.toKey}|${r.toRef}`;
    if (seen.has(k) || (r.toDoc === selfDoc && r.toKey === selfKey)) return;
    seen.add(k);
    out.push(r);
  };
  // 조문 머리("제13조(교육과정 ...)")는 자기 번호라 관계가 아니다. 부칙 조문은 자기 번호가 본문 조문 번호와 겹쳐 오탐이 된다.
  body = body.replace(/^제\d+조(?:의\d+)?\s*\([^)]*\)/, '');
  for (const m of body.matchAll(/(?:「([^」]+)」\s*)?\[별표\s*(\d+)\]/g)) {
    const doc = m[1] ? DOC_NAME_TO_CODE[m[1].trim()] || null : selfDoc;
    push({ relation: 'DELEGATES_TO', toDoc: doc, toKey: doc ? `별표${m[2]}` : null, toRef: doc ? null : `「${m[1].trim()}」 [별표 ${m[2]}]` });
  }
  const overridden = new Set();
  for (const m of body.matchAll(/(?:「([^」]+)」\s*)?제(\d+)조(?:의(\d+))?/g)) {
    const key = m[3] ? `제${m[2]}조의${m[3]}` : `제${m[2]}조`;
    const after = body.slice(m.index + m[0].length, m.index + m[0].length + 20);
    const relation = /^(?:\s*제\d+항)?(?:\s*제\d+호)?에도\s*불구하고/.test(after) ? 'OVERRIDES' : 'REFERS';
    if (m[1]) {
      const doc = DOC_NAME_TO_CODE[m[1].trim()] || null;
      push({ relation, toDoc: doc, toKey: doc ? key : null, toRef: doc ? null : `「${m[1].trim()}」 ${key}` });
      continue;
    }
    const before = body.slice(Math.max(0, m.index - 8), m.index);
    // 「」 없이 문서 이름이 바로 붙은 "학칙시행규칙 제14조"(수업관리규정 제13조)는 그 문서의 조문이다 — 아니면 앞 글자("…규칙")를 보고 외부 규정으로 오인해
    // "필요할 경우 학칙시행규칙 제14조" 같은 깨진 문자열로만 남는다(보정 라운드 B, D-47). "본/이 ○○ 제N조"는 자기 문서라 아래에서 처리한다.
    const bare = /(?:^|[^가-힣])(학칙시행규칙|학칙)\s*$/.exec(body.slice(Math.max(0, m.index - 14), m.index));
    if (bare && !/(?:본|이)\s*(?:학칙시행규칙|학칙)\s*$/.test(body.slice(Math.max(0, m.index - 16), m.index))) {
      push({ relation, toDoc: bare[1] === '학칙시행규칙' ? 'ENFORCEMENT_RULES' : 'ACADEMIC_REGULATIONS', toKey: key, toRef: null });
      continue;
    }
    // "본 시행규칙 제6조", "이 학칙 제5조"는 자기 문서다. 그 밖에 "…법 제N조", "…규칙 제N조"는 외부 법령·규정.
    if (!/(?:본|이)\s*(?:시행규칙|학칙|규정)\s*$/.test(before) && /(법|령|규칙|규정)\s*$/.test(before)) {
      push({ relation, toDoc: null, toKey: null, toRef: `${body.slice(Math.max(0, m.index - 15), m.index).trim()} ${key}` });
      continue;
    }
    if (relation === 'OVERRIDES') overridden.add(key);
    else if (overridden.has(key)) continue; // 같은 대상을 덮는 관계가 있으면 단순 참조는 중복이라 뺀다
    push({ relation, toDoc: selfDoc, toKey: key, toRef: null });
  }
  return out;
}

module.exports = { parseRegulationText, parseMarkers, parseEffectiveDate, extractRelations, expandYear, DOC_NAME_TO_CODE };
