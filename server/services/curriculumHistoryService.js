const pool = require('../db');
const { buildRuleKey, buildDerivedRuleKey, buildCourseKey, DERIVED_RULE_CODES } = require('./curriculumKeys');

/**
 * server/services/curriculumHistoryService.js
 * 교육과정 "변경 이력" 조회 계층 — "이 규정/과목이 언제 바뀌었나", "이 학번에게 적용되는 값과 그 뒤 변경".
 * 테이블은 curriculum_requirements(rule_key), curriculum_courses(course_key), department_lineage,
 * course_lineage, curriculum_changes(db/schema.sql 6.5~6.56절). 이 파일은 읽기만 한다.
 *
 * 중요한 구분: "학생에게 적용되는 규정"은 입학학번으로 정해지고(graduationService와 같은 범위 조건),
 * "변경 이력"은 그 규정이 이후 학번에서 어떻게 바뀌었는지의 기록일 뿐이다. 이력에 더 최근 값이 있어도 학생의
 * 적용 규정을 바꾸지 않는다 — describeRuleForCohort가 둘을 나눠서 돌려준다.
 */

function mapChange(r) {
  return {
    id: r.id,
    subjectType: r.subject_type,
    subjectKey: r.subject_key,
    displayName: r.display_name,
    departmentId: r.department_id,
    trackId: r.track_id,
    successorDepartmentId: r.successor_department_id,
    successorTrackId: r.successor_track_id,
    fromYear: r.from_year,
    toYear: r.to_year,
    field: r.field,
    changeType: r.change_type,
    oldValue: r.old_value,
    newValue: r.new_value,
    note: r.note,
    source: r.source,
  };
}

/**
 * 변경 이력 조회. 조건은 모두 선택이며 AND로 걸린다.
 * @param {object} f  subjectType, subjectKey, departmentId, field, changeType,
 *                    sinceYear(to_year ≥), untilYear(to_year ≤)
 */
async function listChanges(f = {}) {
  const conditions = [];
  const params = [];
  if (f.subjectType) { conditions.push('subject_type = ?'); params.push(f.subjectType); }
  if (f.subjectKey) { conditions.push('subject_key = ?'); params.push(f.subjectKey); }
  if (f.departmentId) { conditions.push('(department_id = ? OR successor_department_id = ?)'); params.push(f.departmentId, f.departmentId); }
  if (f.field) { conditions.push('field = ?'); params.push(f.field); }
  if (f.changeType) { conditions.push('change_type = ?'); params.push(f.changeType); }
  if (f.sinceYear != null) { conditions.push('to_year >= ?'); params.push(f.sinceYear); }
  if (f.untilYear != null) { conditions.push('to_year <= ?'); params.push(f.untilYear); }
  if (conditions.length === 0) return [];

  const [rows] = await pool.query(
    `SELECT * FROM curriculum_changes WHERE ${conditions.join(' AND ')} ORDER BY to_year, subject_key, field`,
    params
  );
  return rows.map(mapChange);
}

/**
 * 학과 개편으로 이어지는 학과들 — 이 학과의 "이전 학과(조상)"와 "이후 학과(후손)"만 따라간다.
 * 같은 학과로 합쳐진 다른 학과(형제: 예를 들어 공학3계열로 함께 간 게임콘텐츠학과)는 이 학과의 이력이 아니므로 넣지 않는다.
 * 요건은 학과 단위라서 개편 전후 이력을 한 줄로 보려면 필요하다. 트랙은 무시하고 학과 단위로 따라가며 깊이를 제한한다.
 */
async function getDepartmentChain(departmentId) {
  const [edges] = await pool.query(
    `SELECT l.*, fd.name AS from_name, td.name AS to_name
     FROM department_lineage l
     LEFT JOIN departments fd ON fd.id = l.from_department_id
     LEFT JOIN departments td ON td.id = l.to_department_id
     WHERE l.from_department_id IS NOT NULL AND l.to_department_id IS NOT NULL`
  );
  const walk = (startId, nextOf) => {
    const found = new Set();
    let frontier = [startId];
    for (let depth = 0; depth < 6 && frontier.length > 0; depth++) {
      const next = [];
      for (const id of frontier) {
        for (const e of edges) {
          const n = nextOf(e, id);
          if (n != null && n !== departmentId && !found.has(n)) { found.add(n); next.push(n); }
        }
      }
      frontier = next;
    }
    return found;
  };
  const ancestors = walk(departmentId, (e, id) => (e.to_department_id === id ? e.from_department_id : null));
  const descendants = walk(departmentId, (e, id) => (e.from_department_id === id ? e.to_department_id : null));
  const ids = new Set([departmentId, ...ancestors, ...descendants]);

  const related = edges.filter((e) => ids.has(e.from_department_id) && ids.has(e.to_department_id));
  return {
    departmentIds: [...ids],
    ancestorIds: [...ancestors],
    descendantIds: [...descendants],
    edges: related.map((e) => ({
      fromDepartmentId: e.from_department_id, fromDepartmentName: e.from_name, fromTrackId: e.from_track_id,
      toDepartmentId: e.to_department_id, toDepartmentName: e.to_name, toTrackId: e.to_track_id,
      relation: e.relation, effectiveYear: e.effective_year, source: e.source, note: e.note,
    })),
  };
}

