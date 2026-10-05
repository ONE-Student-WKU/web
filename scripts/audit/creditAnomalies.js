#!/usr/bin/env node
/**
 * scripts/audit/creditAnomalies.js
 * db/curriculum/_source/YYYY_학과별_전공과목_원본.json에서 학점이 이상한 행을 학년도별로 센다.
 *  - 빈 학점(''/null): 책자에 학점이 안 찍힌 칸이거나 추출 누락
 *  - 0학점: 졸업논문처럼 책자도 0으로 인쇄한 경우와, P/F 과목인데 도구가 0으로 내려줘서 P 복원이 빠진 경우가 섞인다
 *  - 비정수·큰 학점: 0.5 단위(임상술기 등)는 정상, 그 밖의 소수/10 이상은 확인 대상
 * 왜 필요한가: 2017·2018은 학교 조회 도구 값에 책자 이미지로 P를 복원한 이력이 있어(커밋 1b41f10, #270), 복원이 빠진 행이 남았는지
 * 자동으로 다시 볼 수 있어야 한다. 0학점인 행은 과목명으로 "졸업논문/시험·작품" 같은 알려진 0학점 과목을 따로 센다.
 *
 * 사용법: node scripts/audit/creditAnomalies.js [--list 2017] [--out report.json]
 */
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_DIR = path.resolve(__dirname, '..', '..', 'db', 'curriculum', '_source');
const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const KNOWN_ZERO = /졸업.*(논문|시험|작품)|논문/; // 책자도 0학점으로 인쇄하는 졸업논문류(시행규칙 제118조 졸업논문은 P/F)

function load(y) {
  const f = path.join(SOURCE_DIR, `${y}_학과별_전공과목_원본.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

function analyze(year, data) {
  const out = { year, rows: 0, blank: [], zero: [], zeroKnown: 0, odd: [], pf: 0 };
  for (const [dept, rows] of Object.entries(data)) {
    for (const r of rows) {
      out.rows++;
      const c = r.credits;
      const entry = { dept, grade: r.grade, semester: r.semester, code: r.courseCode, name: r.courseName, credits: c };
      if (c === 'P') { out.pf++; continue; }
      if (c === '' || c == null) { out.blank.push(entry); continue; }
      const n = Number(c);
      if (Number.isNaN(n)) { out.odd.push(entry); continue; }
      if (n === 0) { if (KNOWN_ZERO.test(r.courseName)) out.zeroKnown++; else out.zero.push(entry); continue; }
      if (n >= 10 || (!Number.isInteger(n) && n % 0.5 !== 0)) out.odd.push(entry);
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const li = args.indexOf('--list');
  const listYear = li === -1 ? null : Number(args[li + 1]);
  const report = [];
  for (const y of YEARS) {
    const data = load(y);
    if (!data) continue;
    const a = analyze(y, data);
    report.push(a);
    console.log(`[${y}] 행 ${a.rows} / P ${a.pf} / 빈 학점 ${a.blank.length} / 0학점(졸업논문류 제외) ${a.zero.length} (졸업논문류 0학점 ${a.zeroKnown}) / 이상 학점 ${a.odd.length}`);
    if (listYear === y) for (const e of [...a.blank, ...a.zero, ...a.odd].slice(0, 60)) console.log(`   ${e.dept} ${e.grade}-${e.semester} ${e.code} ${e.name} [${e.credits}]`);
  }
  const oi = args.indexOf('--out');
  if (oi !== -1) fs.writeFileSync(args[oi + 1], JSON.stringify(report, null, 1));
}

if (require.main === module) main();
module.exports = { analyze };
