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

/** 학과의 세부전공 중 이름에 검색어가 들어 있는 것(검색 결과에 "세부전공 ○○"로 보여 줄 때). */
export function matchedTracks(department, query) {
  const q = normalizeForSearch(query);
  if (!q) return [];
  return (department.tracks || []).filter((tr) => normalizeForSearch(tr.name).includes(q));
}

/**
 * 학과 이름·세부전공 이름·소속 대학·이후(후속) 학과 이름 중 하나라도 검색어를 포함하면 일치.
 * 친 글자와 더 직접 맞는 것을 앞에 둔다: 이름이 검색어로 시작 → 이름에 포함 → 세부전공 이름에 포함 → 대학 → 이후 학과.
 * 같은 단계면 지금 있는 학과가 이전 학과보다 앞(UX 점검 2026-10-16 2-10, 안 A).
 */
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
    else if (matchedTracks(d, query).length > 0) score = 2;
    else if (college.includes(q)) score = 3;
    else if (successors.some((s) => s.includes(q))) score = 4;
    if (score !== null) scored.push({ d, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || Number(Boolean(a.d.former)) - Number(Boolean(b.d.former)) || a.index - b.index).map(({ d }) => d);
}

/**
 * 검색어와 일치한 부분을 칠하려고 글자를 [{ text, hit }] 조각으로 나눈다. 비교는 normalizeForSearch와 같은 기준이라
 * "컴퓨터 소프트"로 쳐도 "컴퓨터·소프트"가 칠해진다(가운뎃점은 칠한 범위 안에 들어간다). 일치가 없으면 통째로 한 조각.
 */
export function splitByMatch(text, query) {
  const source = String(text ?? '').normalize('NFC');
  const q = normalizeForSearch(query);
  if (!q) return [{ text: source, hit: false }];
  let normalized = '';
  const origin = []; // normalized의 각 글자가 원래 글자의 몇 번째인지
  for (let i = 0; i < source.length; i++) {
    if (/[\s·ㆍ‧()（）]/.test(source[i])) continue;
    normalized += source[i].toLowerCase();
    origin.push(i);
  }
  const at = normalized.indexOf(q);
  if (at < 0) return [{ text: source, hit: false }];
  const start = origin[at];
  const end = origin[at + q.length - 1] + 1;
  return [
    { text: source.slice(0, start), hit: false },
    { text: source.slice(start, end), hit: true },
    { text: source.slice(end), hit: false },
  ].filter((part) => part.text);
}

/**
 * 이전 학과에서 이후 학과로 갈 때 이어지는 세부전공 — 학과 이름 끝의 "과·부"와 세부전공 이름 끝의 "전공"을 뗀 줄기가 같은 것.
 * 예: 컴퓨터·소프트웨어공학과 → 공학3계열의 컴퓨터·소프트웨어공학전공(둘 다 "컴퓨터소프트웨어공학"). 없으면 null(세부전공은 학생이 고른다).
 */
export function pickTrackForFormer(formerName, tracks) {
  const stem = (name, suffixes) => {
    const n = normalizeForSearch(name);
    const suffix = suffixes.find((s) => n.endsWith(s) && n.length > s.length);
    return suffix ? n.slice(0, -suffix.length) : n;
  };
  const target = stem(formerName, ['과', '부']);
  return (tracks || []).find((tr) => stem(tr.name, ['전공']) === target) || null;
}
