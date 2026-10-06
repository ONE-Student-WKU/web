/**
 * server/services/regulationEngine/offeredGrade.js
 * 제13조③(선택→필수 변경)용: "변경 후(to_year) 교육과정에서 그 과목이 개설된 학년"을 찾는다. 순수 함수(DB 없음).
 *
 * 왜 계보(course_lineage)를 쓰는가: 개편으로 학수번호(course_key)가 바뀌면 to_year 편성표에서 옛 학수번호를 못 찾는다. 예전에는 이때
 * "학년도가 가장 가까운 편성표의 학년"로 어림했는데(NEAREST_SNAPSHOT), 그건 같은 과목이라는 근거 없이 비슷한 해의 값을 빌리는 것이다.
 * 계보에는 "학수번호 A가 B로 바뀌었다(RENAME, 과목명 동일)"가 기록돼 있으니, 학수번호를 계보로 따라가 to_year 편성표에서 정확히 찾는 편이 낫다.
 * 계보가 없을 때만 예전 근사를 유지하고 표시한다(보정 라운드 B, D-45).
 *
 * 계보 사용 규칙: RENAME/REPLACE처럼 "한 과목이 다른 학수번호로 이어진" 간선만 쓴다(MERGE·SPLIT·ABOLISH는 한 과목으로 이어지지 않아 제외).
 * 앞으로(from→to)는 효력 학년도가 to_year 이하인 간선(to_year 편성표에 이미 새 학수번호로 올라 있음), 뒤로(to→from)는 효력 학년도가
 * to_year보다 늦은 간선(to_year 편성표에는 아직 옛 학수번호). 학과가 정해진 간선은 이 학과 계열(departmentIds)일 때만 쓴다.
 */

const SAME_COURSE_RELATIONS = new Set(['RENAME', 'REPLACE']);
const MAX_HOPS = 5;

const inYear = (r, year) => (r.min_admission_year == null || r.min_admission_year <= year) && (r.max_admission_year == null || r.max_admission_year >= year);

/** 학수번호를 계보로 이어 to_year 편성표에서 쓰였을 수 있는 학수번호들을 모은다(자기 자신 제외). */
function lineageCandidateKeys(subjectKey, toYear, lineage, departmentIds) {
  const ids = new Set(departmentIds);
  const edges = (lineage || []).filter((e) => SAME_COURSE_RELATIONS.has(e.relation) && e.from_course_key && e.to_course_key && (e.department_id == null || ids.has(e.department_id)));
  const found = new Set();
  const walk = (start, next) => {
    let frontier = [start];
    for (let hop = 0; hop < MAX_HOPS && frontier.length; hop++) {
      const nextFrontier = [];
      for (const k of frontier) for (const e of edges) {
        const to = next(e, k);
        if (to && to !== subjectKey && !found.has(to)) { found.add(to); nextFrontier.push(to); }
      }
      frontier = nextFrontier;
    }
  };
  walk(subjectKey, (e, k) => (e.from_course_key === k && e.effective_year <= toYear ? e.to_course_key : null));
  walk(subjectKey, (e, k) => (e.to_course_key === k && e.effective_year > toYear ? e.from_course_key : null));
  return found;
}

/**
 * 변경 한 건(c: { subjectKey, toYear })의 개설 학년.
 * @param {Array<{course_key, grade, min_admission_year, max_admission_year}>} courseRows 이 학과 계열의 편성표 행(학수번호 후보 전부 포함)
 * @param {Array} lineage course_lineage 행(snake_case)
 * @returns {{ offeredGrade: number|null, offeredGradeSource: 'EXACT'|'LINEAGE'|'NEAREST_SNAPSHOT'|null, via?: string[] }}
 */
function resolveOfferedGrade(c, courseRows, lineage, departmentIds) {
  const lowest = (rows) => Math.min(...rows.map((r) => r.grade));
  const own = courseRows.filter((r) => r.course_key === c.subjectKey);
  const exact = own.filter((r) => inYear(r, c.toYear));
  if (exact.length) return { offeredGrade: lowest(exact), offeredGradeSource: 'EXACT' };

  const keys = lineageCandidateKeys(c.subjectKey, c.toYear, lineage, departmentIds);
  if (keys.size) {
    const viaRows = courseRows.filter((r) => keys.has(r.course_key) && inYear(r, c.toYear));
    if (viaRows.length) return { offeredGrade: lowest(viaRows), offeredGradeSource: 'LINEAGE', via: [...new Set(viaRows.map((r) => r.course_key))] };
  }

  // 계보로도 못 찾으면 예전 근사: 학년도가 가장 가까운 편성표의 학년(추정으로 표시된다).
  if (own.length === 0) return { offeredGrade: null, offeredGradeSource: null };
  const dist = (r) => Math.abs((r.max_admission_year ?? r.min_admission_year ?? c.toYear) - c.toYear);
  const best = Math.min(...own.map(dist));
  return { offeredGrade: lowest(own.filter((r) => dist(r) === best)), offeredGradeSource: 'NEAREST_SNAPSHOT' };
}

module.exports = { resolveOfferedGrade, lineageCandidateKeys, SAME_COURSE_RELATIONS };
