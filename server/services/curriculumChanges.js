const { DERIVED_RULE_CODES, buildRuleKey, buildDerivedRuleKey, buildCourseKey, normalizeCourseName } = require('./curriculumKeys');

/**
 * server/services/curriculumChanges.js
 * 학년도별 스냅샷(curriculum_requirements / curriculum_courses)을 인접한 학번끼리 비교해
 * curriculum_changes 행을 계산하는 순수 함수 모음. DB를 직접 읽지 않아서 테스트할 수 있다.
 * DB 입출력은 server/scripts/generateCurriculumChanges.js가 맡는다.
 *
 * 핵심 규칙
 *  - 학번 범위(min/max_admission_year)를 학번 낱개로 펼쳐서(null은 universe 끝으로 자른다) 각 학번에 적용되는 값을 만든다.
 *  - "학과(+세부전공)"를 단위(unit)로 보고, 그 단위가 데이터를 가진 학번(coverage)에서 인접한 두 학번을 비교한다.
 *    데이터가 아예 없는 학번은 건너뛰므로(예: 2017~2023 미입력) 신설/폐지로 잘못 잡지 않는다.
 *  - 학과 개편(department_lineage)이 있으면 "이전 학과의 마지막 학번 ↔ 이후 학과의 첫 학번"도 비교한다.
 *  - 과목은 course_key(학수번호/이름)로 같은 과목을 이어 붙인다. 과목명이 같고 학수번호만 바뀐 경우는
 *    같은 과목으로 보고 학수번호 변경(+ course_lineage RENAME)으로 기록한다.
 */

// 책자/원본 표기가 섞여 있는 이수구분을 비교용으로만 통일한다(원본 데이터는 바꾸지 않음).
// 근거: curriculum_courses.category에 md 파싱 원본('선전','기전','교필')과 2026 공학3계열('기초','심화','응용','교선')이 그대로 들어 있다.
const COURSE_CATEGORY_ALIASES = {
  기전: '전공필수',
  선전: '전공선택',
  교필: '교양필수',
  교선: '교양선택',
  기초: '전공기초',
  심화: '전공심화',
  응용: '전공응용',
};
const WIDE_MAJOR_CATEGORIES = new Set(['전공기초', '전공심화', '전공응용']); // 광역계열 전공 표의 이수구분 체계
const MAJOR_REQUIREMENT_CATEGORIES = new Set(DERIVED_RULE_CODES.MAJOR_TOTAL);

function normalizeCourseCategory(category) {
  return COURSE_CATEGORY_ALIASES[category] || category;
}

function yearsFromRows(rows, universe) {
  const years = new Set();
  for (const r of rows) for (const y of expandYears(r.minAdmissionYear, r.maxAdmissionYear, universe)) years.add(y);
  return [...years].sort((a, b) => a - b);
}

// null 하한/상한은 universe의 끝으로 자른다(예: 2017~2025학번 전체에 적용되는 행, 2026학번부터 열린 행).
function expandYears(min, max, universe) {
  const lo = min == null ? universe.min : Math.max(min, universe.min);
  const hi = max == null ? universe.max : Math.min(max, universe.max);
  const out = [];
  for (let y = lo; y <= hi; y++) out.push(y);
  return out;
}

// 학번 범위가 닫혀 있는 행이 하나라도 있는 학과/단위만 coverage를 갖는다. null~null 행(전 학번 공통)은
// 그 학과가 이미 가진 학번 위에서만 펼쳐진다 — 안 그러면 모든 학과가 universe 전체에 데이터가 있는 것처럼 보인다.
function coverageYears(rows, universe) {
  const bounded = rows.filter((r) => r.minAdmissionYear != null || r.maxAdmissionYear != null);
  return yearsFromRows(bounded, universe);
}

function unitId(departmentId, trackId) {
  return `${departmentId}:${trackId || 0}`;
}

function unitLabel(names, departmentId, trackId) {
  const dept = names.departments.get(departmentId) || `학과#${departmentId}`;
  const track = trackId ? names.tracks.get(trackId) : null;
  return track ? `${dept}(${track})` : dept;
}

