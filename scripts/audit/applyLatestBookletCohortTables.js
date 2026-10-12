#!/usr/bin/env node
/**
 * scripts/audit/applyLatestBookletCohortTables.js
 * 최신 교육과정 책자(2026)의 학번별 이수기준표(db/curriculum/_source/2026_학번별_이수기준.json)를
 * db/seed/curriculum_requirements.json의 2017~2026학번 일반 요건 행과 대조하고, --apply를 주면 시드를 그 값으로 고친다.
 *
 * 왜 최신 책자인가: 원광대는 교육과정이 개편되면 그 전 학번에도 최신 교육과정을 적용하고, 학번별 차이는 최신 책자의 학번별 표(경과조치)로 둔다
 * (2026 책자 15쪽 경과조치 가, 교육혁신과 면담 2026-10-12 — docs/regulation-engine/LATEST_CURRICULUM_2026-10-12.md).
 * 예전 시드는 학번마다 "그 해 책자"의 값을 넣어서(예: 전기공학과 2019학번 교양 40) 지금 적용되는 값(23)과 달랐다.
 *
 * 고치는 것(일반 요건 행, enrollmentType=null):
 *  - 교양필수·교양선택: 학번별 교양표의 값(교양필수 = 지정 과목 합, 교양선택 = 영역 구분 없이 N). requiredCourses는 표의 영역 이름.
 *  - 전공필수·전공선택: 학번별 전공표가 그 학과를 지목하고 값이 다를 때만(기본전공 하한, 계). 표가 지목하지 않는 학과는 그대로 두고 보고만 한다.
 *  - 전공(통합 행, 의약계열): 시드 관례대로 졸업학점 − 교양 (교양이 바뀌면 같이 다시 계산).
 *  - 일반선택: 졸업학점 − 교양 − 전공 (졸업학점은 책자 15쪽 표로 검증만 하고 바꾸지 않는다).
 *  - 졸업인증제 2017~2019학번: 최신 책자의 "2020학번 이전 입학생" 표(가·나 그룹)로 교체. 2020~은 이미 같은 표.
 * 바꾸지 않는 것: 졸업학점 총계, 전과·편입 완화 행, 졸업논문·교직기본이수 행, 2016학번 이하.
 *
 * 사용법: node scripts/audit/applyLatestBookletCohortTables.js [--apply] [--out report.json]
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SEED = path.join(ROOT, 'db', 'seed', 'curriculum_requirements.json');
const TABLES = path.join(ROOT, 'db', 'curriculum', '_source', '2026_학번별_이수기준.json');
const STATUS_DIR = path.join(ROOT, 'db', 'regulations', '교육과정');
const LATEST_BOOKLET_YEAR = 2026;
const FIRST_COHORT = 2017;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : null;

const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');
const inCohort = (range, y) => !range || ((range[0] == null || y >= range[0]) && (range[1] == null || y <= range[1]));

// ---------------------------------------------------------------- 학년도별 소속 대학(책자 Ⅰ장 현황 정리본)
// 2026 책자의 학번별 표는 "입학 당시 소속 대학" 단위로 적혀 있어, 각 학번의 소속 대학을 그 해 책자 현황표에서 읽는다.
function loadCollegeByYear() {
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

// ---------------------------------------------------------------- 시드 행 접근
const applies = (r, y) => (r.minAdmissionYear == null || y >= r.minAdmissionYear) && (r.maxAdmissionYear == null || y <= r.maxAdmissionYear);
const CORE = ['교양필수', '교양선택', '전공필수', '전공선택', '전공'];

function generalRows(rows, dept, year) {
  return rows.filter((r) => r.departmentName === dept && r.enrollmentType == null && applies(r, year));
}

/**
 * 학번 범위가 걸친 행(예: 2017~2021)을 바꿀 때, 같은 범위의 다른 학번이 다른 값을 가져야 하면 행을 쪼갠다.
 * 여기서는 단순하게: 바꿀 (학과, 카테고리, 학번) 조합을 모으고, 각 원본 행을 학번 단위로 펼친 뒤 같은 값끼리 연속 구간으로 다시 묶는다.
 */
