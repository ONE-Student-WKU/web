#!/usr/bin/env node
/**
 * scripts/audit/auditRagDocs.js
 * RAG 문서(db/regulations/교육과정/YYYY_*.md, db/regulations/교직/YYYY_*.md)의 "학년도 오염"을 자동 점검한다.
 * 문서는 앞 학년도 문서를 틀로 복제해 값만 바꾸는 방식으로 만들어졌으므로, 제목·출처가 가리키는 학년도와 본문이 어긋난 곳이 남을 수 있다.
 * 챗봇은 book_year(제목/파일명)로 문서를 고르기 때문에(regulationService.selectChunksByYear) 본문이 다른 해 내용이면 틀린 해 규정을 말한다.
 *
 * 점검 항목:
 *  1) 파일명 연도 ≠ H1 제목 연도 ≠ "출처:" 줄의 연도(YYYY학년도 교육과정 책자, YYYY_교육과정.pdf)
 *  2) 본문의 "미래 학년도" 언급: 문서 연도보다 큰 YYYY학년도/학번 표기(그 해 책자가 알 수 없는 개편/값이 섞였을 가능성).
 *     정당한 경우(예: "2027학번부터 개편 예정", 비교 서술)도 있으므로 후보로만 센다.
 *  3) 문서 연도 외의 "입학생" 표 제목이 그 해 책자에 실제 있는 학번 구간인지는 사람이 본다(이 스크립트는 구간 목록만 추출).
 *
 * 사용법: node scripts/audit/auditRagDocs.js [--show 40] [--out report.json]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', 'db', 'regulations');
const DIRS = ['교육과정', '교직'];

function listDocs() {
  const out = [];
  for (const d of DIRS) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = /^(\d{4})_.*\.md$/.exec(f);
      if (m) out.push({ file: path.join(d, f), year: Number(m[1]), text: fs.readFileSync(path.join(dir, f), 'utf8') });
    }
  }
  return out;
}

const yearsIn = (s) => [...s.matchAll(/(?<!\d)(20\d{2})\s*(?:학년도|학번|년도)/g)].map((m) => Number(m[1]));

function audit(doc) {
  const lines = doc.text.split(/\r?\n/);
  const h1 = lines.find((l) => l.startsWith('# ')) || '';
  const h1Years = yearsIn(h1);
  const sourceLine = lines.find((l) => /^출처:/.test(l)) || '';
  const sourceYears = [...sourceLine.matchAll(/(20\d{2})(?:학년도|_교육과정)/g)].map((m) => Number(m[1]));
  const issues = [];
  if (h1Years.length && !h1Years.includes(doc.year)) issues.push({ kind: 'H1_YEAR_MISMATCH', detail: h1 });
  if (sourceYears.length && !sourceYears.includes(doc.year)) issues.push({ kind: 'SOURCE_YEAR_MISMATCH', detail: sourceLine.slice(0, 120) });
  if (!h1Years.length) issues.push({ kind: 'H1_HAS_NO_YEAR', detail: h1 });

  const future = [];
  lines.forEach((l, i) => {
    for (const y of yearsIn(l)) if (y > doc.year && y <= 2030) future.push({ line: i + 1, year: y, text: l.trim().slice(0, 140) });
  });
  return { file: doc.file, year: doc.year, issues, futureMentions: future };
}

function main() {
  const args = process.argv.slice(2);
  const si = args.indexOf('--show');
  const show = si === -1 ? 30 : Number(args[si + 1]);
  const docs = listDocs();
  const results = docs.map(audit);
  const bad = results.filter((r) => r.issues.length);
  const futureTotal = results.reduce((s, r) => s + r.futureMentions.length, 0);
  console.log(`RAG 문서 ${docs.length}개 / 제목·출처 연도 불일치 문서 ${bad.length}개 / 미래 학년도 언급 ${futureTotal}건(후보)`);
  for (const r of bad) console.log(`  ✗ ${r.file}: ${r.issues.map((i) => `${i.kind} ${i.detail}`).join(' | ')}`);
  const withFuture = results.filter((r) => r.futureMentions.length);
  for (const r of withFuture.slice(0, show)) {
    console.log(`  △ ${r.file}: 미래 학년도 언급 ${r.futureMentions.length}건 — 예) L${r.futureMentions[0].line} ${r.futureMentions[0].text}`);
  }
  const oi = args.indexOf('--out');
  if (oi !== -1) fs.writeFileSync(oi === -1 ? '' : args[oi + 1], JSON.stringify(results, null, 1));
}

if (require.main === module) main();
module.exports = { audit, listDocs, yearsIn };
