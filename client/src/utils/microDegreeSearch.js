// 마이크로디그리 고르기(Onboarding.jsx)의 묶음·검색에 쓰는 순수 함수. 검색 기준은 학과 검색(departmentTree.js)과 같다.
import { normalizeForSearch, searchVariants } from './departmentTree.js';

// 학과·전공별 과정 묶음 이름의 머리말(db/seed/micro_degrees.json). 그 뒤가 계열 이름이다("학과·전공별 MD · 공학3계열").
export const DEPARTMENT_MD_PREFIX = '학과·전공별 MD';

/** 목록을 사업단·묶음(programGroup)별로 묶는다 — 목록 순서(서버가 묶음·이름순으로 준다)를 그대로 지킨다. 반환 [[묶음, 과정[]], ...] */
export function groupByProgram(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.programGroup || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()];
}

// 학과·전공 이름을 비교할 줄기로 — "컴퓨터·소프트웨어공학과"와 과정 이름 앞부분 "컴퓨터·소프트웨어공학전공"이 같게,
// "게임콘텐츠학과"와 "게임콘텐츠학전공"이 같게 끝의 학과·학부·전공·과와 "학"을 뗀다.
function stem(name) {
  return normalizeForSearch(name)
    .replace(/(학과|학부|전공|과)$/, '')
    .replace(/학$/, '');
}

/**
 * 학생 학과의 학과·전공별 과정 묶음 이름. 과정 이름 앞부분("○○전공 - 과정")이 학생의 학과·세부전공·이후 학과 이름과 같거나,
 * 묶음 이름의 계열이 학생 학과(광역 계열)와 같으면 그 묶음. 못 찾으면 null — 그때는 모든 묶음을 접어서 보여 준다.
 * @param {Array<{ name, programGroup }>} options
 * @param {string[]} names — 학과 이름, 세부전공 이름, 이후 학과 이름(비어 있는 값은 무시)
 */
export function findMyMicroDegreeGroup(options, names) {
  const stems = new Set(names.filter(Boolean).map(stem).filter(Boolean));
  if (stems.size === 0) return null;
  const departmentGroups = options.filter((m) => (m.programGroup || '').startsWith(DEPARTMENT_MD_PREFIX));
  const bySeries = departmentGroups.find((m) => stems.has(stem(m.programGroup.slice(DEPARTMENT_MD_PREFIX.length))));
  if (bySeries) return bySeries.programGroup;
  const byMajor = departmentGroups.find((m) => m.name.includes(' - ') && stems.has(stem(m.name.split(' - ')[0])));
  return byMajor ? byMajor.programGroup : null;
}

/**
 * 과정 이름이나 묶음 이름에 검색어가 들어 있는 과정. 학과 검색과 같은 정규화(공백·가운뎃점·괄호 무시)와 줄임말("컴소")을 쓰고,
 * 이름이 검색어로 시작 → 이름에 포함 → 묶음 이름에 포함 순으로 앞에 둔다(같은 단계면 원래 순서).
 */
export function searchMicroDegrees(options, query) {
  const q = normalizeForSearch(query);
  if (!q) return [];
  const variants = searchVariants(q);
  const scoreFor = (m, v) => {
    const name = normalizeForSearch(m.name);
    if (name.startsWith(v)) return 0;
    if (name.includes(v)) return 1;
    if (normalizeForSearch(m.programGroup).includes(v)) return 2;
    return null;
  };
  const scored = [];
  options.forEach((m, index) => {
    const scores = variants.map((v) => scoreFor(m, v)).filter((s) => s !== null);
    if (scores.length) scored.push({ m, score: Math.min(...scores), index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map(({ m }) => m);
}
