// 학과 선택 트리·검색에 쓰는 순수 함수.

export const FORMER_GROUP_LABEL = '이전 학과 (개편·폐지)';

// 검색 비교용 정규화 — 공백·가운뎃점·괄호를 없애고 소문자로. "경제금융 회계세무"로 쳐도 "경제금융·회계세무계열"이 찾아지게 한다.
export function normalizeForSearch(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/[\s·ㆍ‧()（）]/g, '')
    .toLowerCase();
}

/**
 * 학과를 소속 대학별로 묶는다. 서버가 준 collegeOrder(학칙 [별표 1]의 대학 순서) 순으로 정렬하고, 대학이 없는 학과는 맨 끝의
 * "이전 학과 (개편·폐지)" 묶음으로 보낸다. 묶음 안에서는 지금 있는 학과가 먼저, 이름이 바뀐 이전 학과가 뒤(원래 서버 순서 유지).
 * 소속 정보가 전혀 없으면(서버가 college를 안 내려줌) 묶음 하나(이전 학과 묶음)만 나오므로 호출 쪽이 평평한 목록으로 바꾼다.
 */
export function groupDepartmentsByCollege(departments) {
  const byCollege = new Map();
  for (const d of departments) {
    const key = d.college || FORMER_GROUP_LABEL;
    const group = byCollege.get(key) || { college: key, order: d.college ? (d.collegeOrder ?? 999) : 10000, departments: [] };
    group.departments.push(d);
    byCollege.set(key, group);
  }
  const groups = [...byCollege.values()].sort((a, b) => a.order - b.order);
  for (const g of groups) {
    g.departments = g.departments
      .map((d, index) => ({ d, index }))
      .sort((a, b) => Number(Boolean(a.d.former)) - Number(Boolean(b.d.former)) || a.index - b.index)
      .map(({ d }) => d);
  }
  return groups;
}

/** 학과 이름·소속 대학·이후(후속) 학과 이름 중 하나라도 검색어를 포함하면 일치. 이름이 검색어로 시작하는 학과를 앞에 둔다. */
export function searchDepartments(departments, query) {
  const q = normalizeForSearch(query);
  if (!q) return [];
  const scored = [];
  departments.forEach((d, index) => {
    const name = normalizeForSearch(d.name);
    const college = normalizeForSearch(d.college);
    const successors = (d.successors || []).map((s) => normalizeForSearch(s.name));
    let score = null;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (college.includes(q)) score = 2;
    else if (successors.some((s) => s.includes(q))) score = 3;
    if (score !== null) scored.push({ d, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || Number(Boolean(a.d.former)) - Number(Boolean(b.d.former)) || a.index - b.index).map(({ d }) => d);
}
