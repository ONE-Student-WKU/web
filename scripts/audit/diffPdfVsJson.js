#!/usr/bin/env node
/**
 * scripts/audit/diffPdfVsJson.js
 * 책자 PDF에서 다시 뽑은 과목 행(extractPdfCourseRows.mjs 결과)과 db/curriculum/_source/YYYY_학과별_전공과목_원본.json을
 * 행 단위로 맞대어 갈라지는 곳을 분류한다. 전수 육안 확인 대신 "기계가 본 것과 JSON이 다른 행"만 사람이 보게 하는 도구.
 *
 * 사용법: node scripts/audit/diffPdfVsJson.js <rows.json> <year> [--out report.json] [--issue issue260.txt] [--show 40]
 *
 * 비교 단위는 (학수번호, 학년, 학기, 이수구분, 학점, 과목명) 6-튜플의 다중집합이다. 같은 과목이 여러 학과에 있어도 PDF와 JSON에서
 * 같은 횟수만큼 나오면 일치로 본다. 불일치 행은 같은 학수번호끼리 짝지어 분류하고, JSON 쪽에는 학과명, PDF 쪽에는 쪽수를 붙인다.
 *
 * 불일치 분류: CREDITS(학점) / NAME(과목명) / CATEGORY(이수구분) / TERM(학년·학기) / PDF_ONLY(JSON에 없음=누락 후보) /
 * JSON_ONLY(PDF에 없음=초과 후보). PDF 추출이 표를 잘못 읽은 경우(열 밀림 등)도 여기 섞이므로 "오류 후보"이지 확정이 아니다.
 */

const fs = require('node:fs');
const path = require('node:path');

const { CATEGORY_MAP } = require('../../server/services/categoryMap');
const SOURCE_DIR = path.resolve(__dirname, '..', '..', 'db', 'curriculum', '_source');

/**
 * 이슈 #260(학교 문의 후보 모음)의 "## YYYY학년도" 섹션에서 그 해 섹션에 언급된 6자리 학수번호를 모은다.
 * 이미 사람이 보고 판단·기록한 항목을 이 도구가 "새 발견"으로 다시 올리지 않게 하기 위함(중복 보고 방지).
 * 입력은 `gh issue view 260 -R ONE-Student-WKU/web --comments` 출력 텍스트. 번호만 보므로 "언급됨"일 뿐 "해결됨"은 아니다.
 */
