#!/usr/bin/env node
/**
 * scripts/audit/auditRequirements.js
 * 책자 "학과(부)별 이수학점 기준 총괄표"(extractSummaryTable.mjs 결과)를 db/seed/curriculum_requirements.json과
 * 학과·학번 단위로 대조한다. 시드가 앞 학년도 값을 복제한 채 책자와 다른 값이 남아 있으면(복제 오염) 여기서 잡힌다.
 *
 * 비교 항목(학과·학번별): 교양계, 기본전공(전공필수), 최소전공(전과·편입), 주전공(전공 총계), 자유선택(일반선택), 졸업학점 총계.
 * 시드 쪽 값은 해당 학번에 적용되는 일반 요건 행(enrollmentType=null)의 합으로 계산한다(graduationService와 같은 범위 조건).
 *
 * 사용법: node scripts/audit/auditRequirements.js <year> <summary.json> [--show 40] [--out report.json]
 *   summary.json은 extractSummaryTable.mjs의 --out 결과(텍스트 PDF 연도). 스캔본 연도(2017·2018·2020)는 쪽 이미지를 사람이
 *   읽어 같은 모양의 JSON({rows:[{name, liberal, base, minMajor, major, free, total}]})을 직접 만들어 넘긴다.
 *
 * PDF 행 해석: 숫자 조각을 오른쪽부터 읽는다 — 총계 ← (P/F) ← 자유선택 ← 주전공 ← 최소전공 ← 기본전공("18이상" 또는 18 + "이상") ← 교양계.
 * 이 모양이 아닌 행(전공이수학점이 "교육과정에 따라 이수"인 의·치·한·약 등)은 SPECIAL로 따로 보고하고 수치 대조에서 뺀다.
 */

const fs = require('node:fs');
const path = require('node:path');

const REQ_FILE = path.resolve(__dirname, '..', '..', 'db', 'seed', 'curriculum_requirements.json');

const normName = (s) => String(s ?? '').normalize('NFKC').replace(/[\s·.,()]/g, '');

// PDF에서 학과명이 글자 단위로 쪼개져 나오거나(예: "반 려 동 물…") 오타가 있는 경우를 위한 별칭은 여기에 근거와 함께 둔다.
// (추측으로 이름을 맞추지 않는다 — 비어 있으면 매칭 안 된 이름이 "UNMATCHED"로 보고된다.)
// 각 항목에는 근거를 적는다.
const NAME_ALIASES = {
  // 책자 2023 총괄표(p.28) 자체의 오타 — 시드는 정상 표기.
  '회계쎄무학과': '회계세무학과',
  // 2019·2021 책자는 '원예산업학부'로 인쇄. 시드는 2017~2024 모두 '원예산업학과'(이슈 #260 2017절: 2017·2022 이후 같은 이름의 같은 학과로 처리).
  '원예산업학부': '원예산업학과',
  // 책자 '가정아동복지학과' = 2022 이후 '가족아동복지학과'(이슈 #260 2017절 3항에 기록된 기존 판단).
  '가정아동복지학과': '가족아동복지학과',
};

const COLS = ['liberal', 'base', 'minMajor', 'major', 'free', 'total'];
const isPlainNum = (t) => /^\d+(\.\d+)?(이상)?$/.test(t);
const numVal = (t) => Number(t.replace('이상', ''));

// 열 위치 추정: 쪽마다(= 표 레이아웃이 같은 묶음) "완전한 행"(교양 세부 칸까지 숫자가 12개 이상)의 오른쪽 6개 숫자 조각 x좌표 중앙값을
// 열 기준선으로 쓴다. 전공 칸이 비었거나 서술인 행(의·치·한·약·건축, 계열 통합 행 등)도 같은 기준선에 맞춰 읽을 수 있다.
function computeBins(rows) {
  const byPage = new Map();
  for (const r of rows) {
    if (!r.tokens) continue; // 이미 열이 해석된 행(parseSummaryMd 결과)은 건너뜀
    const nums = r.tokens.filter((t) => isPlainNum(t.s));
    if (nums.length < 12) continue;
    const last6 = nums.slice(-6).map((t) => t.x);
    if (!byPage.has(r.page)) byPage.set(r.page, COLS.map(() => []));
    last6.forEach((x, i) => byPage.get(r.page)[i].push(x));
  }
  const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const perPage = new Map();
  for (const [page, cols] of byPage) perPage.set(page, { n: cols[0].length, bins: cols.map(median) });
  // 같은 표의 쪽들은 열 배치가 같다. 쪽마다 따로 추정하면 2년제 학과처럼 칸이 빠진 행만 있는 쪽에서 기준선이 흔들리므로,
  // 완전한 행이 가장 많은 쪽의 기준선을 모든 쪽에 쓴다.
  const best = [...perPage.values()].sort((a, b) => b.n - a.n)[0];
  const bins = new Map();
  for (const r of rows) if (r.tokens) bins.set(r.page, best ? best.bins : null);
  return bins;
}

