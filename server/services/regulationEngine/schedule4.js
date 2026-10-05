const fs = require('node:fs');
const path = require('node:path');

/**
 * server/services/regulationEngine/schedule4.js
 * 학칙 [별표 4](졸업학점별 대학·이수학점) 표와, 교육과정 책자 기반 졸업학점(curriculum_requirements)을 서로 대조한다.
 *
 * 왜 필요한가: 졸업 총학점은 두 곳에서 나온다 — ① 학칙 [별표 4](학번 구간별 표, 학칙 제71조·시행규칙 제118조가 위임)와
 * ② 학번별 교육과정 책자의 총괄표(시드). 지금까지 시스템은 ①을 "적용(확정)"이라 하면서 숫자는 ②만 썼고 둘을 비교하지 않았다.
 * 비교해 보니 간호학과·작업치료학과·약학과에서 값이 달랐다(FINAL_REVIEW F-1). 어느 쪽이 맞는지는 학교만 안다
 * (2026.04.10. 개정으로 바뀐 것일 수도, 책자 오류일 수도 있다) — 그래서 이 모듈은 "맞는 값"을 정하지 않고 **다르다는 사실과 두 값**만 낸다.
 *
 * 대조 범위(보정 라운드 B 1-3, D-44): ① 표에 학과명이 직접 적힌 항목(DEPARTMENT, 예과) ② "○○대학"처럼 대학 단위로 적힌 항목은 학과의 소속
 * 대학을 **학칙 [별표 1]에서 읽을 수 있을 때만**(2024·2025·2026학번 이후 — schedule1_colleges.json, 병합 칸 구조로 추출) 대조한다.
 * 그 밖(2023학번 이하는 [별표 1]에 대학 열이 없음, 표에 없는 학과, 두 대학에 같은 이름이 있는 경우, [별표 1]의 대학 이름이 [별표 4]에 없는 경우)은
 * 추측하지 않고 대조하지 않는다 — "대조 안 됨"이지 "일치"가 아니다.
 * 데이터 원천: db/regulation-engine/schedule4_credits.json, schedule1_colleges.json (원본 HWPX에서 scripts/audit/hwpxTables.js가 추출).
 */

const DATA_PATH = path.resolve(__dirname, '..', '..', '..', 'db', 'regulation-engine', 'schedule4_credits.json');
const COLLEGES_PATH = path.resolve(__dirname, '..', '..', '..', 'db', 'regulation-engine', 'schedule1_colleges.json');
let cached; // undefined = 아직 안 읽음, null = 읽기 실패(대조 생략)
let cachedColleges;

/** 파일을 한 번만 읽는다. 없거나 깨졌으면 null — 대조가 빠질 뿐 서버가 죽지 않게(판단 기능 전체를 이 파일에 의존시키지 않는다). */
function loadSchedule4() {
  if (cached !== undefined) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (err) {
    console.error('[schedule4] 학칙 [별표 4] 자료를 읽지 못했어요(대조 생략):', err.message);
    cached = null;
  }
  return cached;
}

/** [별표 1] 대학 소속 자료. 읽기 실패 시 null — 대학 단위 대조만 빠지고 학과명 직접 대조는 그대로 동작한다. */
function loadSchedule1Colleges() {
  if (cachedColleges !== undefined) return cachedColleges;
  try {
    cachedColleges = JSON.parse(fs.readFileSync(COLLEGES_PATH, 'utf8'));
  } catch (err) {
    console.error('[schedule4] 학칙 [별표 1] 대학 소속 자료를 읽지 못했어요(대학 단위 대조 생략):', err.message);
    cachedColleges = null;
  }
  return cachedColleges;
}

const inRange = (range, year) => (range.min == null || year >= range.min) && (range.max == null || year <= range.max);

/**
 * (학과명, 학번) → 학번 구간에 맞는 표에서 그 학과의 항목. 없으면 null.
 * 학과명이 직접 적혀 있으면 그 항목, 아니면 [별표 1]에서 그 학번의 소속 대학을 찾아 [별표 4]에 같은 이름의 대학 항목이 있을 때만 그 항목.
 */
function findSchedule4Entry(schedule, departmentName, admissionYear, colleges = loadSchedule1Colleges()) {
  if (!schedule || !departmentName) return null;
  const table = schedule.tables.find((t) => inRange(t.cohort, admissionYear));
  if (!table) return null;
  for (const tier of table.tiers) {
    const entry = tier.entries.find((e) => e.kind !== 'UNIT' && e.name === departmentName);
    if (entry) return { tableTitle: table.title, cohort: table.cohort, credits: entry.credits ?? tier.credits, entryName: entry.name, kind: entry.kind };
  }
  const college = collegeOf(colleges, departmentName, admissionYear);
  if (!college) return null;
  for (const tier of table.tiers) {
    const entry = tier.entries.find((e) => e.kind === 'UNIT' && e.name === college.college);
    if (entry) return { tableTitle: table.title, cohort: table.cohort, credits: tier.credits, entryName: `${entry.name}(${departmentName}의 소속, ${college.source})`, kind: 'UNIT_VIA_SCHEDULE1' };
  }
  return null;
}

/** ([별표 1] 자료, 학과명, 학번) → { college, source } | null. 그 학번의 [별표 1]에 이름이 정확히 한 대학에만 있을 때만(둘 이상이면 어느 쪽인지 알 수 없으므로 null). */
function collegeOf(colleges, departmentName, admissionYear) {
  const table = colleges && colleges.tables.find((t) => inRange(t.cohort, admissionYear));
  if (!table) return null;
  const hits = table.colleges.filter((c) => c.units.includes(departmentName));
  return hits.length === 1 ? { college: hits[0].college, source: table.source } : null;
}

/** 그 학번에 적용되는 "일반 재학생" 졸업학점 합계(요건 행 합, 졸업인증제 행 제외). 입학유형별 완화·편입과 무관한 책자 총량이다(evaluate의 totalRequiredCredits와 같은 합). */
function generalTotalCredits(rows, year) {
  const applicable = (rows || []).filter((r) => r.enrollmentType == null && r.minCourseCount == null
    && (r.minAdmissionYear == null || year >= r.minAdmissionYear) && (r.maxAdmissionYear == null || year <= r.maxAdmissionYear));
  return applicable.length ? applicable.reduce((s, r) => s + Number(r.requiredCredits), 0) : null;
}

/**
 * 대조 결과. null = 대조할 수 없음(표에 학과가 직접 안 적혔거나 책자 자료 없음), { match: true } = 같음,
 * { match: false, schedule4Credits, bookCredits, ... } = 다름. 다를 때 어느 쪽이 맞는지는 판단하지 않는다.
 */
function checkSchedule4Credits({ departmentName, admissionYear, rows, schedule = loadSchedule4() }) {
  const entry = findSchedule4Entry(schedule, departmentName, admissionYear);
  const book = generalTotalCredits(rows, admissionYear);
  if (!entry || book == null) return null;
  const base = { tableTitle: entry.tableTitle, entryName: entry.entryName, schedule4Credits: entry.credits, bookCredits: book };
  return entry.credits === book ? { match: true, ...base } : { match: false, ...base };
}

module.exports = { loadSchedule4, loadSchedule1Colleges, collegeOf, findSchedule4Entry, generalTotalCredits, checkSchedule4Credits };