function knownCodesFromIssue(text, year) {
  const sections = text.split(/^## /m);
  // 머리글은 "## 2024학년도"(연도 개요)와 "## [2024학년도] 5. …"(항목 묶음) 두 모양이 있다.
  const mine = sections.filter((s) => s.startsWith(`${year}학년도`) || s.startsWith(`[${year}학년도]`));
  const codes = new Set();
  for (const sec of mine) for (const m of sec.matchAll(/(?<!\d)(\d{6})(?!\d)/g)) codes.add(m[1]);
  return codes;
}

const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');
const normCredit = (c) => {
  if (c == null || c === '') return '';
  const n = Number(c);
  return Number.isNaN(n) ? String(c) : String(n);
};

function toTuple(r) {
  return {
    code: String(r.courseCode ?? ''),
    grade: String(r.grade ?? ''),
    semester: String(r.semester ?? ''),
    category: norm(r.categoryRaw),
    credits: normCredit(r.credits),
    name: norm(r.courseName),
  };
}
const keyOf = (t) => [t.code, t.grade, t.semester, t.category, t.credits, t.name].join('|');

function loadJsonRows(year) {
  const file = path.join(SOURCE_DIR, `${year}_학과별_전공과목_원본.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = [];
  for (const [department, list] of Object.entries(data)) {
    for (const c of list) {
      // 일부 연도(2025 복지·보건학부 등)는 원문 구분(categoryRaw) 없이 정규화된 category만 있다 — 그 경우 PDF의 원문 구분을
      // categoryMap으로 정규화해 비교한다(rawMissing 표시).
      const rawMissing = !c.categoryRaw;
      rows.push({ ...toTuple(c), department, rawMissing, categoryNormalized: c.category });
    }
  }
  return rows;
}

// 전체 행을 다중집합으로 맞대어 불일치를 분류한다. 학과 단위로 쪼개 비교해 봤으나, 한 학부 안에 전공이 여럿인 곳(행정·언론, 복지·보건,
// 도시공학)에서 표↔학과 배정 자체가 틀려 잡음이 더 커졌다. 전역 비교 후 학수번호로 짝지으면 그런 오류 없이 필드 차이를 잡는다.
function diffGroup(pdfRows, jsonRows) {
  const jsonByKey = new Map();
  for (const r of jsonRows) {
    const k = keyOf(r);
    if (!jsonByKey.has(k)) jsonByKey.set(k, []);
    jsonByKey.get(k).push(r);
  }
  const pdfLeft = [];
  let matched = 0;
  for (const r of pdfRows) {
    const bucket = jsonByKey.get(keyOf(r));
    if (bucket && bucket.length > 0) { bucket.pop(); matched++; } else pdfLeft.push(r);
  }
  const jsonLeft = [...jsonByKey.values()].flat();

  // 같은 학수번호끼리 짝지어 어떤 필드가 다른지 분류한다.
  const jsonByCode = new Map();
  for (const r of jsonLeft) {
    if (!jsonByCode.has(r.code)) jsonByCode.set(r.code, []);
    jsonByCode.get(r.code).push(r);
  }
  const findings = [];
  for (const p of pdfLeft) {
    const cands = jsonByCode.get(p.code) || [];
    let idx = cands.findIndex((c) => c.grade === p.grade && c.semester === p.semester);
    if (idx === -1) idx = cands.findIndex((c) => c.name === p.name);
    if (idx === -1 && cands.length > 0) idx = 0;
    if (idx === -1) { findings.push({ type: 'PDF_ONLY', pdf: p }); continue; }
    const [j] = cands.splice(idx, 1);
    const kinds = [];
    if (p.credits !== j.credits) kinds.push('CREDITS');
    if (p.name !== j.name) kinds.push('NAME');
    if (p.category !== j.category) kinds.push('CATEGORY');
    if (p.grade !== j.grade || p.semester !== j.semester) kinds.push('TERM');
    findings.push({ type: kinds.join('+') || 'OTHER', pdf: p, json: j });
  }
  for (const rest of jsonByCode.values()) for (const j of rest) findings.push({ type: 'JSON_ONLY', json: j });

  // 2차 짝짓기: 과목명·학년·학기·학점이 같은데 학수번호만 다른 PDF_ONLY ↔ JSON_ONLY는 "학수번호 불일치(CODE)"로 묶는다.
  // (JSON이 학교 조회 도구의 학수번호를 그대로 쓴 경우가 대표적이다 — 책자와 도구가 다른 번호를 줄 때.)
  const jsonOnly = findings.filter((f) => f.type === 'JSON_ONLY');
  const pairedOut = new Set();
  const merged = [];
  for (const f of findings.filter((x) => x.type === 'PDF_ONLY')) {
    const k = (r) => [r.name, r.grade, r.semester, r.credits].join('|');
    const j = jsonOnly.find((x) => !pairedOut.has(x) && k(x.json) === k(f.pdf));
    if (j) { pairedOut.add(j); pairedOut.add(f); merged.push({ type: 'CODE', pdf: f.pdf, json: j.json }); }
  }
  const rest = findings.filter((f) => !pairedOut.has(f));
  return { matched, findings: [...rest, ...merged] };
}

function diff(pdfRows, jsonRows) {
  const pdf = pdfRows.map((r) => ({ ...toTuple(r), page: r.page, deptTitle: r.deptTitle }));
  const g = diffGroup(pdf, jsonRows);
  // 후처리 1) 원문 구분이 비어 있는 JSON 행: PDF 구분을 categoryMap으로 정규화해 같으면 일치로 본다.
  // 후처리 2) PDF에 학수번호 열이 없는 표(2025 광역계열 등): 과목명·학년·학기·학점이 같으면 일치로 본다.
  const kept = [];
  const dropPdf = new Set();
  const dropJson = new Set();
  for (const f of g.findings) {
    if (f.type === 'CATEGORY' && f.json.rawMissing && CATEGORY_MAP[f.pdf.category] === f.json.categoryNormalized) { g.matched++; continue; }
    kept.push(f);
  }
  const pdfNoCode = kept.filter((f) => f.type === 'PDF_ONLY' && f.pdf.code === '');
  const jsonOnly = kept.filter((f) => f.type === 'JSON_ONLY');
  let matchedWithoutCode = 0;
  for (const f of pdfNoCode) {
    const key = (r) => [r.name, r.grade, r.semester, r.credits].join('|');
    const j = jsonOnly.find((x) => !dropJson.has(x) && key(x.json) === key(f.pdf));
    if (j) { dropPdf.add(f); dropJson.add(j); matchedWithoutCode++; g.matched++; }
  }
  // 후처리 3) JSON에 없는 학과(예: 컴퓨터·소프트웨어공학과는 _source JSON이 아니라 db/curriculum/*.md로 관리)의 PDF 행은
  // 누락이 아니라 "범위 밖"이다 — 별도 유형으로 분리해 진짜 누락 후보와 섞이지 않게 한다(DB 대조는 diffPdfVsDb.js).
  const deptKeys = [...new Set(jsonRows.map((r) => r.department))].map((k) => k.split('(')[0]);
  const inScope = (title) => !title || deptKeys.some((k) => k === title || k.startsWith(title) || title.startsWith(k));
  g.findings = kept.filter((f) => !dropPdf.has(f) && !dropJson.has(f)).map((f) => (f.type === 'PDF_ONLY' && !inScope(f.pdf.deptTitle) ? { ...f, type: 'PDF_DEPT_NOT_IN_JSON' } : f));
  g.matchedWithoutCode = matchedWithoutCode;
  const byType = {};
  for (const f of g.findings) byType[f.type] = (byType[f.type] || 0) + 1;
  return { pdfRows: pdf.length, jsonRows: jsonRows.length, matched: g.matched, matchedWithoutCode: g.matchedWithoutCode, byType, findings: g.findings };
}

function main() {
  const args = process.argv.slice(2);
  const [rowsFile, year] = args.filter((a) => !a.startsWith('--'));
  if (!rowsFile || !year) {
    console.error('사용법: node scripts/audit/diffPdfVsJson.js <rows.json> <year> [--out report.json] [--show 40]');
    process.exit(2);
  }
  const showIdx = args.indexOf('--show');
  const show = showIdx === -1 ? 30 : Number(args[showIdx + 1]);
  const outIdx = args.indexOf('--out');

  const extracted = JSON.parse(fs.readFileSync(rowsFile, 'utf8'));
  const pdfRows = extracted.rows.filter((r) => r.majorTable);
  const jsonRows = loadJsonRows(year);
  const issueIdx = args.indexOf('--issue');
  const known = issueIdx === -1 ? new Set() : knownCodesFromIssue(fs.readFileSync(args[issueIdx + 1], 'utf8'), year);
  const report = diff(pdfRows, jsonRows);
  // 독립 근거: JSON에만 있는 행의 학수번호가 PDF 어디에든 있나 / PDF에만 있는 행의 학수번호가 JSON 어디에든 있나.
  const jsonCodes = new Set(jsonRows.map((r) => r.code));
  for (const f of report.findings) {
    if (f.type === 'JSON_ONLY') f.codeAnywhereInPdf = Boolean(extracted.codePages && extracted.codePages[f.json.code]);
    if (f.type === 'PDF_ONLY') f.codeAnywhereInJson = jsonCodes.has(f.pdf.code);
  }
  for (const f of report.findings) {
    const codes = [f.pdf && f.pdf.code, f.json && f.json.code].filter(Boolean);
    f.knownIn260 = codes.some((c) => known.has(c));
  }
  report.knownIn260 = report.findings.filter((f) => f.knownIn260).length;
  report.suspects = {
    jsonOnlyCodeNotInPdf: report.findings.filter((f) => f.type === 'JSON_ONLY' && f.json.code && !f.codeAnywhereInPdf).length,
    pdfOnlyCodeNotInJson: report.findings.filter((f) => f.type === 'PDF_ONLY' && !f.codeAnywhereInJson).length,
  };

  console.log(`[${year}] PDF 전공표 행 ${report.pdfRows} / JSON 행 ${report.jsonRows} / 완전 일치 ${report.matched} (${((report.matched / report.jsonRows) * 100).toFixed(1)}%)`);
  console.log('불일치 분류:', JSON.stringify(report.byType));
  if (issueIdx !== -1) console.log(`이슈 #260 ${year}학년도 섹션에 이미 언급된 학수번호와 관련된 불일치: ${report.knownIn260}건 (새 발견에서 제외하고 볼 것)`);
  console.log('독립 근거(코드 존재 여부):', JSON.stringify(report.suspects), '— JSON에만 있는데 PDF 어디에도 없는 코드 / PDF에만 있는데 JSON 어디에도 없는 코드');
  for (const f of report.findings.slice(0, show)) {
    const p = f.pdf ? `PDF p.${f.pdf.page}(${f.pdf.deptTitle || '?'}) ${f.pdf.grade}-${f.pdf.semester} ${f.pdf.category} ${f.pdf.code} ${f.pdf.name} ${f.pdf.credits}` : '-';
    const j = f.json ? `JSON[${f.json.department || f.department}] ${f.json.grade}-${f.json.semester} ${f.json.category} ${f.json.code} ${f.json.name} ${f.json.credits}` : '-';
    console.log(` ${f.type.padEnd(14)} [${f.department || ''}] ${p}  ||  ${j}`);
  }
  if (outIdx !== -1) fs.writeFileSync(args[outIdx + 1], JSON.stringify(report, null, 1));
}

if (require.main === module) main();
module.exports = { diff, toTuple, loadJsonRows };