function parseRowByBins(row, bins) {
  const b = bins.get(row.page) || [...bins.values()][0];
  if (!b) return null;
  const out = { name: row.name, liberal: null, base: null, minMajor: null, major: null, free: null, total: null };
  for (const t of row.tokens) {
    if (!isPlainNum(t.s) || t.x < b[0] - 12) continue; // 교양 세부 칸(왼쪽)과 서술 문구는 건너뜀
    let best = -1;
    let bestD = 11; // 열 기준선에서 ±10pt 안
    b.forEach((x, i) => { const d = Math.abs(t.x - x); if (d < bestD) { bestD = d; best = i; } });
    if (best !== -1 && out[COLS[best]] == null) out[COLS[best]] = numVal(t.s);
  }
  out.partial = COLS.some((c) => out[c] == null);
  // 책자 행 자체의 산술: 교양 + 주전공 + 자유선택 = 졸업학점. 안 맞으면 책자 값이 서로 어긋난 행이다(시드와 다르다고 시드 오류는 아님).
  out.bookInconsistent = out.liberal != null && out.major != null && out.free != null && out.total != null && out.liberal + out.major + out.free !== out.total;
  return COLS.some((c) => out[c] != null) ? out : null;
}

// 시드에서 (학과, 학번)의 일반 요건 값을 계산한다.
function seedValues(reqs, dept, year) {
  const applies = (r) => (r.minAdmissionYear == null || year >= r.minAdmissionYear) && (r.maxAdmissionYear == null || year <= r.maxAdmissionYear);
  const rows = reqs.filter((r) => r.departmentName === dept && applies(r));
  const general = rows.filter((r) => r.enrollmentType == null && r.minCourseCount == null);
  const sum = (cats) => general.filter((r) => cats.includes(r.category)).reduce((s, r) => s + Number(r.requiredCredits), 0);
  const has = (cats) => general.some((r) => cats.includes(r.category));
  const mc = rows.filter((r) => r.enrollmentType === 'MAJOR_CHANGE' && r.category === '전공');
  const tr = rows.filter((r) => r.enrollmentType === 'TRANSFER_ADMISSION' && r.category === '전공');
  const liberal = sum(['교양필수', '교양선택']);
  const major = sum(['전공필수', '전공선택', '전공']);
  const free = sum(['일반선택']);
  return {
    hasCore: has(['교양필수', '교양선택', '전공필수', '전공선택', '전공']), // 본과(의·치·한의학과)는 교양 행이 없으므로 "어느 하나라도" 있으면 자료가 있다고 본다
    liberal,
    base: sum(['전공필수']),
    major,
    free,
    total: liberal + major + free,
    minMajorMC: mc.length ? Number(mc[0].requiredCredits) : null,
    minMajorTR: tr.length ? Number(tr[0].requiredCredits) : null,
  };
}

