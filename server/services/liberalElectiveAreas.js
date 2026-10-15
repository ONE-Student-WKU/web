const fs = require('node:fs');
const path = require('node:path');
const { normalizeCourseName } = require('./courseNameMatch');

/**
 * server/services/liberalElectiveAreas.js
 * 교양기초·교양선택 "영역"을 채웠는지 센다(#378 H-1, 결정 H1-1·H1-2·H1-3 모두 A).
 *
 * 왜 필요한가: 시드의 교양선택 행은 교양기초 16학점과 교양선택을 합친 학점 하나라서(예: 계열 28 = 16 + 12), 교양기초 16학점을 전부
 * AI와디지털로 들어도 "충족"으로 나왔다. 2025·2026 책자의 교양 이수학점 기준(2025 책자 31쪽, 2026 책자 32쪽)은 영역별로 정한다.
 *  - 교양기초(선택필수): 생명존중교육 4, AI와디지털 3, 논리와표현 3, 글로벌의사소통 3, 과학과기술 3 = 16학점
 *  - 교양선택: 인문과사회·자연과환경·문화와예술·취업과실무 4개 영역 중 3개 영역 이상에서 12학점(계열)·16학점(일반 학과).
 *    교양선택이 4학점·2학점인 학과(의약·간호 등)에는 영역 개수 조건이 없다.
 * 영역 기준은 2025학번부터만 본다(H1-1 A) — 2024학번 이하는 2026 책자 각주대로 "영역 구분 없이" 합계만 채우면 된다.
 *
 * 과목 → 영역은 책자의 교양 개설현황(db/regulations/교육과정/YYYY_교양필수_교양기초_개설현황.md, YYYY_교양선택_일반선택_개설현황.md)의
 * 영역별 표에서 과목명으로 찾는다(H1-2 A). 성적표에는 "교기"라고만 찍혀 영역이 없기 때문이다. 이수구분은 수강한 학년도 기준이라
 * (경과조치 다, DECISIONS D-56) 과목을 들은 해의 개설현황을 먼저 보고(2025년 이전은 2025, 이후는 최신 책자), 없으면 다른 해를 본다 —
 * 예: 화학과생활은 2025 책자에서 교양기초(과학과기술), 2026 책자에서 교양선택(자연과환경)이다. 목록에 없는 과목(직접 입력하며 이름을 다르게 썼거나 새 과목)은 "영역을 모르는 학점"으로 따로 센다 —
 * 어느 영역에도 넣지 않는다(H1-3 A, 기초·심화·응용의 "구분을 모르는 학점"과 같은 방식).
 */

const FIRST_COHORT = 2025;
const CATALOG_YEARS = [2025, 2026];
const FOUNDATION_MINIMUMS = Object.freeze({ 생명존중: 4, AI와디지털: 3, 논리와표현: 3, 글로벌의사소통: 3, 과학과기술: 3 });
const FOUNDATION_TOTAL = Object.values(FOUNDATION_MINIMUMS).reduce((a, b) => a + b, 0);
const ELECTIVE_AREAS = Object.freeze(['인문과사회', '자연과환경', '문화와예술', '취업과실무']);
const ELECTIVE_MIN_AREA_COUNT = 3;
// 교양선택이 이 학점 이상인 행(계열 12, 일반 학과 16)에만 "4개 영역 중 3개 이상" 조건이 붙는다.
const ELECTIVE_AREA_RULE_MIN_CREDITS = 12;

const DOC_DIR = path.resolve(__dirname, '..', '..', 'db', 'regulations', '교육과정');

// 개설현황 문서의 표 제목 → [구분, 영역]. "### 교양기초 기초교육 AI와 디지털 개설 과목", "### 교양선택 리버럴아츠교육 인문과 사회 개설 과목 (1/4)"
function areaOfHeading(line) {
  const h = line.replace(/\s/g, '');
  if (!h.includes('개설과목')) return null;
  if (h.startsWith('###교양기초')) {
    const area = Object.keys(FOUNDATION_MINIMUMS).find((a) => h.includes(a));
    return area ? ['교양기초', area] : null;
  }
  if (h.startsWith('###교양선택')) {
    const area = ELECTIVE_AREAS.find((a) => h.includes(a));
    return area ? ['교양선택', area] : null;
  }
  return null;
}

/** 문서 내용 → Map(정규화 과목명 → { group, area }). 순수 함수(테스트용). */
function parseCatalogText(text, map = new Map()) {
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#')) {
      current = areaOfHeading(line);
      continue;
    }
    if (!current || !line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const name = cells[2];
    if (!name || name === '교과목' || /^-+$/.test(name)) continue;
    map.set(normalizeCourseName(name), { group: current[0], area: current[1] });
  }
  return map;
}

