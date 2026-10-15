const fs = require('node:fs');
const path = require('node:path');

/**
 * server/services/regulationEngine/cohortTables.js
 * 2026학년도 교육과정 책자의 학번별 이수기준표(db/curriculum/_source/2026_학번별_이수기준.json)를 (학과, 학번)으로 찾는다.
 * 원광대는 최신 책자의 학번별 표가 모든 학번에 적용된다(CLAUDE.md "교육과정 적용 원칙"). 표는 "입학 당시 소속 대학" 단위라,
 * 각 학번의 소속 대학을 그 해 책자 현황표(db/regulations/교육과정/YYYY_대학_학과_현황*.md)에서 읽는다.
 *
 * 두 곳에서 쓴다: scripts/audit/applyLatestBookletCohortTables.js(시드를 표에 맞춤)와
 * 엔진의 신설 학과 전과생 행 만들기(newDepartmentCohort.js — 학과가 생기기 전 학번의 전과생, #378).
 * 예전에는 스크립트 안에만 있었다.
 */

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TABLES_PATH = path.join(ROOT, 'db', 'curriculum', '_source', '2026_학번별_이수기준.json');
const STATUS_DIR = path.join(ROOT, 'db', 'regulations', '교육과정');

const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');
const inCohort = (range, y) => !range || ((range[0] == null || y >= range[0]) && (range[1] == null || y <= range[1]));

// ---------------------------------------------------------------- 학년도별 소속 대학(책자 Ⅰ장 현황 정리본)
// 2026 책자의 학번별 표는 "입학 당시 소속 대학" 단위로 적혀 있어, 각 학번의 소속 대학을 그 해 책자 현황표에서 읽는다.
function readCollegeByYear() {
  const byYear = {};
  for (const f of fs.readdirSync(STATUS_DIR)) {
    const m = /^(\d{4})_대학_학과_현황/.test(f) && f.match(/^(\d{4})/);
    if (!m) continue;
    const year = Number(m[1]);
    const text = fs.readFileSync(path.join(STATUS_DIR, f), 'utf8');
    const map = {};
    for (const line of text.split('\n')) {
      const cells = line.split('|').map((c) => c.trim());
      if (cells.length < 3 || !cells[1] || cells[1] === '대학' || /^-+$/.test(cells[1])) continue;
      const college = cells[1].replace(/\s*\(.*\)\s*$/, '').trim(); // "창의공과대학 (전기전자정보계열)" → 창의공과대학
      for (const raw of cells[2].split(',')) {
        const name = raw.replace(/\(\d+\)/g, '').replace(/\(5년제\)|\(2\+4\)/g, '').trim();
        if (name && name !== '-') map[norm(name)] = college;
      }
    }
    byYear[year] = map;
  }
  return byYear;
}

// 시드 학과명 → 현황표 이름 차이(이슈 #260 2017절, auditRequirements.js NAME_ALIASES와 같은 근거).
const NAME_ALIASES = { 가족아동복지학과: ['가정아동복지학과'], 원예산업학과: ['원예산업학부'], 행정·언론학부: ['행정언론학부'] };

function collegeOf(collegeByYear, departmentName, year) {
  const map = collegeByYear[year];
  if (!map) return null;
  const candidates = [departmentName, ...(NAME_ALIASES[departmentName] || [])];
  for (const c of candidates) if (map[norm(c)]) return map[norm(c)];
  return null;
}

function groupMatches(group, departmentName, college, year) {
  if (group.cohorts && !inCohort(group.cohorts, year)) return false;
  if (group.exceptDepartments && group.exceptDepartments.includes(departmentName)) return false;
  if (group.departments && group.departments.includes(departmentName)) return true;
  if (group.departmentSuffix && departmentName.endsWith(group.departmentSuffix)) return true;
  if (group.colleges && college && group.colleges.includes(college)) return true;
  return false;
}

// 표에서 (학과, 학번)에 맞는 묶음. 학과를 직접 지목한 묶음이 대학 단위 묶음보다 우선한다(예: 자연대 19 vs 자연대:스포츠과학부 23).
function pickGroup(table, departmentName, college, year) {
  const groups = table.groups.filter((g) => groupMatches(g, departmentName, college, year));
  if (groups.length === 0) return null;
  const direct = groups.filter((g) => (g.departments && g.departments.includes(departmentName)) || (g.departmentSuffix && departmentName.endsWith(g.departmentSuffix)));
  return (direct.length ? direct : groups)[0];
}

function expectedLiberal(tables, departmentName, college, year) {
  const table = tables.liberalArts.cohortTables.find((t) => inCohort(t.cohorts, year));
  if (!table) return null;
  const g = pickGroup(table, departmentName, college, year);
  if (!g) return { missing: true, page: table._page };
  if (g.special) return { special: g.special, page: table._page, label: g.label };
  const required = Object.values(g.required).reduce((s, v) => s + v, 0);
  return { required, requiredCourses: Object.keys(g.required), elective: g.elective, total: required + g.elective, page: table._page, label: g.label };
}

function expectedMajor(tables, departmentName, college, year) {
  const table = tables.major.cohortTables.find((t) => inCohort(t.cohorts, year));
  if (!table) return null;
  const g = pickGroup(table, departmentName, college, year);
  if (!g) return { missing: true, page: table._page };
  return { ...g, page: table._page };
}

function expectedGraduation(tables, departmentName, college, year) {
  const hits = tables.graduationCredits.rules.filter((r) => inCohort(r.cohorts, year) && groupMatches(r, departmentName, college, year));
  const direct = hits.filter((r) => (r.departments && r.departments.includes(departmentName)) || (r.departmentSuffix && departmentName.endsWith(r.departmentSuffix)));
  const pick = (direct.length ? direct : hits)[0];
  return pick ? pick.credits : null;
}

function certificationGroup(tables, departmentName, college) {
  const c = tables.certification;
  const isB = (c.groupB.colleges.includes(college) || c.groupB.departments.includes(departmentName));
  const isC = (c.groupC.colleges.includes(college) || c.groupC.departments.includes(departmentName));
  if (isC) return '다';
  if (isB) return '나';
  return '가';
}

let cachedCollegeByYear;
/** 학년도별 소속 대학. 한 번만 읽는다. */
function loadCollegeByYear() {
  if (cachedCollegeByYear === undefined) cachedCollegeByYear = readCollegeByYear();
  return cachedCollegeByYear;
}

let cachedTables;
/** 학번별 표. 한 번만 읽고, 없거나 깨졌으면 null(이 표를 쓰는 기능만 빠지고 서버는 그대로 — schedule4.js와 같은 방식). */
function loadCohortTables() {
  if (cachedTables !== undefined) return cachedTables;
  try {
    cachedTables = JSON.parse(fs.readFileSync(TABLES_PATH, 'utf8'));
  } catch (err) {
    console.error('[cohortTables] 학번별 이수기준표를 읽지 못했어요:', err.message);
    cachedTables = null;
  }
  return cachedTables;
}

module.exports = {
  loadCollegeByYear, loadCohortTables, collegeOf, groupMatches, pickGroup,
  expectedLiberal, expectedMajor, expectedGraduation, certificationGroup, NAME_ALIASES,
};