function pushChange(out, change) {
  out.push({
    successorDepartmentId: null,
    successorTrackId: null,
    note: null,
    ...change,
    source: 'AUTO',
  });
}

// ---------------------------------------------------------------------------
// 요건(curriculum_requirements)
// ---------------------------------------------------------------------------

function requirementsAtYear(rows, year) {
  return rows.filter(
    (r) => (r.minAdmissionYear == null || r.minAdmissionYear <= year) && (r.maxAdmissionYear == null || r.maxAdmissionYear >= year)
  );
}

/**
 * 한 학과의 한 학번에 적용되는 요건을 { ruleKey → {credits, minCourseCount, category, enrollmentType} }로 만든다.
 * 일반 요건(enrollmentType 없음)이 있는 카테고리 묶음은 합산 규정(MAJOR_TOTAL/LIBERAL_TOTAL/GRAD_TOTAL)도 함께 만든다.
 */
function ruleValuesAtYear(rows, departmentName, year) {
  const values = new Map();
  const general = [];
  for (const r of requirementsAtYear(rows, year)) {
    const ruleKey = r.ruleKey || buildRuleKey(departmentName, r.category, r.enrollmentType);
    values.set(ruleKey, {
      credits: r.requiredCredits == null ? null : Number(r.requiredCredits),
      minCourseCount: r.minCourseCount ?? null,
      category: r.category,
      enrollmentType: r.enrollmentType || null,
    });
    if (!r.enrollmentType && r.minCourseCount == null) general.push(r);
  }

  for (const [code, categories] of Object.entries(DERIVED_RULE_CODES)) {
    const parts = general.filter((r) => categories.includes(r.category));
    if (parts.length === 0) continue;
    values.set(buildDerivedRuleKey(departmentName, code, null), {
      credits: parts.reduce((sum, r) => sum + Number(r.requiredCredits), 0),
      minCourseCount: null,
      category: code,
      enrollmentType: null,
      derived: true,
    });
  }
  return values;
}

function majorCategorySet(rows, year) {
  return new Set(
    requirementsAtYear(rows, year)
      .filter((r) => !r.enrollmentType && MAJOR_REQUIREMENT_CATEGORIES.has(r.category))
      .map((r) => r.category)
  );
}

function diffRuleValues(a, b, { structureChanged }) {
  const changes = [];
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const key of keys) {
    const before = a.get(key);
    const after = b.get(key);
    if (before && after) {
      if (before.credits !== after.credits) {
        changes.push({ key, field: 'required_credits', changeType: 'CHANGED', oldValue: before.credits, newValue: after.credits, value: after });
      }
      if (before.minCourseCount !== after.minCourseCount) {
        changes.push({ key, field: 'min_course_count', changeType: 'CHANGED', oldValue: before.minCourseCount, newValue: after.minCourseCount, value: after });
      }
    } else {
      const present = before || after;
      let note = null;
      if (structureChanged && MAJOR_REQUIREMENT_CATEGORIES.has(present.category)) {
        note = '전공 요건 행 구성이 달라짐(전공필수·전공선택 ↔ 전공). 합계는 MAJOR_TOTAL로 비교';
      }
      changes.push({
        key,
        field: 'existence',
        changeType: before ? 'REMOVED' : 'ADDED',
        oldValue: before ? before.credits : null,
        newValue: after ? after.credits : null,
        value: present,
        note,
      });
    }
  }
  return changes;
}

/**
 * 요건 변경 이력.
 * @param rows        [{departmentId, departmentName, category, requiredCredits, minAdmissionYear, maxAdmissionYear, enrollmentType, minCourseCount, ruleKey}]
 * @param edges       lineage 간선(아래 buildLineageIndex 참고)
 */