function splitAndMerge(rows, edits) {
  // edits: Map<rowIndex, Map<year, patch>>
  const out = [];
  rows.forEach((row, idx) => {
    const perYear = edits.get(idx);
    if (!perYear) { out.push(row); return; }
    const lo = row.minAdmissionYear ?? FIRST_COHORT;
    const hi = row.maxAdmissionYear ?? LATEST_BOOKLET_YEAR;
    const segments = [];
    for (let y = lo; y <= hi; y++) {
      const patch = perYear.get(y) || null;
      const value = patch ? { ...row, ...patch } : { ...row };
      const key = JSON.stringify([value.requiredCredits, value.description, value.requiredCourses, value.minCourseCount]);
      const last = segments[segments.length - 1];
      if (last && last.key === key) last.hi = y;
      else segments.push({ key, lo: y, hi: y, value });
    }
    for (const s of segments) {
      out.push({ ...s.value, minAdmissionYear: s.lo === lo && row.minAdmissionYear == null ? null : s.lo, maxAdmissionYear: s.hi === hi && row.maxAdmissionYear == null ? null : s.hi });
    }
  });
  return out;
}

// ---------------------------------------------------------------- 주 처리
// 테스트(server/test/graduation.audit.test.js)가 require해서 "시드가 표와 어긋나지 않았는지"를 확인하므로 report를 돌려준다.
function main({ apply = APPLY, out = OUT, quiet = false } = {}) {
  const raw = fs.readFileSync(SEED, 'utf8');
  const rows = JSON.parse(raw);
  const tables = JSON.parse(fs.readFileSync(TABLES, 'utf8'));
  const collegeByYear = loadCollegeByYear();
  const depts = [...new Set(rows.map((r) => r.departmentName))];

  const report = { changes: [], unverified: [], special: [], gradMismatch: [], counts: {} };
  const edits = new Map(); // rowIndex → Map<year, patch>
  const newRows = []; // 학과의 마지막 행 뒤에 끼워 넣을 새 행
  const addEdit = (idx, year, patch) => {
    if (!edits.has(idx)) edits.set(idx, new Map());
    edits.get(idx).set(year, { ...(edits.get(idx).get(year) || {}), ...patch });
  };
  const note = (page) => `(2026학년도 교육과정 책자 학번별 표, ${page} — 최신 책자가 전 학번에 적용, 교육혁신과 면담 2026-10-12)`;

  for (const dept of depts) {
    for (let year = FIRST_COHORT; year <= LATEST_BOOKLET_YEAR; year++) {
      const g = generalRows(rows, dept, year);
      if (!g.some((r) => CORE.includes(r.category))) continue;
      const college = collegeOf(collegeByYear, dept, year) || collegeOf(collegeByYear, dept, year - 1) || null;
      const idx = (cat) => rows.findIndex((r) => r.departmentName === dept && r.enrollmentType == null && r.category === cat && applies(r, year));
      const val = (cat) => { const i = idx(cat); return i >= 0 ? Number(rows[i].requiredCredits) : null; };

      const lib = expectedLiberal(tables, dept, college, year);
      const maj = expectedMajor(tables, dept, college, year);
      const grad = expectedGraduation(tables, dept, college, year);

      const curLibReq = val('교양필수'), curLibEle = val('교양선택');
      const curLib = (curLibReq ?? 0) + (curLibEle ?? 0);
      const curMajorReq = val('전공필수'), curMajorEle = val('전공선택'), curMajorMerged = val('전공');
      const curMajor = curMajorMerged != null ? curMajorMerged : (curMajorReq ?? 0) + (curMajorEle ?? 0);
      const curFree = val('일반선택');
      const curTotal = curLib + curMajor + (curFree ?? 0);

      if (grad != null && curTotal !== grad) report.gradMismatch.push({ dept, year, seedTotal: curTotal, booklet: grad });

      // --- 교양. 본과(의학과·치의학과·한의학과)는 교양 행이 없다(교양은 예과에서 이수) — 표의 '의대·치대·한의대' 행은 예과 몫이라 건너뛴다.
      let newLib = curLib;
      const hasLiberalRows = curLibReq != null || curLibEle != null;
      if (!hasLiberalRows) {
        report.special.push({ dept, year, what: '교양 행 없음(본과) — 건너뜀' });
      } else if (!lib || lib.missing) {
        report.unverified.push({ dept, year, college, what: '교양(학번별 교양표에 소속이 없음)' });
      } else if (lib.special) {
        report.special.push({ dept, year, what: `교양 ${lib.special}` });
      } else if (lib.total !== curLib || lib.required !== curLibReq) {
        newLib = lib.total;
        report.changes.push({ dept, year, college, what: '교양', from: `${curLibReq}+${curLibEle}=${curLib}`, to: `${lib.required}+${lib.elective}=${lib.total}`, group: lib.label, page: lib.page });
        const iReq = idx('교양필수'), iEle = idx('교양선택');
        if (iReq >= 0) addEdit(iReq, year, { requiredCredits: lib.required, requiredCourses: lib.requiredCourses, description: `${lib.requiredCourses.map((k) => `${k}${{ 건학이념: 3, 대학생활: 2, 전공탐색과진로: 4 }[k]}`).join('+')} ${note(lib.page)}` });
        if (iEle >= 0) addEdit(iEle, year, { requiredCredits: lib.elective, description: `영역 구분 없이 ${lib.elective}학점 (${year}학번 ${lib.label}) ${note(lib.page)}` });
      }

      // --- 전공
      let newMajor = curMajor;
      if (!maj || maj.missing) {
        report.unverified.push({ dept, year, college, what: `전공(학번별 전공표가 이 학과를 지목하지 않음, 시드 ${curMajor})` });
      } else if (maj.special === 'CURRICULUM' || maj.special === 'PHARM' || maj.special === 'REQUIRED_INCLUDED_69' || maj.special === 'SPECIAL_EDU_82' || maj.special === 'TRACK_TYPE') {
        if (maj.total != null && curMajor !== maj.total && curMajorMerged != null) {
          newMajor = maj.total;
          report.changes.push({ dept, year, college, what: '전공(통합 행)', from: curMajor, to: maj.total, page: maj.page });
          addEdit(idx('전공'), year, { requiredCredits: maj.total, description: `${rows[idx('전공')].description.split(' (')[0]} ${note(maj.page)}` });
        } else if (maj.special === 'CURRICULUM') {
          // 책자에 전공 숫자가 없는 학과(의·치·한·한약·간호·건축): 시드의 전공 값은 "졸업학점 − 옛 교양"으로 만든 추정치다. 교양이 줄었다고 전공 추정치를
          // 늘리면 학생에게 없는 전공 요건을 더 지우게 되므로 전공은 그대로 두고, 줄어든 교양만큼을 일반선택(자유선택)이 흡수한다(총 졸업학점 유지).
          if (newLib !== curLib) report.special.push({ dept, year, what: `전공 숫자 없는 학과 — 전공 ${curMajor} 유지, 교양 차이(${curLib}→${newLib})는 일반선택으로` });
        } else if (maj.total != null && curMajor !== maj.total) {
          report.unverified.push({ dept, year, college, what: `전공 ${maj.special} 시드 ${curMajor} vs 표 ${maj.total}(행 구조가 달라 자동 수정 안 함)` });
        }
      } else if (maj.base != null && (curMajorReq !== maj.base || curMajor !== maj.total)) {
        if (curMajorReq == null || curMajorEle == null) {
          report.unverified.push({ dept, year, college, what: `전공 시드 ${curMajor}(통합 행) vs 표 기본${maj.base}/계${maj.total}` });
        } else {
          newMajor = maj.total;
          report.changes.push({ dept, year, college, what: '전공', from: `${curMajorReq}+${curMajorEle}=${curMajor}`, to: `${maj.base}+${maj.total - maj.base}=${maj.total}`, page: maj.page });
          addEdit(idx('전공필수'), year, { requiredCredits: maj.base, description: `기본전공 ${maj.base}학점 이상 이수 (${year}학번, 전공계 ${maj.total}학점 중 기본전공+선택전공은 하나의 풀) ${note(maj.page)}` });
          addEdit(idx('전공선택'), year, { requiredCredits: maj.total - maj.base, description: `선택전공 - 기본전공(${maj.base})과 합쳐 전공계 ${maj.total}학점 충족 (${year}학번) ${note(maj.page)}` });
        }
      }

      // --- 일반선택 = 졸업학점 − 교양 − 전공
      const iFree = idx('일반선택');
      if (iFree >= 0 && grad != null) {
        const newFree = grad - newLib - newMajor;
        if (newFree !== curFree) {
          if (newFree < 0) report.unverified.push({ dept, year, college, what: `일반선택이 음수(${newFree}) — 졸업학점 ${grad}, 교양 ${newLib}, 전공 ${newMajor}` });
          else {
            report.changes.push({ dept, year, college, what: '일반선택', from: curFree, to: newFree });
            addEdit(iFree, year, { requiredCredits: newFree, description: `자유선택 ${newFree}학점 (총 ${grad} − 전공 ${newMajor} − 교양 ${newLib}) ${note('뷰어 16쪽 졸업이수학점표')}` });
          }
        }
      }

      // --- 졸업인증제 2017~2019: 최신 책자의 "2020학번 이전 입학생" 표
      if (year <= 2019) {
        const grp = certificationGroup(tables, dept, college);
        const spec = tables.certification.groups[grp];
        const iCert = rows.findIndex((r) => r.departmentName === dept && r.category === '졸업인증제' && applies(r, year));
        if (grp === '다') {
          if (iCert >= 0) report.unverified.push({ dept, year, college, what: '졸업인증제 다 그룹인데 기본영역 행이 있음(수정 안 함)' });
        } else if (iCert < 0) {
          report.changes.push({ dept, year, college, what: `졸업인증제 행 추가(${grp} 그룹)`, from: '없음', to: `${spec.courses.join('/')} 중 ${spec.minCourseCount}` });
          newRows.push({ departmentName: dept, category: '졸업인증제', requiredCredits: 0, minAdmissionYear: year, maxAdmissionYear: year, enrollmentType: null, minCourseCount: spec.minCourseCount,
            description: `${spec.courses.join('·')} 중 ${spec.minCourseCount}과목 필수 이수 (졸업인증제 "${grp}" 그룹, 2026 책자 "2020학번 이전 입학생" 표 뷰어 19쪽) ${note('뷰어 19쪽')}`, requiredCourses: [...spec.courses] });
        } else {
          const cur = rows[iCert];
          const same = cur.minCourseCount === spec.minCourseCount && JSON.stringify([...cur.requiredCourses].sort()) === JSON.stringify([...spec.courses].sort());
          if (!same) {
            report.changes.push({ dept, year, college, what: `졸업인증제(${grp} 그룹)`, from: `${cur.requiredCourses.join('/')} 중 ${cur.minCourseCount}`, to: `${spec.courses.join('/')} 중 ${spec.minCourseCount}` });
            addEdit(iCert, year, { minCourseCount: spec.minCourseCount, requiredCourses: [...spec.courses], description: `${spec.courses.join('·')} 중 ${spec.minCourseCount}과목 필수 이수 (졸업인증제 "${grp}" 그룹, 2026 책자 "2020학번 이전 입학생" 표 뷰어 19쪽) ${note('뷰어 19쪽')}` });
          }
        }
      }
    }
  }

  report.counts = { changes: report.changes.length, unverified: report.unverified.length, special: report.special.length, gradMismatch: report.gradMismatch.length };
  const byWhat = {};
  for (const c of report.changes) byWhat[c.what] = (byWhat[c.what] || 0) + 1;
  report.counts.byWhat = byWhat;

  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  if (!quiet) {
    console.log(JSON.stringify(report.counts));
    for (const u of report.unverified) console.log('UNVERIFIED', u.dept, u.year, u.college, u.what);
    for (const m of report.gradMismatch) console.log('GRAD_MISMATCH', m.dept, m.year, 'seed', m.seedTotal, 'booklet', m.booklet);
  }

  if (!apply) return report;
  const next = splitAndMerge(rows, edits);
  // 학과 순서와 각 학과 안의 원래 순서는 유지된다(splitAndMerge가 순서를 보존). 새 행은 그 학과의 마지막 행 뒤에 넣는다.
  for (const r of newRows) {
    let last = -1;
    next.forEach((x, i) => { if (x.departmentName === r.departmentName) last = i; });
    next.splice(last + 1, 0, r);
  }
  const text = JSON.stringify(next, null, 2).replace(/\n/g, '\r\n');
  fs.writeFileSync(SEED, text);
  if (!quiet) console.log(`applied: ${rows.length} → ${next.length} rows`);
  return report;
}

if (require.main === module) main();

module.exports = { main, LATEST_BOOKLET_YEAR, FIRST_COHORT };