/**
 * 한 규정의 버전들(학번 범위별 값). category는 요건 카테고리('전공필수' 등)이거나 합산 코드
 * ('GRAD_TOTAL' | 'MAJOR_TOTAL' | 'LIBERAL_TOTAL')이다. 합산 코드는 행으로 저장돼 있지 않아서 변경 이력(curriculum_changes)에서
 * 읽는다 — 그 경우 versions는 비어 있고 changes만 있다.
 */
async function getRuleVersions({ departmentId, category, enrollmentType = null }) {
  const [[dept]] = await pool.query('SELECT name FROM departments WHERE id = ?', [departmentId]);
  if (!dept) return { ruleKey: null, versions: [] };

  if (DERIVED_RULE_CODES[category]) {
    return { ruleKey: buildDerivedRuleKey(dept.name, category, enrollmentType), versions: [], derived: true };
  }
  const ruleKey = buildRuleKey(dept.name, category, enrollmentType);
  const [rows] = await pool.query(
    `SELECT required_credits, min_admission_year, max_admission_year, min_course_count, description
     FROM curriculum_requirements WHERE department_id = ? AND rule_key = ?
     ORDER BY min_admission_year IS NULL DESC, min_admission_year`,
    [departmentId, ruleKey]
  );
  return {
    ruleKey,
    versions: rows.map((r) => ({
      requiredCredits: Number(r.required_credits),
      minAdmissionYear: r.min_admission_year,
      maxAdmissionYear: r.max_admission_year,
      minCourseCount: r.min_course_count,
      description: r.description,
    })),
  };
}

/**
 * 학생에게 적용되는 규정 vs 그 규정의 변경 이력.
 *  - applied: admissionYear가 속한 버전(현재 적용 규정). 없으면 null(그 학번 자료가 아직 없음).
 *  - laterChanges: 이 학번 이후(to_year > admissionYear)에 생긴 변경 — 학번별 기준표 값과 구분해 보여주는 용도(이 학번에 적용되는지는 경과조치, 시행규칙 제13조에 따라 달라진다).
 *  - earlierChanges: 이 학번 이전에 있었던 변경 — 이 규정이 어떻게 지금 값이 됐는지 설명용.
 * 합산 코드(GRAD_TOTAL 등)도 지원한다(변경 이력으로 같은 정보를 만든다).
 */
async function describeRuleForCohort({ departmentId, category, admissionYear, enrollmentType = null }) {
  const { ruleKey, versions, derived } = await getRuleVersions({ departmentId, category, enrollmentType });
  if (!ruleKey) return null;

  const chain = await getDepartmentChain(departmentId);
  const [[dept]] = await pool.query('SELECT name FROM departments WHERE id = ?', [departmentId]);
  // 학과 개편 전후의 같은 규정 키를 모은다(학과 이름만 다른 같은 카테고리).
  const [chainDepts] = await pool.query('SELECT id, name FROM departments WHERE id IN (?)', [chain.departmentIds]);
  const suffix = ruleKey.slice(dept.name.length); // "|MAJOR_REQUIRED|GENERAL"
  const keys = chainDepts.map((d) => `${d.name}${suffix}`);
  const [changeRows] = await pool.query(
    `SELECT * FROM curriculum_changes WHERE subject_type = 'REQUIREMENT' AND subject_key IN (?) ORDER BY to_year`,
    [keys]
  );
  const changes = changeRows.map(mapChange);

  let applied = null;
  if (!derived) {
    applied = versions.find(
      (v) => (v.minAdmissionYear == null || v.minAdmissionYear <= admissionYear) && (v.maxAdmissionYear == null || v.maxAdmissionYear >= admissionYear)
    ) || null;
  } else {
    // 합산은 행이 없으므로, 구성 카테고리 행들을 학번으로 걸러 더한다(graduationService와 같은 범위 조건).
    const [rows] = await pool.query(
      `SELECT category, required_credits FROM curriculum_requirements
       WHERE department_id = ? AND enrollment_type IS NULL AND min_course_count IS NULL
         AND category IN (?)
         AND (min_admission_year IS NULL OR ? >= min_admission_year)
         AND (max_admission_year IS NULL OR ? <= max_admission_year)`,
      [departmentId, DERIVED_RULE_CODES[category], admissionYear, admissionYear]
    );
    if (rows.length > 0) applied = { requiredCredits: rows.reduce((s, r) => s + Number(r.required_credits), 0) };
  }

  return {
    ruleKey,
    admissionYear,
    applied,
    earlierChanges: changes.filter((c) => c.toYear != null && c.toYear <= admissionYear),
    laterChanges: changes.filter((c) => c.toYear != null && c.toYear > admissionYear),
    departmentChain: chain,
  };
}