function computeRequirementChanges({ rows, edges, universe }) {
  const out = [];
  const byDept = new Map();
  for (const r of rows) {
    if (!byDept.has(r.departmentId)) byDept.set(r.departmentId, { name: r.departmentName, rows: [] });
    byDept.get(r.departmentId).rows.push(r);
  }

  const coverage = new Map();
  // coverage는 학점 요건 행(전공·교양·일반선택, 일반 학번 기준)이 있는 학번만 센다. 졸업인증제처럼 여러 학번에 걸쳐
  // 손으로 넣은 행(예: 2020~2025)이 coverage를 넓히면 학점 요건이 없던 학번에서 요건이 "신설"된 것처럼 잡히기 때문.
  const GRAD_CATEGORIES = new Set(DERIVED_RULE_CODES.GRAD_TOTAL);
  for (const [deptId, d] of byDept) {
    coverage.set(deptId, coverageYears(d.rows.filter((r) => !r.enrollmentType && GRAD_CATEGORIES.has(r.category)), universe));
  }
  const lineage = buildLineageIndex(edges);

  for (const [deptId, d] of byDept) {
    const years = coverage.get(deptId);

    // 같은 학과 안에서 인접한 학번끼리
    for (let i = 0; i + 1 < years.length; i++) {
      const y0 = years[i];
      const y1 = years[i + 1];
      const diffs = diffRuleValues(ruleValuesAtYear(d.rows, d.name, y0), ruleValuesAtYear(d.rows, d.name, y1), {
        structureChanged: !sameSet(majorCategorySet(d.rows, y0), majorCategorySet(d.rows, y1)),
      });
      for (const c of diffs) {
        pushChange(out, {
          subjectType: 'REQUIREMENT',
          subjectKey: c.key,
          displayName: `${d.name} ${c.value.category}`,
          departmentId: deptId,
          trackId: null,
          fromYear: c.changeType === 'ADDED' ? null : y0,
          toYear: y1,
          field: c.field,
          changeType: c.changeType,
          oldValue: stringify(c.oldValue),
          newValue: stringify(c.newValue),
          note: c.note || null,
        });
      }
    }

    // 학과 개편을 건너서: 이 학과의 마지막 학번 ↔ 이어지는 학과의 첫 학번
    if (years.length === 0) continue;
    const last = years[years.length - 1];
    if (last >= universe.max) continue;
    const successor = findRequirementSuccessor({ deptId, last, lineage, coverage });
    if (!successor) continue;
    // 이후 학과 쪽 키는 학과 이름만 다르므로, 이름 부분만 바꿔서 같은 규정끼리 짝짓는다.
    const before = ruleValuesAtYear(d.rows, d.name, last);
    const afterDept = byDept.get(successor.deptId);
    const after = ruleValuesAtYear(afterDept.rows, afterDept.name, successor.year);
    for (const [key, beforeValue] of before) {
      const afterKey = swapDepartmentInKey(key, d.name, afterDept.name);
      const afterValue = after.get(afterKey);
      if (!afterValue) continue;
      if (beforeValue.credits !== afterValue.credits) {
        pushChange(out, {
          subjectType: 'REQUIREMENT',
          subjectKey: key,
          displayName: `${d.name} ${beforeValue.category}`,
          departmentId: deptId,
          trackId: null,
          successorDepartmentId: successor.deptId,
          successorTrackId: null,
          fromYear: last,
          toYear: successor.year,
          field: 'required_credits',
          changeType: 'CHANGED',
          oldValue: stringify(beforeValue.credits),
          newValue: stringify(afterValue.credits),
          note: `학과 개편(${d.name} → ${afterDept.name})`,
        });
      }
    }
  }
  return out;
}

function swapDepartmentInKey(key, fromName, toName) {
  return key.startsWith(`${fromName}|`) ? `${toName}${key.slice(fromName.length)}` : key;
}