let cachedCatalog;
/** 학년도별 과목명 → 영역 { 2025: Map, 2026: Map }. 한 번만 읽고, 문서를 못 읽은 해는 빠진다(그 학점은 "영역을 모름"으로 나온다). */
function loadLiberalAreaCatalog() {
  if (cachedCatalog !== undefined) return cachedCatalog;
  const byYear = {};
  for (const year of CATALOG_YEARS) {
    try {
      const map = new Map();
      for (const file of [`${year}_교양필수_교양기초_개설현황.md`, `${year}_교양선택_일반선택_개설현황.md`]) {
        parseCatalogText(fs.readFileSync(path.join(DOC_DIR, file), 'utf8'), map);
      }
      byYear[year] = map;
    } catch (err) {
      console.error(`[liberalElectiveAreas] ${year} 교양 개설현황을 읽지 못했어요:`, err.message);
    }
  }
  cachedCatalog = byYear;
  return cachedCatalog;
}

/** 수강 학년도의 개설현황을 먼저, 없으면 최신부터 다른 해를 본다. */
function areaOf(catalog, name, year) {
  const years = Object.keys(catalog).map(Number).sort((a, b) => b - a);
  if (years.length === 0) return null;
  const own = Math.min(Math.max(Number(year) || years[0], years[years.length - 1]), years[0]);
  const order = [own, ...years.filter((y) => y !== own)];
  const keys = nameKeys(name);
  for (const y of order) {
    const hit = keys.map((k) => catalog[y].get(k)).find(Boolean);
    if (hit) return hit;
  }
  return null;
}

/** 학생 과목명 → 비교용 이름들(정규화 + 끝 괄호를 뗀 이름). "대학영어(1분반)"처럼 적어도 같은 과목으로 본다. */
function nameKeys(name) {
  const full = normalizeCourseName(String(name || ''));
  const withoutParen = normalizeCourseName(String(name || '').replace(/\([^)]*\)\s*$/, ''));
  return withoutParen && withoutParen !== full ? [full, withoutParen] : [full];
}

/**
 * 순수 함수.
 * @param {object} p
 * @param {number} p.admissionYear
 * @param {boolean} p.relaxed  전과(3학년 이상)·편입처럼 교양 기준을 완화받은 학생 — 영역 기준을 적용하지 않는다
 * @param {number|null} p.electiveRequiredCredits  교양선택 행의 학점(교양기초 + 교양선택)
 * @param {Array<{ name, category, credits, year }>} p.courses  졸업 학점으로 세는 과목(F·NP, 재수강 이전 기록 제외)
 * @param {Object<number, Map>} [p.catalog]  loadLiberalAreaCatalog() 모양
 * @returns {{ foundation, electives, unknownCredits, satisfied } | null}  영역 기준이 없는 학생이면 null
 */
function evaluateLiberalElectiveAreas({ admissionYear, relaxed = false, electiveRequiredCredits, courses, catalog = loadLiberalAreaCatalog() }) {
  if (!(Number(admissionYear) >= FIRST_COHORT) || relaxed) return null;
  // 교양기초 16학점이 안 되는 행(전문학사 등)은 영역별 학점이 다르거나 알 수 없어 판정하지 않는다.
  if (!(Number(electiveRequiredCredits) >= FOUNDATION_TOTAL)) return null;
  const needAreaCount = Number(electiveRequiredCredits) - FOUNDATION_TOTAL >= ELECTIVE_AREA_RULE_MIN_CREDITS;

  const foundationEarned = Object.fromEntries(Object.keys(FOUNDATION_MINIMUMS).map((a) => [a, 0]));
  const electiveEarned = Object.fromEntries(ELECTIVE_AREAS.map((a) => [a, 0]));
  let unknownCredits = 0;
  for (const c of courses || []) {
    if (c.category !== '교양선택') continue;
    const hit = areaOf(catalog, c.name, c.year);
    const credits = Number(c.credits) || 0;
    if (hit && hit.group === '교양기초') foundationEarned[hit.area] += credits;
    else if (hit && hit.group === '교양선택') electiveEarned[hit.area] += credits;
    else unknownCredits += credits;
  }

  const foundation = Object.entries(FOUNDATION_MINIMUMS).map(([area, required]) => ({
    area, required, earned: foundationEarned[area], satisfied: foundationEarned[area] >= required,
  }));
  const coveredAreas = ELECTIVE_AREAS.filter((a) => electiveEarned[a] > 0);
  const electives = needAreaCount
    ? {
      requiredAreaCount: ELECTIVE_MIN_AREA_COUNT,
      areas: ELECTIVE_AREAS.map((area) => ({ area, earned: electiveEarned[area] })),
      coveredAreaCount: coveredAreas.length,
      satisfied: coveredAreas.length >= ELECTIVE_MIN_AREA_COUNT,
    }
    : null;
  return {
    foundation,
    electives,
    unknownCredits,
    satisfied: foundation.every((a) => a.satisfied) && (!electives || electives.satisfied),
  };
}

module.exports = {
  evaluateLiberalElectiveAreas, loadLiberalAreaCatalog, parseCatalogText,
  FOUNDATION_MINIMUMS, ELECTIVE_AREAS, ELECTIVE_MIN_AREA_COUNT, FIRST_COHORT,
};