function main() {
  const args = process.argv.slice(2);
  const [yearStr, summaryFile] = args.filter((a) => !a.startsWith('--'));
  if (!yearStr || !summaryFile) {
    console.error('사용법: node scripts/audit/auditRequirements.js <year> <summary.json> [--show 40] [--out report.json]');
    process.exit(2);
  }
  const year = Number(yearStr);
  const showIdx = args.indexOf('--show');
  const show = showIdx === -1 ? 40 : Number(args[showIdx + 1]);

  const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
  const reqs = JSON.parse(fs.readFileSync(REQ_FILE, 'utf8'));
  const deptNames = [...new Set(reqs.map((r) => r.departmentName))];
  const byNorm = new Map(deptNames.map((n) => [normName(n), n]));

  const bins = computeBins(summary.rows);
  const findings = [];
  const specials = [];
  const unmatched = [];
  const matchedDepts = new Set();
  const trackRows = []; // 트랙 줄은 별도 보고(시드는 학과 단위)
  let compared = 0;
  let exact = 0;

  for (const row of summary.rows) {
    const baseName = NAME_ALIASES[row.name] || row.name;
    // 시드는 학과 단위(복지·보건학부)로 요건을 두고 책자는 전공(트랙)별로 줄을 나눈다 — 정확히 안 맞으면 괄호 앞 학과명으로 찾는다.
    const dept = byNorm.get(normName(baseName)) || byNorm.get(normName(baseName.split('(')[0]));
    const isTrackRow = dept && normName(baseName) !== normName(dept);
    const parsed = row.liberal !== undefined ? { ...row } : parseRowByBins(row, bins);
    if (!parsed) { specials.push({ name: row.name, page: row.page, dept: dept || null }); continue; }
    if (!dept) { unmatched.push({ name: row.name, page: row.page }); continue; }
    matchedDepts.add(dept);
    const s = seedValues(reqs, dept, year);
    if (!s.hasCore) { findings.push({ dept, kind: 'SEED_HAS_NO_ROWS_FOR_YEAR', pdf: parsed }); continue; }
    compared++;
    const diffs = [];
    // 책자 행에서 읽힌(null 아닌) 칸만 시드와 비교한다.
    for (const f of ['liberal', 'base', 'major', 'free', 'total']) if (parsed[f] != null && s[f] !== parsed[f]) diffs.push({ field: f, pdf: parsed[f], seed: s[f] });
    // 최소전공: 시드에는 전과/편입 행이 따로 있다. 둘 중 있는 값이 책자와 같아야 한다(서술 행은 최소전공 수치가 없어 생략).
    // 트랙별 줄(복지·보건학부 사회복지학/보건행정학)은 시드가 학과 단위 한 행이라 최소전공·전공 총계를 같은 학과의 줄끼리 비교할 수 없다.
    if (parsed.minMajor != null && !isTrackRow) {
      for (const [label, v] of [['minMajorMC', s.minMajorMC], ['minMajorTR', s.minMajorTR]]) {
        if (v == null) diffs.push({ field: label, pdf: parsed.minMajor, seed: null });
        else if (v !== parsed.minMajor) diffs.push({ field: label, pdf: parsed.minMajor, seed: v });
      }
    }
    if (isTrackRow) trackRows.push({ dept, track: row.name, pdf: parsed, seed: { minMajorMC: s.minMajorMC, minMajorTR: s.minMajorTR } });
    if (diffs.length === 0) exact++;
    else findings.push({ dept, kind: parsed.bookInconsistent ? 'BOOK_INCONSISTENT' : 'VALUE_MISMATCH', page: row.page, diffs, pdf: parsed });
  }

  // 시드에는 그 학번 자료가 있는데 PDF 총괄표에서 못 찾은 학과(PDF 쪽 누락 또는 학과명 표기 차이)
  const seedDeptsForYear = deptNames.filter((d) => seedValues(reqs, d, year).hasCore);
  const seedOnly = seedDeptsForYear.filter((d) => !matchedDepts.has(d) && !specials.some((x) => x.dept === d));

  console.log(`[${year}] 총괄표 행 ${summary.rows.length} / 수치 대조 ${compared}개 학과 (완전 일치 ${exact}) / 서술 행(SPECIAL) ${specials.length} / 이름 불일치 ${unmatched.length} / 시드에만 있는 학과 ${seedOnly.length}`);
  for (const f of findings.slice(0, show)) {
    if (f.kind === 'VALUE_MISMATCH' || f.kind === 'BOOK_INCONSISTENT') console.log(`  ${f.kind === 'BOOK_INCONSISTENT' ? '△(책자 행 자체가 교양+전공+자유≠총계)' : '✗'} ${f.dept} (p.${f.page}): ${f.diffs.map((d) => `${d.field} 책자 ${d.pdf} ≠ 시드 ${d.seed}`).join(', ')}`);
    else console.log(`  ? ${f.dept}: ${f.kind}`);
  }
  if (trackRows.length) console.log('  트랙별 줄(시드는 학과 단위 한 행):', trackRows.map((t) => `${t.track}: 책자 최소전공 ${t.pdf.minMajor ?? '-'} / 시드 전과 ${t.seed.minMajorMC}·편입 ${t.seed.minMajorTR}`).join(' ; '));
  if (specials.length) console.log('  SPECIAL(서술 행, 수동 확인):', specials.map((s) => s.name).join(', '));
  if (unmatched.length) console.log('  이름 불일치(PDF에는 있고 시드 학과명과 안 맞음):', unmatched.map((s) => s.name).join(', '));
  if (seedOnly.length) console.log('  시드에는 이 학번 자료가 있는데 총괄표에서 못 찾은 학과:', seedOnly.join(', '));
  const oi = args.indexOf('--out');
  if (oi !== -1) fs.writeFileSync(args[oi + 1], JSON.stringify({ year, compared, exact, findings, specials, unmatched, trackRows, seedOnly }, null, 1));
}

if (require.main === module) main();
module.exports = { parseRowByBins, computeBins, seedValues };
