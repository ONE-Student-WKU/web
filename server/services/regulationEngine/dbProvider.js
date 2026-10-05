const pool = require('../../db');
const { getDepartmentChain, describeRuleForCohort } = require('../curriculumHistoryService');
const { hasCoreRowsForYear } = require('./evaluate');

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
  if (!department) return { department: null, rows: [], latestDataYear, candidates: [], history: null };

  const rows = await loadRequirementRows(department.id);
  const beyondLatest = ctx.admissionYear > latestDataYear;
  const hasRows = hasCoreRowsForYear(rows, ctx.admissionYear) && !beyondLatest;
  return {
    department,
    rows,
    latestDataYear,
    candidates: hasRows || beyondLatest ? [] : await loadCandidates(department.id, ctx.admissionYear),
    history: hasRows && withHistory ? await loadHistory(department.id, ctx.admissionYear) : null,
  };
}

module.exports = { loadData, loadRequirementRows };
