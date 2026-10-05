const pool = require('../../db');
const { getDepartmentChain, describeRuleForCohort } = require('../curriculumHistoryService');
const { hasCoreRowsForYear } = require('./evaluate');
const { summarizeVersions } = require('./textVersion');
const { dbDateToIso } = require('./context');

/**
 * server/services/regulationEngine/dbProvider.js
 * evaluate(순수 함수)에 넘길 data를 기존 테이블에서 "읽기만" 해서 만든다(쓰기 없음).
 * 재사용: curriculum_requirements / curriculum_required_courses(졸업요건), department_lineage(개편 관계),
 * curriculum_changes(변경 이력, curriculumHistoryService 경유).
 */

const DERIVED_HISTORY_CODES = ['GRAD_TOTAL', 'MAJOR_TOTAL', 'LIBERAL_TOTAL'];

async function loadDepartment(ctx) {
  const [rows] = ctx.departmentId != null
    ? await pool.query('SELECT id, name FROM departments WHERE id = ?', [ctx.departmentId])
    : await pool.query('SELECT id, name FROM departments WHERE name = ?', [ctx.departmentName]);
  return rows[0] || null;
}

async function loadRequirementRows(departmentId) {
  const [rows] = await pool.query(
    `SELECT id, category, required_credits, description, enrollment_type, min_course_count, min_admission_year, max_admission_year
     FROM curriculum_requirements WHERE department_id = ?`,
    [departmentId]
  );
  if (rows.length === 0) return [];

  const [courses] = await pool.query(
    'SELECT requirement_id, course_name FROM curriculum_required_courses WHERE requirement_id IN (?)',
    [rows.map((r) => r.id)]
  );
  const byRequirement = new Map();
  for (const c of courses) {
    if (!byRequirement.has(c.requirement_id)) byRequirement.set(c.requirement_id, []);
    byRequirement.get(c.requirement_id).push(c.course_name);
  }
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    requiredCredits: Number(r.required_credits),
    description: r.description,
    enrollmentType: r.enrollment_type,
    minCourseCount: r.min_course_count,
    minAdmissionYear: r.min_admission_year,
    maxAdmissionYear: r.max_admission_year,
    requiredCourses: byRequirement.get(r.id) || [],
  }));
}

/**
 * 이 학번 자료가 없을 때 "개편 전후로 이어진 학과 중 그 학번 자료가 있는 곳"을 안내용으로 찾는다.
 * 값을 대신 쓰지는 않는다 — 학과 연결 자체가 이름 일치(NAME_MATCH) 추정인 경우가 많아서, 후보로만 보여준다.
 */
async function loadCandidates(departmentId, admissionYear) {
  const chain = await getDepartmentChain(departmentId);
  const others = chain.departmentIds.filter((id) => id !== departmentId);
  if (others.length === 0) return [];
  const [names] = await pool.query('SELECT id, name FROM departments WHERE id IN (?)', [others]);
  const candidates = [];
  for (const d of names) {
    const rows = await loadRequirementRows(d.id);
    if (!hasCoreRowsForYear(rows, admissionYear)) continue;
    const edge = chain.edges.find((e) => e.fromDepartmentId === d.id || e.toDepartmentId === d.id);
    candidates.push({ departmentId: d.id, departmentName: d.name, relation: edge ? edge.relation : null, lineageSource: edge ? edge.source : null });
  }
  return candidates;
}

// 시스템이 가진 가장 최신 학번/학년도: 행의 (유한한) 하한·상한 중 최댓값. 열린 상한(NULL)은 무시한다.
async function loadLatestDataYear() {
  const [[row]] = await pool.query(
    'SELECT MAX(GREATEST(COALESCE(min_admission_year, 0), COALESCE(max_admission_year, 0))) AS y FROM curriculum_requirements'
  );
  return row.y || null;
}

/**
 * 기준일 판본 판단(textVersion.js)에 필요한 규정 판본·조문 정보. 읽기 전용.
 *  - summary: 문서별 { floor, latest, effectiveByPromulgation } — regulation_versions의 시행일과 대체관계에서
 *  - articles: 'DOC:조문키' → { lastAmendedOn } — 보유한 본문(textHeld) 조문의 개정 표시 날짜
 * 테이블이 비어 있으면(시드 전) summary·articles가 비어 판단은 상수(TEXT_SOURCES)와 보수적 처리로 대체된다.
 */