/**
 * 과목의 연도별 존재/변경 이력. courseCode(학수번호) 또는 courseName으로 찾는다.
 * 이름으로 찾으면 같은 이름의 서로 다른 course_key가 여러 개일 수 있어 key별로 따로 돌려준다.
 */
async function findCourseHistory({ courseCode, courseName, departmentId, exact = false } = {}) {
  let keys = [];
  if (courseCode) {
    keys = [buildCourseKey(courseCode, null)];
  } else if (courseName) {
    const conditions = [exact ? 'course_name = ?' : 'course_name LIKE ?'];
    const params = [exact ? courseName : `%${courseName}%`];
    if (departmentId) { conditions.push('department_id = ?'); params.push(departmentId); }
    const [rows] = await pool.query(
      `SELECT DISTINCT course_key FROM curriculum_courses WHERE ${conditions.join(' AND ')} AND course_key IS NOT NULL LIMIT 20`,
      params
    );
    keys = rows.map((r) => r.course_key);
  }
  if (keys.length === 0) return [];

  const results = [];
  for (const key of keys) {
    const [versions] = await pool.query(
      `SELECT cc.min_admission_year, cc.max_admission_year, cc.grade, cc.semester, cc.category, cc.course_code,
              cc.course_name, cc.credits, d.name AS department_name, t.name AS track_name, cc.department_id
       FROM curriculum_courses cc
       JOIN departments d ON d.id = cc.department_id
       LEFT JOIN tracks t ON t.id = cc.track_id
       WHERE cc.course_key = ? ${departmentId ? 'AND cc.department_id = ?' : ''}
       ORDER BY cc.min_admission_year IS NULL DESC, cc.min_admission_year, d.name`,
      departmentId ? [key, departmentId] : [key]
    );
    const changes = await listChanges({ subjectType: 'COURSE', subjectKey: key, departmentId });
    const [lineage] = await pool.query(
      'SELECT * FROM course_lineage WHERE from_course_key = ? OR to_course_key = ? ORDER BY effective_year',
      [key, key]
    );
    const years = versions.flatMap((v) => [v.min_admission_year, v.max_admission_year]).filter((y) => y != null);
    results.push({
      courseKey: key,
      names: [...new Set(versions.map((v) => v.course_name))],
      versions: versions.map((v) => ({
        minAdmissionYear: v.min_admission_year, maxAdmissionYear: v.max_admission_year,
        departmentName: v.department_name, trackName: v.track_name, courseCode: v.course_code, courseName: v.course_name,
        category: v.category, grade: v.grade, semester: v.semester, credits: v.credits == null ? null : Number(v.credits),
      })),
      changes,
      lineage: lineage.map((l) => ({
        fromCourseKey: l.from_course_key, toCourseKey: l.to_course_key, fromName: l.from_name, toName: l.to_name,
        relation: l.relation, effectiveYear: l.effective_year, source: l.source, note: l.note,
      })),
      // 폐지: REMOVED 변경의 from_year(마지막으로 있던 학번). 이후에도 다시 나타난 적이 없을 때만 의미가 있다.
      lastSeenYear: changes.filter((c) => c.changeType === 'REMOVED').map((c) => c.fromYear).sort((a, b) => b - a)[0] ?? (years.length ? Math.max(...years) : null),
      removed: changes.some((c) => c.changeType === 'REMOVED'),
    });
  }
  return results;
}

module.exports = {
  listChanges,
  getDepartmentChain,
  getRuleVersions,
  describeRuleForCohort,
  findCourseHistory,
};