// 학과 단위(트랙은 따라가되 요건은 학과에 붙어 있음)에서 "이후 학번에 요건 행을 가진 학과"를 찾는다.
function findRequirementSuccessor({ deptId, last, lineage, coverage }) {
  const seen = new Set();
  let frontier = [{ departmentId: deptId, trackId: null }];
  for (let depth = 0; depth < 4 && frontier.length > 0; depth++) {
    const next = [];
    for (const unit of frontier) {
      for (const e of lineage.outgoing(unit.departmentId, unit.trackId)) {
        const target = { departmentId: e.toDepartmentId, trackId: e.toTrackId };
        if (target.departmentId == null) continue;
        const id = unitId(target.departmentId, target.trackId);
        if (seen.has(id)) continue;
        seen.add(id);
        const years = coverage.get(target.departmentId) || [];
        const nextYear = years.find((y) => y > last);
        if (target.departmentId !== deptId && nextYear != null) return { deptId: target.departmentId, year: nextYear };
        next.push(target);
      }
    }
    frontier = next;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 과목(curriculum_courses)
// ---------------------------------------------------------------------------

function courseKeyOf(row) {
  return row.courseKey || buildCourseKey(row.courseCode, row.courseName);
}

function buildUnits(rows, universe) {
  const units = new Map();
  for (const r of rows) {
    const id = unitId(r.departmentId, r.trackId);
    if (!units.has(id)) units.set(id, { id, departmentId: r.departmentId, trackId: r.trackId || null, rows: [] });
    units.get(id).rows.push(r);
  }
  for (const u of units.values()) u.years = coverageYears(u.rows, universe);
  return units;
}

// 한 단위가 한 학번에 갖는 과목 지도 { courseKey → 속성 }. 한 해에 같은 키가 여러 번 나오면 먼저 나온 행을 쓴다
// (같은 학수번호가 서로 다른 과목에 인쇄된 책자 오타 등 — 드물다).
function courseMapAtYear(unit, year) {
  const map = new Map();
  for (const r of unit.rows) {
    if (!((r.minAdmissionYear == null || r.minAdmissionYear <= year) && (r.maxAdmissionYear == null || r.maxAdmissionYear >= year))) continue;
    const key = courseKeyOf(r);
    if (map.has(key)) continue;
    map.set(key, {
      key,
      courseCode: r.courseCode || null,
      courseName: r.courseName,
      credits: r.credits == null ? null : Number(r.credits),
      category: normalizeCourseCategory(r.category),
      grade: r.grade,
      semester: String(r.semester),
      departmentId: unit.departmentId,
      trackId: unit.trackId,
    });
  }
  return map;
}

const COURSE_FIELDS = [
  ['course_name', 'courseName'],
  ['credits', 'credits'],
  ['category', 'category'],
  ['grade', 'grade'],
  ['semester', 'semester'],
];

function diffCourseMaps(before, after) {
  const changed = [];
  const removed = [];
  const added = [];
  for (const [key, b] of before) {
    const a = after.get(key);
    if (!a) removed.push(b);
    else changed.push({ before: b, after: a });
  }
  for (const [key, a] of after) if (!before.has(key)) added.push(a);

  // 두 과목의 학수번호가 서로 맞바뀐 경우(같은 학과의 인접 과목 번호 쌍을 책자가 뒤바꿔 인쇄했거나 한쪽 해만 정정된 경우
  // — 실제로 있음: 경제금융학과 168008/168009)에는 키(학수번호)로 이으면 두 과목이 "서로 이름이 바뀐" 것처럼 보인다.
  // 과목명이 학수번호보다 사람에게 의미 있는 식별자라서, 이름이 서로 교차하는 쌍은 과목명으로 다시 이어
  // "학수번호 변경"으로 기록한다.
  const swappedRenames = [];
  const nameChanged = changed.filter((p) => normalizeCourseName(p.before.courseName) !== normalizeCourseName(p.after.courseName));
  const byBeforeName = new Map(nameChanged.map((p) => [normalizeCourseName(p.before.courseName), p]));
  const swapped = new Set();
  for (const p of nameChanged) {
    const q = byBeforeName.get(normalizeCourseName(p.after.courseName));
    if (q && q !== p && normalizeCourseName(q.after.courseName) === normalizeCourseName(p.before.courseName)) {
      swapped.add(p);
      swappedRenames.push({ before: p.before, after: q.after, swap: true });
    }
  }
  const changedKept = changed.filter((p) => !swapped.has(p));

  // 학수번호만 바뀌고 과목명은 같은 것(재부여)은 신설/폐지가 아니라 같은 과목으로 본다.
  const renamed = [];
  const addedByName = new Map();
  for (const a of added) {
    const n = normalizeCourseName(a.courseName);
    if (!addedByName.has(n)) addedByName.set(n, []);
    addedByName.get(n).push(a);
  }
  const removedLeft = [];
  const usedAdded = new Set();
  for (const b of removed) {
    const candidates = (addedByName.get(normalizeCourseName(b.courseName)) || []).filter((a) => !usedAdded.has(a));
    if (candidates.length === 1 && b.courseCode && candidates[0].courseCode && b.courseCode !== candidates[0].courseCode) {
      usedAdded.add(candidates[0]);
      renamed.push({ before: b, after: candidates[0] });
    } else {
      removedLeft.push(b);
    }
  }
  return { changed: changedKept, renamed: [...renamed, ...swappedRenames], removed: removedLeft, added: added.filter((a) => !usedAdded.has(a)) };
}

function emitCourseChanges(out, courseLineageOut, diff, ctx) {
  const { fromYear, toYear, names, sourceNote, crossUnit } = ctx;
  const attrChanges = (pair) => {
    for (const [field, prop] of COURSE_FIELDS) {
      if (stringify(pair.before[prop]) === stringify(pair.after[prop])) continue;
      let note = sourceNote || null;
      if (field === 'category' && (WIDE_MAJOR_CATEGORIES.has(pair.before.category) !== WIDE_MAJOR_CATEGORIES.has(pair.after.category))) {
        note = [note, '이수구분 체계 변경(광역계열 전공 기초·심화·응용 ↔ 필수·선택)이라 실제 필수/선택 변경이 아닐 수 있음'].filter(Boolean).join('. ');
      }
      pushChange(out, {
        subjectType: 'COURSE',
        subjectKey: pair.before.key,
        displayName: pair.after.courseName,
        departmentId: pair.before.departmentId,
        trackId: pair.before.trackId,
        successorDepartmentId: crossUnit ? pair.after.departmentId : null,
        successorTrackId: crossUnit ? pair.after.trackId : null,
        fromYear,
        toYear,
        field,
        changeType: 'CHANGED',
        oldValue: stringify(pair.before[prop]),
        newValue: stringify(pair.after[prop]),
        note,
      });
    }
  };
  for (const pair of diff.changed) attrChanges(pair);

  for (const pair of diff.renamed) {
    pushChange(out, {
      subjectType: 'COURSE',
      subjectKey: pair.before.key,
      displayName: pair.after.courseName,
      departmentId: pair.before.departmentId,
      trackId: pair.before.trackId,
      successorDepartmentId: crossUnit ? pair.after.departmentId : null,
      successorTrackId: crossUnit ? pair.after.trackId : null,
      fromYear,
      toYear,
      field: 'course_code',
      changeType: 'CHANGED',
      oldValue: pair.before.courseCode,
      newValue: pair.after.courseCode,
      note: [sourceNote, pair.swap ? '두 과목의 학수번호가 서로 맞바뀜(책자 인쇄 오류이거나 한쪽 해만 정정됐을 가능성)' : '과목명은 같고 학수번호만 바뀜'].filter(Boolean).join('. '),
    });
    attrChanges({ before: { ...pair.before, key: pair.before.key }, after: pair.after });
    courseLineageOut.push({
      fromCourseKey: pair.before.key,
      toCourseKey: pair.after.key,
      fromName: pair.before.courseName,
      toName: pair.after.courseName,
      departmentId: pair.before.departmentId,
      relation: 'RENAME',
      effectiveYear: toYear,
      source: 'AUTO',
      note: pair.swap ? '두 과목의 학수번호 맞바뀜 — 자동 감지(책자 오류/정정 가능성)' : '학수번호 변경(과목명 동일) — 자동 감지',
    });
  }
  for (const c of diff.removed) {
    pushChange(out, {
      subjectType: 'COURSE',
      subjectKey: c.key,
      displayName: c.courseName,
      departmentId: c.departmentId,
      trackId: c.trackId,
      fromYear,
      toYear,
      field: 'existence',
      changeType: 'REMOVED',
      oldValue: `${c.category} ${c.grade}학년 ${c.semester}학기`,
      newValue: null,
      note: sourceNote || null,
    });
  }
  for (const c of diff.added) {
    pushChange(out, {
      subjectType: 'COURSE',
      subjectKey: c.key,
      displayName: c.courseName,
      departmentId: c.departmentId,
      trackId: c.trackId,
      fromYear: null,
      toYear,
      field: 'existence',
      changeType: 'ADDED',
      oldValue: null,
      newValue: `${c.category} ${c.grade}학년 ${c.semester}학기`,
      note: sourceNote || null,
    });
  }
}

/**
 * 과목 변경 이력(+ 자동 감지한 course_lineage RENAME).
 * @param rows   [{departmentId, trackId, minAdmissionYear, maxAdmissionYear, courseKey?, courseCode, courseName, credits, category, grade, semester}]
 */
function computeCourseChanges({ rows, edges, universe, names }) {
  const out = [];
  const courseLineage = [];
  const units = buildUnits(rows, universe);

  // (1) 같은 단위 안에서 인접한 학번끼리
  for (const u of units.values()) {
    for (let i = 0; i + 1 < u.years.length; i++) {
      const y0 = u.years[i];
      const y1 = u.years[i + 1];
      emitCourseChanges(out, courseLineage, diffCourseMaps(courseMapAtYear(u, y0), courseMapAtYear(u, y1)), {
        fromYear: y0,
        toYear: y1,
        names,
        crossUnit: false,
      });
    }
  }

  // (2) 학과 개편을 건너서: 같은 effective_year의 간선들을 이어 붙인 덩어리(성분)마다
  //     "이전 단위들의 마지막 학번 과목 합집합 ↔ 이후 단위들의 첫 학번 과목 합집합"
  for (const comp of lineageComponents(edges)) {
    const sources = [...comp.sources].map((id) => units.get(id)).filter(Boolean);
    const targets = [...comp.targets].map((id) => units.get(id)).filter(Boolean);
    if (sources.length === 0 || targets.length === 0) continue;

    // 이전/이후 단위는 자기 세부전공 행에 더해 같은 학과의 계열공통(트랙 없음) 행까지 본다 —
    // 계열 개편 때 교양·공통과목이 세부전공 표에서 계열공통 표로 옮겨 가는 것을 폐지로 오인하지 않기 위해.
    const withCommon = (u) => (u.trackId ? [u, units.get(unitId(u.departmentId, null))].filter(Boolean) : [u]);
    const sourceLast = sources.map((u) => [...u.years].reverse().find((y) => y < comp.effectiveYear)).filter((y) => y != null);
    const targetFirst = targets.map((u) => u.years.find((y) => y >= comp.effectiveYear)).filter((y) => y != null);
    if (sourceLast.length === 0 || targetFirst.length === 0) continue;

    const merged = (list, yearOf) => {
      const map = new Map();
      for (const u of list) {
        for (const unit of withCommon(u)) {
          const y = yearOf(u);
          if (y == null) continue;
          for (const [k, v] of courseMapAtYear(unit, y)) if (!map.has(k)) map.set(k, v);
        }
      }
      return map;
    };
    const before = merged(sources, (u) => [...u.years].reverse().find((y) => y < comp.effectiveYear));
    const after = merged(targets, (u) => u.years.find((y) => y >= comp.effectiveYear));
    const sourceNote = `학과 개편(${sources.map((u) => unitLabel(names, u.departmentId, u.trackId)).join(', ')} → ${targets
      .map((u) => unitLabel(names, u.departmentId, u.trackId))
      .join(', ')})`;
    emitCourseChanges(out, courseLineage, diffCourseMaps(before, after), {
      fromYear: Math.max(...sourceLast),
      toYear: Math.min(...targetFirst),
      names,
      sourceNote,
      crossUnit: true,
    });
  }

  return { changes: out, courseLineage: dedupeCourseLineage(courseLineage) };
}

function dedupeCourseLineage(list) {
  const seen = new Set();
  return list.filter((l) => {
    const k = `${l.fromCourseKey}>${l.toCourseKey}@${l.effectiveYear}:${l.departmentId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// 학과 개편 이력(DEPARTMENT)
// ---------------------------------------------------------------------------

function computeDepartmentChanges({ edges, names }) {
  const out = [];
  for (const e of edges) {
    const fromLabel = e.fromDepartmentId ? unitLabel(names, e.fromDepartmentId, e.fromTrackId) : null;
    const toLabel = e.toDepartmentId ? unitLabel(names, e.toDepartmentId, e.toTrackId) : null;
    pushChange(out, {
      subjectType: 'DEPARTMENT',
      subjectKey: fromLabel || toLabel,
      displayName: `${fromLabel || '(신설)'} → ${toLabel || '(폐지)'}`,
      departmentId: e.fromDepartmentId || e.toDepartmentId,
      trackId: e.fromDepartmentId ? e.fromTrackId : e.toTrackId,
      successorDepartmentId: e.fromDepartmentId ? e.toDepartmentId : null,
      successorTrackId: e.fromDepartmentId ? e.toTrackId : null,
      fromYear: e.fromDepartmentId ? e.effectiveYear - 1 : null,
      toYear: e.effectiveYear,
      field: 'structure',
      changeType: 'CHANGED',
      oldValue: fromLabel,
      newValue: toLabel,
      note: `${e.relation}${e.source === 'NAME_MATCH' ? '(이름 일치로 추정)' : ''}${e.note ? `: ${e.note}` : ''}`.slice(0, 255),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// lineage 도우미
// ---------------------------------------------------------------------------

function buildLineageIndex(edges) {
  const byFrom = new Map();
  for (const e of edges) {
    if (e.fromDepartmentId == null) continue;
    const k = unitId(e.fromDepartmentId, e.fromTrackId);
    if (!byFrom.has(k)) byFrom.set(k, []);
    byFrom.get(k).push(e);
  }
  return {
    // 학과 단위(트랙 없음)에서 출발하면 그 학과의 모든 간선을, 트랙 단위에서 출발하면 그 트랙의 간선만 쓴다.
    outgoing(departmentId, trackId) {
      if (trackId) return byFrom.get(unitId(departmentId, trackId)) || [];
      return byFrom.get(unitId(departmentId, null)) || [];
    },
  };
}

// 같은 effective_year의 간선을 이전/이후 단위로 이어서 덩어리로 묶는다(합쳐지거나 나뉘는 개편을 한 번에 비교).
function lineageComponents(edges) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => parent.set(find(a), find(b));

  const valid = edges.filter((e) => e.fromDepartmentId != null && e.toDepartmentId != null);
  for (const e of valid) union(`${e.effectiveYear}|${unitId(e.fromDepartmentId, e.fromTrackId)}`, `${e.effectiveYear}|${unitId(e.toDepartmentId, e.toTrackId)}`);

  const comps = new Map();
  for (const e of valid) {
    const root = find(`${e.effectiveYear}|${unitId(e.fromDepartmentId, e.fromTrackId)}`);
    if (!comps.has(root)) comps.set(root, { effectiveYear: e.effectiveYear, sources: new Set(), targets: new Set() });
    comps.get(root).sources.add(unitId(e.fromDepartmentId, e.fromTrackId));
    comps.get(root).targets.add(unitId(e.toDepartmentId, e.toTrackId));
  }
  return [...comps.values()];
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function stringify(value) {
  return value == null ? null : String(value);
}

module.exports = {
  normalizeCourseCategory,
  expandYears,
  coverageYears,
  ruleValuesAtYear,
  computeRequirementChanges,
  computeCourseChanges,
  computeDepartmentChanges,
  lineageComponents,
};