async function loadTextVersions() {
  const [versions] = await pool.query(
    'SELECT id, doc_code, version_label, promulgated_on, effective_from, supersedes_version_id, text_held FROM regulation_versions'
  );
  const [articles] = await pool.query(
    'SELECT v.doc_code, a.article_key, a.last_amended_on FROM regulation_articles a JOIN regulation_versions v ON v.id = a.version_id WHERE v.text_held = 1'
  );
  const rows = versions.map((r) => ({
    id: r.id, docCode: r.doc_code, versionLabel: r.version_label, promulgatedOn: dbDateToIso(r.promulgated_on), effectiveFrom: dbDateToIso(r.effective_from),
    supersedesVersionId: r.supersedes_version_id, textHeld: r.text_held === 1,
  }));
  return {
    versions: rows,
    summary: summarizeVersions(rows),
    articles: Object.fromEntries(articles.map((r) => [`${r.doc_code}:${r.article_key}`, { lastAmendedOn: dbDateToIso(r.last_amended_on) }])),
  };
}

/**
 * 조문 관계(regulation_relations) 전체 — 178행이라 매번 읽어도 가볍다. 조문으로 못 이은 대상(to_article_id NULL)은 to_ref 문자열만 있다.
 * 반환 행 모양은 relationWalk.buildRelationIndex가 받는 것: { relation, fromRef, toRef|null, toText|null, source, note }.
 */
async function loadRelations() {
  const [rows] = await pool.query(
    `SELECT r.relation, r.source, r.note, r.to_ref,
            CONCAT(fv.doc_code, ':', fa.article_key) AS from_ref, CONCAT(tv.doc_code, ':', ta.article_key) AS to_article_ref
     FROM regulation_relations r
     JOIN regulation_articles fa ON fa.id = r.from_article_id
     JOIN regulation_versions fv ON fv.id = fa.version_id
     LEFT JOIN regulation_articles ta ON ta.id = r.to_article_id
     LEFT JOIN regulation_versions tv ON tv.id = ta.version_id`
  );
  return rows.map((r) => ({ relation: r.relation, fromRef: r.from_ref, toRef: r.to_article_ref || null, toText: r.to_article_ref ? null : r.to_ref, source: r.source, note: r.note }));
}

async function loadHistory(departmentId, admissionYear) {
  const history = {};
  for (const category of DERIVED_HISTORY_CODES) {
    const d = await describeRuleForCohort({ departmentId, category, admissionYear });
    history[category] = d ? { earlierChanges: d.earlierChanges, laterChanges: d.laterChanges } : null;
  }
  return history;
}

/**
 * evaluate에 넘길 data. ctx는 normalizeInput 결과.
 * withHistory=false면 변경 이력 조회(쿼리가 많다)를 건너뛴다 — 졸업요건 값만 필요한 대량 검증용.
 */
async function loadData(ctx, { withHistory = true } = {}) {
  const department = await loadDepartment(ctx);
  const latestDataYear = await loadLatestDataYear();
  const textVersions = await loadTextVersions();
  if (!department) return { department: null, rows: [], latestDataYear, candidates: [], history: null, textVersions };

  const rows = await loadRequirementRows(department.id);
  const beyondLatest = ctx.admissionYear > latestDataYear;
  const hasRows = hasCoreRowsForYear(rows, ctx.admissionYear) && !beyondLatest;
  return {
    department,
    rows,
    latestDataYear,
    candidates: hasRows || beyondLatest ? [] : await loadCandidates(department.id, ctx.admissionYear),
    history: hasRows && withHistory ? await loadHistory(department.id, ctx.admissionYear) : null,
    textVersions,
  };
}

// --- 파트 2: resolveApplicableRules용 data (applicability.js 주석의 data 형식) ---

async function loadApplicabilityRules() {
  const [rows] = await pool.query(
    `SELECT a.*, ar.article_key, ar.section, ar.last_amended_on, v.version_label, v.doc_code
     FROM regulation_applicability a
     LEFT JOIN regulation_articles ar ON ar.id = a.article_id
     LEFT JOIN regulation_versions v ON v.id = ar.version_id
     ORDER BY a.id`
  );
  const iso = dbDateToIso;
  return rows.map((r) => ({
    ruleCode: r.rule_code,
    articleRef: r.article_ref,
    paragraph: r.paragraph,
    scope: r.scope,
    appliesFrom: iso(r.applies_from),
    minAdmissionYear: r.min_admission_year,
    maxAdmissionYear: r.max_admission_year,
    enrollmentType: r.enrollment_type,
    conditionCode: r.condition_code,
    conditionParams: typeof r.condition_params === 'string' ? JSON.parse(r.condition_params) : r.condition_params,
    effect: r.effect,
    confidence: r.confidence,
    critical: r.critical === 1,
    note: r.note,
    article: r.article_key ? { docCode: r.doc_code, articleKey: r.article_key, section: r.section, lastAmendedOn: iso(r.last_amended_on), versionLabel: r.version_label } : null,
  }));
}

