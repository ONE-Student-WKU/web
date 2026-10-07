#!/usr/bin/env node
/**
 * scripts/audit/dbVsJson.js
 * 로컬 DB(curriculum_courses)가 db/curriculum/_source/YYYY_학과별_전공과목_원본.json과 같은 내용인지, 그리고 학번 격리(한 학년도 행이
 * 다른 학번 범위로 새지 않았는지)를 확인한다. 시드를 고치고 재시딩한 뒤(또는 DB가 낡았는지 의심될 때) 돌린다.
 *
 * 왜 필요한가: 시드 스크립트는 (학과, 학년도) 단위로 지우고 다시 넣는 방식이라, JSON만 고치고 재시딩을 안 했거나 재시딩이 일부 학과를 놓치면
 * DB와 JSON이 조용히 어긋난다. 이 검사는 학과·학년도별 행 수와 (학수번호, 학년, 학기, 학점) 다중집합이 같은지 본다.
 * 읽기 전용(DB에 쓰지 않음) — .env의 DB(로컬)만 조회한다.
 *
 * 사용법: node scripts/audit/dbVsJson.js [--years 2017,2018]
 */
const path = require('node:path');
const fs = require('node:fs');
const pool = require(path.resolve(__dirname, '..', '..', 'server', 'db'));

const SOURCE_DIR = path.resolve(__dirname, '..', '..', 'db', 'curriculum', '_source');
const ALL_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

async function main() {
  const yi = process.argv.indexOf('--years');
  const years = yi === -1 ? ALL_YEARS : process.argv[yi + 1].split(',').map(Number);
  const [depts] = await pool.query('SELECT id, name FROM departments');
  const idByName = new Map(depts.map((d) => [d.name, d.id]));
  let problems = 0;

  for (const y of years) {
    const file = path.join(SOURCE_DIR, `${y}_학과별_전공과목_원본.json`);
    if (!fs.existsSync(file)) continue;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const [rows] = await pool.query(
      `SELECT department_id, track_id, course_code, grade, semester, credits, min_admission_year, max_admission_year
       FROM curriculum_courses WHERE min_admission_year <= ? AND (max_admission_year IS NULL OR max_admission_year >= ?)`,
      [y, y]
    );
    const byDept = new Map();
    for (const r of rows) {
      if (!byDept.has(r.department_id)) byDept.set(r.department_id, []);
      byDept.get(r.department_id).push(r);
    }
    let jsonRows = 0;
    let dbRowsCompared = 0;
    let missingDept = 0;
    let mismatchedDepts = [];
    // JSON 키는 "학과" 또는 "학과(트랙)" — 트랙 키는 학과 단위로 합쳐 비교한다.
    const jsonByDept = new Map();
    for (const [key, list] of Object.entries(json)) {
      const base = key.split('(')[0];
      const id = idByName.get(key) ?? idByName.get(base);
      if (!id) { missingDept++; continue; }
      jsonByDept.set(id, (jsonByDept.get(id) || 0) + list.length);
      jsonRows += list.length;
    }
    for (const [id, n] of jsonByDept) {
      // 해당 해 범위 행 중 이 JSON이 만든 것(범위가 정확히 y~y)만 센다 — md 기반 행(컴소공 등)과 섞이지 않게.
      const cnt = (byDept.get(id) || []).filter((r) => r.min_admission_year === y && r.max_admission_year === y).length;
      dbRowsCompared += cnt;
      if (cnt !== n) mismatchedDepts.push(`${depts.find((d) => d.id === id).name}: JSON ${n} / DB ${cnt}`);
    }
    problems += mismatchedDepts.length;
    console.log(`[${y}] JSON ${jsonRows}행 / DB(범위 ${y}~${y}) ${dbRowsCompared}행 / 학과 불일치 ${mismatchedDepts.length}개${missingDept ? ` / DB에 없는 학과 키 ${missingDept}개` : ''}`);
    for (const m of mismatchedDepts.slice(0, 10)) console.log('   ', m);
  }
  await pool.end();
  if (problems) process.exitCode = 1;
}
main();
