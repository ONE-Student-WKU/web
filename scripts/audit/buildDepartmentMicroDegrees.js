#!/usr/bin/env node
/**
 * scripts/audit/buildDepartmentMicroDegrees.js
 * 학과·전공별 마이크로디그리(MD) 표(db/regulations/교육과정/2026_전공별_마이크로디그리_이수체계.md — 2026 교육과정 책자 Ⅶ장 각 학과 페이지)를
 * db/seed/micro_degrees.json의 과정으로 옮긴다(#412 3단계, D-87). --apply를 주면 시드를 고치고, 없으면 무엇을 넣을지만 보고한다.
 *
 * - 과정 이름은 문서의 제목 그대로("의생명공학전공 - 의생명의료기기"). 사업단 과정과 이름이 겹치지 않는다.
 * - programGroup은 "학과·전공별 MD · <계열>"로 둔다 — 선택 화면이 사업단 과정 뒤에 계열별로 묶어 보여 준다.
 * - 이수학점은 모두 12학점(2026 책자 Ⅵ장 "모든 마이크로디그리는 총 이수학점이 12학점"). 표의 과목 학점 합은 대부분 12보다 많다 —
 *   표는 들을 수 있는 과목 목록으로 본다(해석은 다음 문의 후보 M-Q1).
 * - 과목 이수구분은 표에 없어 전공선택으로 넣는다(categoryRaw "MD"). 학년·학기는 표 값 그대로.
 * - 다시 돌려도 같은 결과가 나온다: 기존 "학과·전공별 MD" 과정을 지우고 문서에서 다시 만든다. 사업단 과정은 건드리지 않는다.
 *
 * 사용법: node scripts/audit/buildDepartmentMicroDegrees.js [--apply]
 * 시드를 고친 뒤 운영 반영은 main 머지 → db-reseed 승인(seed:linked-majors 단계가 micro_degrees를 다시 넣는다).
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'db', 'regulations', '교육과정', '2026_전공별_마이크로디그리_이수체계.md');
const SEED = path.join(ROOT, 'db', 'seed', 'micro_degrees.json');
const GROUP_PREFIX = '학과·전공별 MD · ';
const MICRO_DEGREE_CREDITS = 12;

/** 문서 → [{ name, programGroup, requiredCredits, leadProfessor, courses }] (순수 함수, 테스트에서 쓴다). */
function parseDepartmentMicroDegrees(markdown) {
  const programs = [];
  let series = null;
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^## /.test(line)) {
      series = line.slice(3).trim();
      current = null;
    } else if (/^### /.test(line)) {
      current = null;
    } else if (/^#### /.test(line)) {
      current = { name: line.slice(5).trim(), programGroup: `${GROUP_PREFIX}${series}`, requiredCredits: MICRO_DEGREE_CREDITS, leadProfessor: null, courses: [] };
      programs.push(current);
    } else if (current && /^\|/.test(line) && !/학수번호|^\|\s*-/.test(line)) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.length < 5 || !cells[1]) continue;
      const [courseCode, courseName, grade, semester, credits] = cells;
      current.courses.push({ semester, grade, category: '전공선택', categoryRaw: 'MD', courseCode, courseName, credits });
    }
  }
  return programs.filter((p) => p.courses.length > 0);
}

function run() {
  const apply = process.argv.includes('--apply');
  const programs = parseDepartmentMicroDegrees(fs.readFileSync(SOURCE, 'utf8'));
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const kept = seed.filter((m) => !String(m.programGroup || '').startsWith(GROUP_PREFIX));
  const names = new Set(kept.map((m) => m.name));
  const clash = programs.filter((p) => names.has(p.name));
  if (clash.length) throw new Error(`사업단 과정과 이름이 겹친다: ${clash.map((p) => p.name).join(', ')}`);

  const short = programs.filter((p) => p.courses.reduce((s, c) => s + Number(c.credits), 0) < MICRO_DEGREE_CREDITS);
  console.log(`학과·전공별 MD ${programs.length}개, 과목 ${programs.reduce((s, p) => s + p.courses.length, 0)}개`);
  if (short.length) console.log(`과목 학점 합이 12보다 적은 과정(책자 대조 필요): ${short.map((p) => p.name).join(', ')}`);
  if (!apply) return;
  fs.writeFileSync(SEED, `${JSON.stringify([...kept, ...programs], null, 2)}\n`);
  console.log(`db/seed/micro_degrees.json 갱신: 사업단 ${kept.length}개 + 학과·전공별 ${programs.length}개`);
}

if (require.main === module) run();

module.exports = { parseDepartmentMicroDegrees, GROUP_PREFIX };
