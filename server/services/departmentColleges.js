const fs = require('node:fs');
const path = require('node:path');

/**
 * server/services/departmentColleges.js
 * 온보딩 학과 선택 화면의 "소속(단과대학) → 학과" 트리를 위한 학과별 소속 대학 판정.
 *
 * 원천: 학칙 [별표 1](입학정원) 표에서 뽑은 db/regulation-engine/schedule1_colleges.json — 학년도별 표(2024·2025·2026·2027~)마다
 * 대학 → 학과(단위) 목록이 있다. 학과의 소속은 개편마다 바뀌므로(예: 컴퓨터·소프트웨어공학과는 2025까지 창의공과대학, 2026부터
 * 공학3계열이 공과대학) "현재" 기준은 가장 최근에 학생을 뽑는 학년도(2026) 표로 정한다.
 *
 * 규칙(순서대로):
 *  1. 2026학년도 표에 그 이름이 있으면 그 대학 — 현재 학과(former=false).
 *  2. 없으면 개편 이력(department_lineage)의 후속 학과 중 2026 표에 있는 것이 있으면 그 대학 — 이전 학과(former=true, 옛 이름이라
 *     학생이 옛 이름으로 들어 있으므로 후속 학과가 속한 대학 아래에 "이전 학과"로 보여준다).
 *  3. 그래도 못 찾으면 college=null — 화면이 "이전 학과(개편·폐지)" 묶음에 둔다. 추측으로 대학을 붙이지 않는다.
 * 자료 파일을 못 읽으면 모두 null(트리 대신 기존처럼 평평한 목록이 보인다) — 학과 선택 자체가 이 파일에 의존하지 않게 한다.
 */

const COLLEGES_PATH = path.resolve(__dirname, '..', '..', 'db', 'regulation-engine', 'schedule1_colleges.json');
const CURRENT_COHORT_YEAR = 2026;

let cached; // undefined = 아직 안 읽음, null = 읽기 실패

function loadColleges() {
  if (cached !== undefined) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(COLLEGES_PATH, 'utf8'));
  } catch (err) {
    console.error('[departmentColleges] 학칙 [별표 1] 대학 소속 자료를 읽지 못했어요(학과 트리 생략):', err.message);
    cached = null;
  }
  return cached;
}

// [별표 1]의 학과 칸에는 표시 기호가 섞여 있다(<의학과>** 등) — 이름만 남긴다. "(외국인전용)" 같은 비고 칸은 학과가 아니다.
function cleanUnitName(unit) {
  const name = String(unit).replace(/[<>*]/g, '').trim();
  if (!name || /^\(.*\)$/.test(name)) return null;
  return name;
}

/** 2026학년도 표의 대학 순서와 대학별 학과 이름 목록. 자료가 없으면 null. */
function currentColleges(data = loadColleges()) {
  const table = data?.tables?.find((t) => t.cohort.min <= CURRENT_COHORT_YEAR && (t.cohort.max == null || t.cohort.max >= CURRENT_COHORT_YEAR));
  if (!table) return null;
  return table.colleges
    .map((c) => ({ college: c.college, units: c.units.map(cleanUnitName).filter(Boolean) }))
    .filter((c) => c.units.length > 0);
}

/**
 * 학과 목록에 소속 대학을 붙인다.
 * departments: [{ id, name, successors: [{ name }] }] → 같은 항목에 college(문자열|null), former(boolean), collegeOrder(숫자|null)를 더해 돌려준다.
 */
function attachColleges(departments, data = loadColleges()) {
  const colleges = currentColleges(data);
  const collegeByUnit = new Map();
  const orderByCollege = new Map();
  (colleges || []).forEach((c, index) => {
    orderByCollege.set(c.college, index);
    for (const unit of c.units) if (!collegeByUnit.has(unit)) collegeByUnit.set(unit, c.college);
  });

  return departments.map((d) => {
    let college = collegeByUnit.get(d.name) ?? null;
    let former = false;
    if (!college) {
      const successorCollege = (d.successors || []).map((s) => collegeByUnit.get(s.name)).find(Boolean);
      if (successorCollege) {
        college = successorCollege;
        former = true;
      } else if (colleges) {
        former = true; // 자료는 있는데 어디에도 못 붙인 학과 = 개편·폐지된 이전 학과
      }
    }
    return { ...d, college, former, collegeOrder: college ? orderByCollege.get(college) : null };
  });
}

module.exports = { attachColleges, currentColleges, cleanUnitName };