// 제13조③ 판단용: 변경 후(to_year) 교육과정에서 그 과목이 개설된 학년. 같은 학번에 여러 행(트랙·학기)이면 가장 낮은 학년.
async function attachOfferedGrades(changes, departmentIds) {
  const keys = [...new Set(changes.filter((c) => c.field === 'category').map((c) => c.subjectKey))];
  if (keys.length === 0) return changes;
  const [rows] = await pool.query(
    'SELECT course_key, grade, min_admission_year, max_admission_year FROM curriculum_courses WHERE department_id IN (?) AND course_key IN (?)',
    [departmentIds, keys]
  );
  return changes.map((c) => {
    if (c.field !== 'category') return c;
    const own = rows.filter((r) => r.course_key === c.subjectKey);
    const exact = own.filter((r) => (r.min_admission_year == null || r.min_admission_year <= c.toYear) && (r.max_admission_year == null || r.max_admission_year >= c.toYear));
    if (exact.length) return { ...c, offeredGrade: Math.min(...exact.map((r) => r.grade)), offeredGradeSource: 'EXACT' };
    // 개편으로 학수번호(course_key)가 바뀌면 to_year 편성표에서 못 찾는다. 학년도가 가장 가까운 편성표의 학년을 쓰되 추정으로 표시한다.
    if (own.length === 0) return c;
    const dist = (r) => Math.abs((r.max_admission_year ?? r.min_admission_year ?? c.toYear) - c.toYear);
    const best = Math.min(...own.map(dist));
    return { ...c, offeredGrade: Math.min(...own.filter((r) => dist(r) === best).map((r) => r.grade)), offeredGradeSource: 'NEAREST_SNAPSHOT' };
  });
}

function mapChangeRow(r) {
  return {
    subjectKey: r.subject_key, displayName: r.display_name, departmentId: r.department_id, trackId: r.track_id,
    fromYear: r.from_year, toYear: r.to_year, field: r.field, changeType: r.change_type,
    oldValue: r.old_value, newValue: r.new_value, note: r.note, offeredGrade: null,
  };
}

/**
 * resolveApplicableRules(input, data)의 data. 읽기 전용.
 * withRequirements=false면 파트 1 졸업요건 계산(loadData)을 건너뛴다.
 */
async function loadApplicabilityData(ctx, { withRequirements = true } = {}) {
  const department = await loadDepartment(ctx);
  const [rules, latestDataYear, textVersions, relations] = await Promise.all([loadApplicabilityRules(), loadLatestDataYear(), loadTextVersions(), loadRelations()]);
  if (!department) return { department: null, rules, latestDataYear, textVersions, relations, courseChanges: [], requirementChanges: [], lineage: [], equivalences: [], categoryOverrides: [], requirements: null };

  const chain = await getDepartmentChain(department.id);
  const ids = chain.departmentIds;
  const [courseRows] = await pool.query(
    "SELECT * FROM curriculum_changes WHERE subject_type = 'COURSE' AND department_id IN (?) AND to_year > ?",
    [ids, ctx.admissionYear]
  );
  const [reqRows] = await pool.query(
    "SELECT * FROM curriculum_changes WHERE subject_type = 'REQUIREMENT' AND department_id IN (?) AND to_year > ?",
    [ids, ctx.admissionYear]
  );
  const [equivalences] = await pool.query('SELECT * FROM course_equivalences WHERE department_id IS NULL OR department_id IN (?)', [ids]);
  const [overrides] = await pool.query('SELECT * FROM course_category_overrides WHERE department_id IS NULL OR department_id IN (?)', [ids]);

  return {
    department,
    rules,
    latestDataYear,
    textVersions,
    relations,
    courseChanges: await attachOfferedGrades(courseRows.map(mapChangeRow), ids),
    requirementChanges: reqRows.map(mapChangeRow),
    lineage: chain.edges,
    equivalences: equivalences.map((e) => ({ departmentId: e.department_id, fromCourseKey: e.from_course_key, toCourseKey: e.to_course_key, designatedYear: e.designated_year, basisArticleRef: e.basis_article_ref, source: e.source, note: e.note })),
    categoryOverrides: overrides.map((o) => ({ departmentId: o.department_id, courseKey: o.course_key, academicYear: o.academic_year, semester: o.semester, category: o.category, basisArticleRef: o.basis_article_ref, source: o.source, note: o.note })),
    requirements: withRequirements ? await loadData(ctx) : null,
  };
}

module.exports = { loadData, loadRequirementRows, loadApplicabilityData, loadLatestDataYear, loadTextVersions, loadRelations };
