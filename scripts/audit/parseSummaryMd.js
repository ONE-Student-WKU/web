#!/usr/bin/env node
/**
 * scripts/audit/parseSummaryMd.js
 * 텍스트가 없는 책자(2017 글자 깨짐, 2018·2020 스캔본)는 PDF에서 총괄표를 기계로 읽을 수 없다. 이 경우 이미 사람이/AI가
 * 이미지를 읽어 옮겨 둔 해설 문서(db/regulations/교육과정/YYYY_교육과정_해설.md)의 총괄표 마크다운 표를 같은 모양의
 * summary.json({rows:[{name, liberal, base, minMajor, major, free, total}]})으로 바꿔 auditRequirements.js에 넘긴다.
 * 이 표는 "전사본"이라 그 자체가 오류를 가질 수 있다 — 반드시 쪽 이미지로 표본을 확인한다(DATA_AUDIT.md의 2017 절 참고).
 *
 * 사용법: node scripts/audit/parseSummaryMd.js <md경로> [--out summary.json]
 * 열 규칙: 표의 오른쪽 6칸 = 교양 계, 기본전공, 최소전공, 주전공, 일반선택, 졸업학점 계. 숫자가 아닌 칸("-", "교육과정에 따라…")은 null.
 */
const fs = require('node:fs');

const num = (s) => {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(String(s));
  return m ? Number(m[1]) : null;
};

function parse(md) {
  const rows = [];
  let inSummary = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^#{2,3} .*총괄표/.test(line)) { inSummary = true; continue; }
    if (/^#{2,3} /.test(line) && !/총괄표/.test(line)) inSummary = false;
    if (!inSummary || !line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 7 || /^-+$/.test(cells[1] || '') || cells[0] === '학과(부)') continue;
    const tail = cells.slice(-6);
    const [liberal, base, minMajor, major, free, total] = tail.map(num);
    rows.push({ name: cells[0], liberal, base, minMajor, major, free, total, raw: cells.slice(-6) });
  }
  return rows;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('사용법: node scripts/audit/parseSummaryMd.js <md경로> [--out summary.json]'); process.exit(2); }
  const rows = parse(fs.readFileSync(file, 'utf8'));
  const oi = args.indexOf('--out');
  if (oi !== -1) fs.writeFileSync(args[oi + 1], JSON.stringify({ file, rows }));
  const bad = rows.filter((r) => r.liberal != null && r.major != null && r.free != null && r.total != null && r.liberal + r.major + r.free !== r.total);
  console.log(`${file}: 총괄표 행 ${rows.length}개, 교양+주전공+자유≠총계인 행 ${bad.length}개 ${bad.map((b) => b.name).join(', ')}`);
}
module.exports = { parse };
