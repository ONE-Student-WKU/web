#!/usr/bin/env node
/**
 * scripts/audit/crossYearConsistency.js
 * db/curriculum/_source/YYYY_학과별_전공과목_원본.json 전체(학년도별)를 같은 학과·같은 학수번호로 이어 보고,
 * "앞뒤 학년도는 같은 값인데 그 해만 다른 값"(A,B,A 패턴)을 찾는다.
 *
 * 왜 이런 검사를 하는가: 교육과정은 해마다 크게 안 바뀌므로, 한 해만 튀는 값은 실제 개정이 아니라 전사·복제 오류일 가능성이 높다.
 * PDF 대조가 안 되는 해(2017 글자 깨짐, 2018·2020 스캔본)에도 쓸 수 있고, 한 번 틀린 값이 다른 해로 복제됐는지(복제 오염)도
 * 여기서 드러난다. 단, 값이 실제로 한 해 바뀌었다 돌아온 경우도 잡히므로 "오류 후보"이지 확정이 아니다 — 책자 쪽으로 확인한다.
 * 양 끝 학년도(첫 해/마지막 해)와 두 해 이상 연속으로 바뀐 경우는 이 방법으로 알 수 없다.
 *
 * 사용법: node scripts/audit/crossYearConsistency.js [--field name|credits|category|term] [--out report.json]
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_DIR = path.resolve(__dirname, '..', '..', 'db', 'curriculum', '_source');
const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');
// 영문 꼬리·표기 차이를 줄이기 위한 과목명 정제(diffPdfVsJson.nameCore와 같은 취지, 괄호/구두점 차이도 무시)
const nameKey = (s) => norm(s).replace(/[()[\]·․.,]/g, '');
const creditKey = (c) => (c == null || c === '' ? '' : String(Number(c)) === 'NaN' ? String(c) : String(Number(c)));

function loadAll() {
  const byYear = {};
  for (const y of YEARS) {
    const file = path.join(SOURCE_DIR, `${y}_학과별_전공과목_원본.json`);
    if (fs.existsSync(file)) byYear[y] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return byYear;
}

// (학과, 학수번호) → 학년도별 행. 같은 과목이 한 학과 표에 두 번 나오는 드문 경우는 첫 행만 쓴다.
function indexRows(byYear) {
  const idx = new Map();
  for (const [y, depts] of Object.entries(byYear)) {
    for (const [dept, rows] of Object.entries(depts)) {
      for (const r of rows) {
        if (!r.courseCode) continue;
        const k = `${dept}|${r.courseCode}`;
        if (!idx.has(k)) idx.set(k, {});
        if (!idx.get(k)[y]) idx.get(k)[y] = r;
      }
    }
  }
  return idx;
}

const FIELDS = {
  name: (r) => nameKey(r.courseName),
  credits: (r) => creditKey(r.credits),
  category: (r) => norm(r.categoryRaw || r.category),
  term: (r) => `${r.grade}-${r.semester}`,
};

function findOutliers(idx, years, fields) {
  const out = [];
  for (const [key, perYear] of idx) {
    const [dept, code] = key.split('|');
    for (const field of fields) {
      const get = FIELDS[field];
      for (let i = 1; i < years.length - 1; i++) {
        const [py, y, ny] = [years[i - 1], years[i], years[i + 1]];
        const [p, c, n] = [perYear[py], perYear[y], perYear[ny]];
        if (!p || !c || !n) continue; // 세 해 모두 있어야 비교
        const [pv, cv, nv] = [get(p), get(c), get(n)];
        if (pv === nv && cv !== pv) out.push({ dept, code, field, year: y, value: cv, neighbors: pv, display: { name: c.courseName, neighborName: p.courseName } });
      }
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--field');
  const fields = fi === -1 ? Object.keys(FIELDS) : [args[fi + 1]];
  const byYear = loadAll();
  const years = YEARS.filter((y) => byYear[y]);
  const outliers = findOutliers(indexRows(byYear), years, fields);

  const summary = {};
  for (const o of outliers) {
    summary[o.field] ||= {};
    summary[o.field][o.year] = (summary[o.field][o.year] || 0) + 1;
  }
  console.log('학년도:', years.join(','));
  console.log('A,B,A 이상치(앞뒤 해는 같고 그 해만 다름) 건수:', JSON.stringify(summary));
  const oi = args.indexOf('--out');
  if (oi !== -1) fs.writeFileSync(args[oi + 1], JSON.stringify(outliers, null, 1));
  return outliers;
}

if (require.main === module) main();
module.exports = { findOutliers, indexRows, loadAll, FIELDS };
