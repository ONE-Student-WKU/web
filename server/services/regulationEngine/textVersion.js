const { TEXT_SOURCES, CITATIONS } = require('./constants');
const { makeFlag, dedupeFlags } = require('./flags');

/**
 * server/services/regulationEngine/textVersion.js
 * "기준일 당시 이 조문의 문구를 우리가 갖고 있는가"를 판단하는 단 하나의 함수 모음.
 *
 * 왜 하나로 모았나(보정 라운드 B, DECISIONS D-42): 예전에는 두 곳이 따로 판단했다 — 졸업요건 규칙은 "문서 전체" 기준(시행규칙이 개정된
 * 기간이면 무조건 추정), 적용범위 규칙은 "조문별" 기준. 그래서 같은 학생(간호학과 2026, 기준일 2026-03-15)에서 조문 규칙은 전부 확정인데
 * 전체가 추정이 됐다. 조문 단위가 더 정확하다: 개정 표시가 없는 조문은 전부개정 이후 문구가 그대로라서 그 이후 어느 기준일에도 같다.
 *
 * 판단 규칙(조문 하나에 대해):
 *  1. 기준일 < 보유 판본의 시작일(전부개정 시행일 등)        → TEXT_VERSION_NOT_HELD (추정) — 구버전 원문이 없다
 *  2. 그 조문의 마지막 개정 시행일 > 기준일                    → TEXT_INTERMEDIATE_VERSION (추정) — 기준일 당시 문구는 개정 전이다
 *  3. 기준일 > 보유한 최신 판본 시행일                         → TEXT_SNAPSHOT_MAY_BE_OLDER (정보) — 그 뒤 개정 여부는 모른다
 *  4. 그 밖                                                    → 플래그 없음(확정 가능)
 * 전제: 개정된 조문에는 `<개정 …>` 표시가 빠짐없이 붙는다(D-28). 조문 정보를 못 구하면(DB 미시딩 등) 보수적으로 "최신 판본 시행일에
 * 개정됐다"고 보아 2번에 걸리게 한다 — 구버전 원문이 없는 구간은 어떤 경우에도 확정이 되지 않는다.
 *
 * 판본의 시작·끝 날짜는 DB(regulation_versions: 시행일 + 대체관계)에서 읽고, DB가 비어 있으면 constants.TEXT_SOURCES를 쓴다. 둘이
 * 어긋나지 않는지는 테스트(textVersion.test.js)가 확인한다.
 */

/**
 * regulation_versions 행들(camelCase) → 문서별 요약 { floor, latest, effectiveByPromulgation }.
 *  - latest: 본문을 보유한 판본(textHeld)의 시행일
 *  - floor : 그 판본에서 대체관계(supersedesVersionId)를 거슬러 올라간 사슬의 맨 앞 판본 시행일 — 이 날짜 이전 문구는 없다
 *    (전부개정 이후만 이어지는 학칙·시행규칙은 전부개정 시행일, 제정부터 부칙이 다 있는 수업관리규정은 제정일)
 *  - effectiveByPromulgation: 공포일 → 시행일. 개정 표시의 날짜는 공포일이라 시행일이 다른 경우(시행규칙 2026.02.05. 공포 → 03.01. 시행)를 맞춘다
 * 날짜를 알 수 없으면(null) 그 문서는 요약하지 않는다(→ 상수로 대체).
 */
function summarizeVersions(rows) {
  const byDoc = {};
  for (const r of rows || []) (byDoc[r.docCode] = byDoc[r.docCode] || []).push(r);
  const out = {};
  for (const [docCode, list] of Object.entries(byDoc)) {
    const byId = new Map(list.map((r) => [r.id, r]));
    const held = list.find((r) => r.textHeld);
    if (!held || !held.effectiveFrom) continue;
    let first = held;
    const seen = new Set([held.id]);
    while (first.supersedesVersionId != null && byId.has(first.supersedesVersionId) && !seen.has(first.supersedesVersionId)) {
      first = byId.get(first.supersedesVersionId);
      seen.add(first.id);
    }
    if (!first.effectiveFrom) continue;
    out[docCode] = {
      floor: first.effectiveFrom,
      latest: held.effectiveFrom,
      effectiveByPromulgation: new Map(list.filter((r) => r.promulgatedOn && r.effectiveFrom).map((r) => [r.promulgatedOn, r.effectiveFrom])),
    };
  }
  return out;
}

/** 문서의 판본 정보: DB 요약이 있으면 그것, 없으면 상수(TEXT_SOURCES). */
function sourceFor(docCode, textVersions) {
  const fromDb = textVersions && textVersions.summary && textVersions.summary[docCode];
  if (fromDb) return fromDb;
  const src = TEXT_SOURCES[docCode];
  return src ? { floor: src.firstHeldEffective, latest: src.latestHeldEffective, effectiveByPromulgation: new Map() } : null;
}

/** 조문의 마지막 개정 표시 날짜. 알면 날짜 또는 null(표시 없음), 모르면 undefined. */
function lastAmendedOf(docCode, articleKey, textVersions) {
  const meta = textVersions && textVersions.articles && textVersions.articles[`${docCode}:${articleKey}`];
  return meta ? meta.lastAmendedOn ?? null : undefined;
}

/**
 * 조문 하나의 판본 플래그.
 * @param {object} p  { asOfDate, docCode, articleKey?, lastAmendedOn?(null=표시 없음, undefined=모름), textVersions? }
 */
function articleTextFlags({ asOfDate, docCode, articleKey, lastAmendedOn, textVersions }) {
  const src = sourceFor(docCode, textVersions);
  if (!src) return [];
  if (asOfDate < src.floor) return [makeFlag('TEXT_VERSION_NOT_HELD', { heldFrom: src.floor })];
  const marked = lastAmendedOn !== undefined ? lastAmendedOn : (articleKey ? lastAmendedOf(docCode, articleKey, textVersions) : undefined);
  // 모르면 보수적으로 최신 판본에서 개정됐다고 본다(예전 문서 단위 판단과 같은 결과).
  const amendedEffective = marked === undefined ? src.latest : marked === null ? null : (src.effectiveByPromulgation.get(marked) || marked);
  if (amendedEffective && asOfDate < amendedEffective) return [makeFlag('TEXT_INTERMEDIATE_VERSION', { heldVersion: amendedEffective })];
  if (asOfDate > src.latest) return [makeFlag('TEXT_SNAPSHOT_MAY_BE_OLDER', { heldVersion: src.latest })];
  return [];
}

/** 근거 키(CITATIONS) 목록 중 조문(ARTICLE)의 판본 플래그를 모아 중복 없이. 조문이 없으면 []. */
function basisTextFlags(asOfDate, basisKeys, textVersions) {
  const flags = [];
  for (const key of basisKeys) {
    const c = CITATIONS[key];
    if (!c || c.kind !== 'ARTICLE' || !c.articleRef) continue;
    const [docCode, articleKey] = c.articleRef.split(':');
    flags.push(...articleTextFlags({ asOfDate, docCode, articleKey, textVersions }));
  }
  return dedupeFlags(flags);
}

module.exports = { summarizeVersions, articleTextFlags, basisTextFlags };
