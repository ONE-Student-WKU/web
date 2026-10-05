const { CONFIDENCE, CONFIDENCE_LABEL_KO } = require('./constants');
const { makeFlag, confidenceFromFlags, worstConfidence, dedupeFlags } = require('./flags');
const { normalizeInput } = require('./context');
const { checkEligibility } = require('./decisions');
const { evaluate } = require('./evaluate');
const dq = require('./dataQuality');
const { checkSchedule4Credits } = require('./schedule4');
const { articleTextFlags } = require('./textVersion');
const { buildRelationIndex, walkRelations } = require('./relationWalk');

/**
 * server/services/regulationEngine/applicability.js
 * resolveApplicableRules — "이 학생(입학년도·입학유형·학과)에게 기준일에 어떤 규정이 적용되나"를 판단하는 순수 함수.
 *
 * 파트 1의 evaluate()가 "학번별 졸업요건 값"을 계산한다면, 여기는 그 위에서 **규정 조문의 적용범위**를 판단한다:
 *  - COHORT_ONLY  : 학번 범위에만 적용(시행규칙 제5조, 학칙 [별표 4] 학번별 표)
 *  - ALL_ENROLLED : 시행 후 재학생 전원(제13조① 신 교육과정)
 *  - TRANSITIONAL : 조건부 경과조치(제13조②~④, 제14조, 부칙) — 과목 변경 이력(curriculum_changes)으로 과목 단위 판단
 * 적용범위 정의는 데이터(db/regulation-engine/applicability.json → regulation_applicability)이고, 여기는 conditionCode별
 * 해석기만 갖는다. 새 conditionCode를 데이터에 넣으면 아래 HANDLERS에 구현이 있어야 한다(없으면 즉시 에러 — 조용히 무시하지 않음).
 *
 * 왜 DB를 직접 안 읽나: 학번·입학유형·학과 개편·데이터 등급 조합을 DB 없이 단위 테스트로 고정하기 위해서(파트 1 evaluate와 같은 이유).
 * DB에서 data를 만드는 건 dbProvider.loadApplicabilityData.
 *
 * data 형식(전부 camelCase):
 *  - department: { id, name } | null
 *  - rules: regulation_applicability 행 + article: { docCode, articleKey, section, lastAmendedOn, versionLabel } | null
 *  - courseChanges: curriculum_changes(COURSE) 중 학과 계보(개편 전후 학과) 행 —
 *      { subjectKey, displayName, departmentId, trackId, fromYear, toYear, field, changeType, oldValue, newValue, note, offeredGrade }
 *      offeredGrade: 변경 후(to_year) 교육과정에서 그 과목이 개설된 학년(제13조③용, 모르면 null)
 *  - requirementChanges: curriculum_changes(REQUIREMENT) 같은 계보 행(이력 표시용) — { subjectKey, field, changeType, oldValue, newValue, fromYear, toYear }
 *  - lineage: department_lineage 간선 — { fromDepartmentId, fromDepartmentName, toDepartmentId, toDepartmentName, relation, effectiveYear, source }
 *  - equivalences / categoryOverrides: course_equivalences / course_category_overrides 행(지금은 비어 있음)
 *  - latestDataYear: 시스템이 가진 최신 학년도
 *  - requirements: (선택) 파트 1 dbProvider.loadData 결과 — 있으면 evaluate()를 돌려 졸업요건 값과 칸별 신뢰도를 같이 낸다
 */

// 제13조②③의 "필수과목/선택과목". 2026 광역계열의 전공기초·전공심화·전공응용 등은 원문에 필수/선택 정의가 없어 어느 쪽에도 넣지 않는다.
const REQUIRED_CATEGORIES = new Set(['전공필수', '교양필수']);
const ELECTIVE_CATEGORIES = new Set(['전공선택', '교양선택', '일반선택']);
const GRADE_BASES = ['AT_REVISION', 'AT_AS_OF'];
const REORG_NOTE_RE = /^학과 개편\(/;

function nature(category) {
  if (REQUIRED_CATEGORIES.has(category)) return 'REQUIRED';
  if (ELECTIVE_CATEGORIES.has(category)) return 'ELECTIVE';
  return 'UNCLASSIFIED';
}

// curriculum_changes의 existence 값은 "전공필수 2학년 1학기" 형식 — 첫 단어가 이수구분, 둘째가 학년.
function parseExistenceValue(v) {
  if (!v) return { category: null, grade: null };
  const m = /^(\S+)\s+(\d)학년/.exec(v);
  return m ? { category: m[1], grade: Number(m[2]) } : { category: v.split(/\s+/)[0], grade: null };
}

const inCohort = (row, year) => (row.minAdmissionYear == null || year >= row.minAdmissionYear) && (row.maxAdmissionYear == null || year <= row.maxAdmissionYear);
const enrollmentMatches = (row, type) => row.enrollmentType == null || row.enrollmentType === type;

/** 부칙 조문은 그 부칙 날짜 전에는 존재하지 않았다('부칙(2026.04.10.)제2조' → '2026-04-10'). */
function addendumDate(articleKey) {
  const m = /^부칙\((\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/.exec(articleKey || '');
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

/**
 * 적용범위 규칙 하나의 판본 플래그 — 졸업요건 규칙과 같은 함수(textVersion.articleTextFlags)를 쓴다(D-42). rule.article.lastAmendedOn은
 * regulation_articles의 개정 표시(null = 표시 없음), 조문 행을 못 찾았으면(rule.article 없음) 모름(undefined)이라 보수적으로 처리된다.
 */
function textFlagsForArticle(asOfDate, rule, textVersions) {
  const [docCode, articleKey] = String(rule.articleRef).split(':');
  return articleTextFlags({ asOfDate, docCode, articleKey, lastAmendedOn: rule.article ? rule.article.lastAmendedOn ?? null : undefined, textVersions });
}

// --- 과목 변경 준비 ---

function prepareCourseChanges(ctx, changes) {
  const seen = new Set();
  const out = [];
  for (const c of changes || []) {
    if (c.toYear == null || c.toYear <= ctx.admissionYear) continue; // 입학 전(이미 입학 학번 교육과정에 반영된) 변경은 경과조치 대상이 아니다
    if (c.trackId != null && ctx.trackId != null && c.trackId !== ctx.trackId) continue;
    const key = [c.subjectKey, c.field, c.changeType, c.toYear, c.oldValue, c.newValue].join('|');
    if (seen.has(key)) continue; // 트랙별로 같은 변경이 중복 저장돼 있다
    seen.add(key);
    out.push(c);
  }
  return out.sort((a, b) => a.toYear - b.toYear || String(a.displayName).localeCompare(String(b.displayName)));
}

/**
 * 개편 공포일을 "그 학년도 3월 1일"로 가정한 영향이 남는 구간 = 개편 학년도 1학기. 2학기 이후라면 그 학년도 책자는 이미 시행 중이다
 * (책자는 학년도 시작 전에 나오므로 1학기 안에서만 공포일이 기준일보다 늦었을 가능성이 있다 — DECISIONS D-28).
 */
function inPromulgationWindow(toYear, asOfTerm) {
  return toYear === asOfTerm.year && asOfTerm.semester === 1;
}

/** 변경 하나의 데이터 신뢰도: 비교한 두 학년도 교육과정 자료의 검수 등급 중 나쁜 쪽 + 판단 보류 + 학과 개편 여부. */
function courseChangeFlags(change, deptName, asOfTerm) {
  const flags = [];
  const years = [change.fromYear ?? change.toYear - 1, change.toYear];
  const grades = years.map((y) => dq.dataGrade('MAJOR_COURSES', y, deptName).grade);
  if (grades.some((g) => g == null || g === 'C')) flags.push(makeFlag('COURSE_DATA_GRADE_C', { years }));
  else if (grades.includes('B')) flags.push(makeFlag('COURSE_DATA_GRADE_B', { years }));
  const holds = years.flatMap((y) => dq.pendingHoldsFor(y, deptName, 'MAJOR_COURSES'));
  if (holds.length) flags.push(makeFlag('DATA_PENDING_HOLD', { holds: [...new Set(holds.map((h) => h.id))] }));
  if (change.note && REORG_NOTE_RE.test(change.note)) flags.push(makeFlag('DEPARTMENT_REORG_CHANGE', { note: change.note }));
  if (inPromulgationWindow(change.toYear, asOfTerm)) flags.push(makeFlag('CURRICULUM_PROMULGATION_DATE_ASSUMED'));
  return flags;
}

function courseItem(change, flags, extra = {}) {
  const all = dedupeFlags(flags);
  return {
    courseKey: change.subjectKey,
    courseName: change.displayName,
    fromYear: change.fromYear,
    toYear: change.toYear,
    change: { field: change.field, changeType: change.changeType, oldValue: change.oldValue, newValue: change.newValue },
    confidence: confidenceFromFlags(all),
    flags: all.map((f) => f.code),
    ...extra,
  };
}

/** 입학 후 ~ 기준일(또는 최신 자료) 사이 학년도 중 과목 자료가 C등급인 해 — 이 구간의 "변경 없음"은 확인되지 않은 것이다. */
function unverifiedCourseYears(ctx, deptName, lastYear) {
  const out = [];
  for (let y = ctx.admissionYear + 1; y <= lastYear; y++) {
    const g = [y - 1, y].map((yy) => dq.dataGrade('MAJOR_COURSES', yy, deptName).grade);
    if (g.some((x) => x == null || x === 'C')) out.push(y);
  }
  return out;
}

/** 이수구분 "수강한 학년도·학기" 기준(제13조④). 학년도 T에 들은 과목은 T학년도 교육과정의 이수구분(+ 학교 공지 override). */
function categoryAtRegistration({ courseKey, year, semester = null }, changes, overrides = [], admissionCategory = null) {
  const own = overrides.filter((o) => o.courseKey === courseKey && o.academicYear === year && (o.semester == null || semester == null || o.semester === semester));
  if (own.length) return { category: own[0].category, source: 'OVERRIDE', basis: own[0].basisArticleRef || 'ENFORCEMENT_RULES:제13조④' };
  const cat = changes.filter((c) => c.subjectKey === courseKey && c.field === 'category').sort((a, b) => a.toYear - b.toYear);
  let category = cat.length ? cat[0].oldValue : admissionCategory;
  for (const c of cat) if (c.toYear <= year) category = c.newValue;
  return { category, source: cat.length ? 'CURRICULUM_YEAR_BOOK' : 'ADMISSION_CURRICULUM', basis: 'ENFORCEMENT_RULES:제13조④' };
}

// --- conditionCode별 해석기. 반환: { status, reason, details?, flags?, alternatives? } ---
// status: APPLIES(적용) | NOT_APPLICABLE(해당 없음) | CONDITIONAL(입력에 없는 정보에 따라 갈림) | UNKNOWN(자료 부족으로 판단 불가)

function cohortRule(h) {
  const { ctx, row } = h;
  if (!inCohort(row, ctx.admissionYear)) return { status: 'NOT_APPLICABLE', reason: `학번 범위(${row.minAdmissionYear ?? '~'}~${row.maxAdmissionYear ?? ''}) 밖` };
  if (!enrollmentMatches(row, ctx.enrollmentType)) return { status: 'NOT_APPLICABLE', reason: '입학유형 해당 없음' };
  return null;
}

/** 과목 변경 판단 공통: 자료가 없거나(C등급) 학과를 모르면 "변경 없음"이라 하지 않는다. */
function noChangeResult(h, what) {
  if (!h.data.department) return { status: 'UNKNOWN', reason: '학과를 몰라 판단 불가', flags: [makeFlag('DEPARTMENT_NOT_FOUND')] };
  if (h.unverifiedYears.length) {
    return { status: 'UNKNOWN', reason: `${what} 기록 없음(검증 안 됨)`, flags: [makeFlag('HISTORY_NOT_VERIFIED', { years: h.unverifiedYears })] };
  }
  return { status: 'NOT_APPLICABLE', reason: `입학 후 기준일까지 ${what} 없음` };
}

const HANDLERS = {
  COHORT_RANGE: (h) => cohortRule(h) || { status: 'APPLIES', reason: '이 학번에 해당하는 표' },

  CURRICULUM_SNAPSHOT_AT_ADMISSION: (h) => cohortRule(h) || {
    status: 'APPLIES', reason: '입학 학번 교육과정 기준',
    details: { cohortYear: h.ctx.admissionYear },
  },

  GRAD_CREDITS_SCHEDULE4: (h) => {
    const r = cohortRule(h);
    if (r) return r;
    const table = h.data.rules.find((x) => /^ACAD_SCHED4_/.test(x.ruleCode) && inCohort(x, h.ctx.admissionYear));
    return { status: 'APPLIES', reason: '졸업 이수학점은 학칙 [별표 4]의 이 학번 표', details: { scheduleRule: table ? table.ruleCode : null, scheduleRef: table ? table.articleRef : null } };
  },

  CURRICULUM_REVISED_AFTER_ADMISSION: (h) => {
    const r = cohortRule(h);
    if (r) return r;
    if (h.effective.length === 0) return noChangeResult(h, '교육과정 개편');
    const years = [...new Set(h.effective.map((c) => c.toYear))];
    const flags = h.effective.some((c) => inPromulgationWindow(c.toYear, h.ctx.asOfTerm)) ? [makeFlag('CURRICULUM_PROMULGATION_DATE_ASSUMED')] : [];
    return { status: 'APPLIES', reason: `입학 후 교육과정 개편(${years.join(', ')}학년도)`, details: { revisionYears: years, changeCount: h.effective.length, upcomingYears: [...new Set(h.upcoming.map((c) => c.toYear))] }, flags };
  },

  REQUIRED_BECAME_ELECTIVE_OR_ABOLISHED: (h) => {
    const r = cohortRule(h);
    if (r) return r;
    const exempt = [];
    const unclassified = [];
    for (const c of h.effective) {
      let before = null;
      let after = null;
      let abolished = false;
      if (c.field === 'category' && c.changeType === 'CHANGED') [before, after] = [c.oldValue, c.newValue];
      else if (c.field === 'existence' && c.changeType === 'REMOVED') { before = parseExistenceValue(c.oldValue).category; abolished = true; }
      else continue;
      if (nature(before) !== 'REQUIRED') continue;
      const flags = courseChangeFlags(c, h.deptName, h.ctx.asOfTerm);
      if (abolished || nature(after) === 'ELECTIVE') exempt.push(courseItem(c, flags, { kind: abolished ? 'ABOLISHED' : 'REQUIRED_TO_ELECTIVE', exempt: true }));
      else if (nature(after) === 'UNCLASSIFIED') unclassified.push(courseItem(c, [...flags, makeFlag('CATEGORY_NATURE_UNKNOWN')], { kind: 'REQUIRED_TO_UNCLASSIFIED', exempt: null }));
    }
    if (exempt.length === 0 && unclassified.length === 0) return noChangeResult(h, '필수→선택 변경·폐설');
    const items = [...exempt, ...unclassified];
    return {
      status: exempt.length ? 'APPLIES' : 'UNKNOWN',
      reason: `이수하지 않아도 되는 과목 ${exempt.length}개${unclassified.length ? `, 판단 보류 ${unclassified.length}개` : ''}`,
      details: { exempt, unclassified },
      flags: [...worstItemFlags(items), ...incompleteFlags(h)],
    };
  },

  ELECTIVE_BECAME_REQUIRED: (h) => {
    const r = cohortRule(h);
    if (r) return r;
    const basis = h.gradeBasis;
    const courses = [];
    const added = [];
    let ambiguous = false;
    for (const c of h.effective) {
      if (c.field === 'existence' && c.changeType === 'ADDED' && nature(parseExistenceValue(c.newValue).category) === 'REQUIRED') {
        added.push(courseItem(c, [...courseChangeFlags(c, h.deptName, h.ctx.asOfTerm), makeFlag('NEW_REQUIRED_COURSE_NOT_COVERED')], { kind: 'NEW_REQUIRED', exempt: null }));
        continue;
      }
      if (!(c.field === 'category' && c.changeType === 'CHANGED' && nature(c.oldValue) === 'ELECTIVE' && nature(c.newValue) === 'REQUIRED')) continue;
      const flags = [...courseChangeFlags(c, h.deptName, h.ctx.asOfTerm), makeFlag('GRADE_FROM_ADMISSION_YEAR')];
      if (c.offeredGradeSource === 'NEAREST_SNAPSHOT') flags.push(makeFlag('OFFERED_GRADE_FROM_NEAREST_SNAPSHOT'));
      const gradeAtRevision = c.toYear - h.ctx.admissionYear + 1;
      const gradeAtAsOf = h.asOfYear - h.ctx.admissionYear + 1;
      if (c.offeredGrade == null) {
        courses.push(courseItem(c, [...flags, makeFlag('OFFERED_GRADE_UNKNOWN')], { kind: 'ELECTIVE_TO_REQUIRED', offeredGrade: null, exempt: null }));
        continue;
      }
      // "재학 중인 학년보다 저학년에 개설된 경우 이수하지 않아도 된다" — 개설 학년 < 재학 학년이면 면제.
      const byBasis = { AT_REVISION: c.offeredGrade < gradeAtRevision, AT_AS_OF: c.offeredGrade < gradeAtAsOf };
      const other = GRADE_BASES.find((b) => b !== basis);
      const alternatives = [];
      if (byBasis[basis] !== byBasis[other]) {
        ambiguous = true;
        flags.push(makeFlag('TRANSITION_GRADE_BASIS_AMBIGUOUS'));
        alternatives.push({ gradeBasis: other, exempt: byBasis[other] });
      }
      courses.push(courseItem(c, flags, { kind: 'ELECTIVE_TO_REQUIRED', offeredGrade: c.offeredGrade, gradeAtRevision, gradeAtAsOf, gradeBasis: basis, exempt: byBasis[basis], alternatives }));
    }
    if (courses.length === 0 && added.length === 0) return noChangeResult(h, '선택→필수 변경');
    const items = [...courses, ...added];
    return {
      status: courses.length ? 'APPLIES' : 'UNKNOWN',
      reason: `선택→필수 ${courses.length}개(면제 ${courses.filter((x) => x.exempt).length}개)${added.length ? `, 신설 필수 ${added.length}개(조문 미규정)` : ''}`,
      details: { gradeBasis: basis, courses, newRequired: added },
      flags: [...worstItemFlags(items), ...incompleteFlags(h)],
      alternatives: ambiguous ? [{ gradeBasis: GRADE_BASES.find((b) => b !== basis), description: basis === 'AT_REVISION' ? '"재학 중인 학년"을 기준일의 학년으로 해석' : '"재학 중인 학년"을 개편 시점의 학년으로 해석' }] : [],
    };
  },

  CATEGORY_CHANGED: (h) => {
    const r = cohortRule(h);
    if (r) return r;
    const all = [...h.effective, ...h.upcoming].filter((c) => c.field === 'category' && c.changeType === 'CHANGED');
    if (all.length === 0) return noChangeResult(h, '이수구분 변경');
    const items = all.map((c) => courseItem(c, [...courseChangeFlags(c, h.deptName, h.ctx.asOfTerm), makeFlag('CATEGORY_YEAR_BOOK_ASSUMED')], {
      kind: 'CATEGORY_CHANGED',
      inEffect: c.toYear <= h.asOfYear,
      rule: `${c.toYear - 1}학년도까지 수강 → ${c.oldValue}, ${c.toYear}학년도부터 수강 → ${c.newValue}`,
    }));
    const overrides = (h.data.categoryOverrides || []).filter((o) => h.chainDepartmentIds.has(o.departmentId) || o.departmentId == null);
    return { status: 'APPLIES', reason: `이수구분이 바뀐 과목 ${items.length}개 — 수강한 학년도의 이수구분으로 인정`, details: { courses: items, overrides }, flags: [...worstItemFlags(items), ...incompleteFlags(h)] };
  },

  DEPARTMENT_REORGANIZED: (h) => {
    const r = cohortRule(h);
    if (r) return r;
    if (!h.data.department) return { status: 'UNKNOWN', reason: '학과를 몰라 판단 불가', flags: [makeFlag('DEPARTMENT_NOT_FOUND')] };
    if (h.reorgEdges.length === 0) return { status: 'NOT_APPLICABLE', reason: '입학 후 학과 개편 없음(계보 자료 기준)' };
    const flags = h.reorgEdges.some((e) => e.source === 'NAME_MATCH') ? [makeFlag('LINEAGE_NAME_MATCH')] : [];
    const inEffect = h.reorgEdges.filter((e) => e.effectiveYear <= h.asOfYear);
    return {
      status: inEffect.length ? 'APPLIES' : 'NOT_APPLICABLE',
      reason: inEffect.length ? `입학 후 학과 개편(${inEffect.map((e) => `${e.fromDepartmentName} → ${e.toDepartmentName}, ${e.effectiveYear}`).join('; ')})` : '개편 예정(기준일 이후)',
      details: { edges: h.reorgEdges },
      flags,
    };
  },

  EQUIVALENCE_DESIGNATED: (h) => {
    const list = (h.data.equivalences || []).filter((e) => e.departmentId == null || h.chainDepartmentIds.has(e.departmentId));
    if (list.length) return { status: 'APPLIES', reason: `동일과목 지정 ${list.length}건`, details: { equivalences: list } };
    const changed = h.effective.length > 0 || h.reorgEdges.some((e) => e.effectiveYear <= h.asOfYear);
    if (!changed) return { status: 'NOT_APPLICABLE', reason: '입학 후 개편이 없어 동일과목 지정이 문제되지 않음' };
    return { status: 'UNKNOWN', reason: '개편이 있었지만 동일과목 지정 목록 자료 없음', flags: [makeFlag('EQUIVALENCE_LIST_NOT_HELD')] };
  },

  GRADUATING_ON_OR_AFTER: (h) => {
    const r = cohortRule(h);
    if (r) return r;
    // 기준일에 재학 중이면 졸업은 기준일 이후다. 기준일이 2026-08-01 이후면 "2026년 8월 이후 졸업자"가 확정이고,
    // 그 전이면 언제 졸업하느냐(입력에 없음)에 따라 개정 전/후 표가 갈린다.
    if (h.row.appliesFrom && h.ctx.asOfDate >= h.row.appliesFrom) return { status: 'APPLIES', reason: '기준일에 재학 중이면 2026년 8월 이후 졸업 — 개정된 [별표 4] 적용' };
    return {
      status: 'CONDITIONAL',
      reason: '2026년 8월 이후 졸업하면 개정된 [별표 4], 그 전에 졸업하면 개정 전 표(미보유)',
      flags: [makeFlag('SCHEDULE4_PRE_AMENDMENT_NOT_HELD')],
      details: { graduationFrom: h.row.conditionParams && h.row.conditionParams.graduationFrom },
    };
  },

  PRIOR_ADDENDUM_NOT_HELD: (h) => cohortRule(h) || {
    status: 'APPLIES', reason: '2026.02.05. 전부개정 전 입학 학번 — 종전 부칙의 경과조치 대상', flags: [makeFlag('PRIOR_ADDENDUM_NOT_HELD')],
  },

  MAJOR_CHANGE_TARGET: (h) => {
    const { ctx, row, deptName } = h;
    const targets = (row.conditionParams && row.conditionParams.departments) || [];
    if (ctx.enrollmentType !== 'MAJOR_CHANGE' || !targets.includes(deptName)) return { status: 'NOT_APPLICABLE', reason: '이 학과로의 전과가 아님' };
    if (!inCohort(row, ctx.admissionYear)) {
      return { status: 'NOT_APPLICABLE', reason: `${row.minAdmissionYear}학년도 입학생부터 허용되는 전과`, flags: [makeFlag('MAJOR_CHANGE_TARGET_NOT_ALLOWED_FOR_COHORT')] };
    }
    return { status: 'APPLIES', reason: '이 학과로의 전과 허용 학번' };
  },
};

/** 입학 후 구간에 C등급 학년도가 있으면, 찾은 과목 목록이 전부라고 말할 수 없다(그 해의 변경이 기록에서 빠졌을 수 있음). */
function incompleteFlags(h) {
  return h.unverifiedYears.length ? [makeFlag('HISTORY_NOT_VERIFIED', { years: h.unverifiedYears })] : [];
}

/** 과목 목록의 플래그를 규칙 수준으로 올린다 — 가장 나쁜 신뢰도를 만든 플래그 코드만(목록이 길어도 규칙 플래그는 짧게). */
function worstItemFlags(items) {
  const codes = new Set(items.flatMap((i) => i.flags));
  return [...codes].map((c) => makeFlag(c));
}

function buildRule(row, result, h, evidence = null) {
  const flags = [...(result.flags || [])];
  if (row.confidence === 'ESTIMATED' && result.status !== 'NOT_APPLICABLE') flags.push(makeFlag('APPLICABILITY_ESTIMATED', { note: row.note }));
  if (result.status !== 'NOT_APPLICABLE') flags.push(...textFlagsForArticle(h.ctx.asOfDate, row, h.textVersions));
  const all = dedupeFlags(flags);
  const confidence = confidenceFromFlags(all);
  return {
    ruleCode: row.ruleCode,
    scope: row.scope,
    status: result.status,
    reason: result.reason,
    effect: row.effect,
    critical: row.critical !== false,
    confidence,
    confidenceLabel: CONFIDENCE_LABEL_KO[confidence],
    basis: {
      articleRef: row.articleRef,
      paragraph: row.paragraph ?? null,
      versionLabel: row.article ? row.article.versionLabel : null,
      lastAmendedOn: row.article ? row.article.lastAmendedOn : null,
      note: row.note ?? null,
    },
    details: result.details || null,
    alternatives: result.alternatives || [],
    // 이 조문에서 조문 관계(위임·참조·특칙·개정)를 따라간 경로 — "왜 이 조문들이 근거인가"(relationWalk.js, D-43). 관계 자료가 없으면 null.
    evidence,
    flags: all,
  };
}

// --- 변경 이력(학년도별 기록 상태) ---

function buildHistory(ctx, deptName, prepared, requirementChanges, lastDataYear) {
  const years = [];
  const reqChanges = (requirementChanges || []).filter((c) => c.toYear != null && c.toYear > ctx.admissionYear);
  for (let y = ctx.admissionYear + 1; y <= lastDataYear; y++) {
    const courseCount = prepared.filter((c) => c.toYear === y).length;
    const reqCount = reqChanges.filter((c) => c.toYear === y).length;
    const courseGrades = [y - 1, y].map((yy) => dq.dataGrade('MAJOR_COURSES', yy, deptName).grade);
    const reqGrades = [y - 1, y].map((yy) => dq.dataGrade('REQUIREMENTS', yy, deptName).grade);
    years.push({
      year: y,
      inEffect: y <= ctx.asOfTerm.year,
      requirements: historyStatus(reqCount, reqGrades),
      courses: historyStatus(courseCount, courseGrades),
    });
  }
  return { years, requirementChanges: reqChanges };
}

function historyStatus(count, grades) {
  const verified = grades.every((g) => g === 'A' || g === 'B');
  if (count > 0) return { count, status: 'CHANGED', label: verified ? '변경 있음' : '변경 있음(자료 검증 안 됨 — 일부는 자료 오류일 수 있음)', grades };
  return verified ? { count, status: 'NO_CHANGE', label: '변경 없음', grades } : { count, status: 'NOT_VERIFIED', label: '기록 없음(검증 안 됨)', grades };
}

// --- 졸업요건(파트 1 evaluate) 결과에 데이터 등급을 입힌다 ---

/**
 * 학칙 [별표 4] 졸업학점 vs 책자 졸업학점 대조(schedule4.js). 학과가 표에 직접 적혀 있고 값이 다를 때만 불일치를 돌려준다.
 * rows: 그 학과의 요건 행(dbProvider.loadRequirementRows 모양). 입학유형과 무관하게 일반 재학생 책자 총량으로 비교한다.
 */
function schedule4Mismatch(ctx, deptName, rows) {
  const check = checkSchedule4Credits({ departmentName: deptName, admissionYear: ctx.admissionYear, rows });
  return check && !check.match ? check : null;
}

// 졸업학점 표를 "적용"한다고 말하는 규칙들 — 학칙 [별표 4] 학번별 표 4개와 그 표를 가리키는 시행규칙 제118조.
const isSchedule4Rule = (row) => row.conditionCode === 'GRAD_CREDITS_SCHEDULE4' || /^ACAD_SCHED4_/.test(row.ruleCode);

function annotateRequirements(ctx, result, deptName, data = null) {
  const sched4 = schedule4Mismatch(ctx, deptName, data && data.rows);
  const { grade } = dq.dataGrade('REQUIREMENTS', ctx.admissionYear, deptName);
  const base = dq.gradeConfidence(grade);
  const holds = dq.pendingHoldsFor(ctx.admissionYear, deptName, 'REQUIREMENTS');
  const overrideHolds = dq.pendingHoldsFor(ctx.admissionYear, deptName, 'ENROLLMENT_OVERRIDE');
  const holdFlag = (list) => (list.length ? [makeFlag('DATA_PENDING_HOLD', { holds: list.map((x) => x.id), notes: list.map((x) => x.note) })] : []);
  const gradeFlags = grade === 'C' ? [makeFlag('REQUIREMENT_DATA_GRADE_C')] : grade === 'B' ? [makeFlag('REQUIREMENT_DATA_GRADE_B')] : [];
  const fieldBase = holds.length ? worstConfidence([base, CONFIDENCE.ESTIMATED]) : base;

  const rules = result.rules.map((rule) => {
    if (rule.id === 'REQUIREMENTS' && rule.value) {
      const flags = dedupeFlags([...rule.flags, ...gradeFlags, ...holdFlag(holds), ...(sched4 ? [makeFlag('SCHEDULE4_CREDIT_MISMATCH', sched4)] : [])]);
      const unverified = dq.UNVERIFIED_REQUIREMENT_PARTS;
      const value = {
        ...rule.value,
        dataGrade: { area: 'REQUIREMENTS', year: ctx.admissionYear, grade },
        // 학칙 [별표 4]와 값이 다르면 둘 다 싣는다(어느 쪽이 맞는지는 판단하지 않음). 같거나 대조 불가면 null.
        schedule4: sched4,
        totalConfidence: sched4 ? worstConfidence([fieldBase, CONFIDENCE.ESTIMATED]) : fieldBase,
        categories: rule.value.categories.map((c) => {
          const split = unverified.categories.includes(c.category);
          return {
            ...c,
            confidence: split ? worstConfidence([fieldBase, CONFIDENCE.ESTIMATED]) : fieldBase,
            confidenceNote: split ? '교양필수/교양선택 분할은 합계만 검수됨(DATA_AUDIT §4)' : null,
            requiredCoursesConfidence: c.requiredCourses && c.requiredCourses.length ? CONFIDENCE.ESTIMATED : null,
          };
        }),
        certifications: rule.value.certifications.map((c) => ({ ...c, confidence: CONFIDENCE.ESTIMATED, confidenceNote: '졸업논문·졸업인증제 행은 책자 대조 안 됨(DATA_AUDIT §6-4)' })),
      };
      return { ...rule, value, flags, confidence: confidenceFromFlags(flags) };
    }
    if (rule.id === 'MAJOR_MINIMUM' && overrideHolds.length && ctx.enrollmentType !== 'GENERAL') {
      const flags = dedupeFlags([...rule.flags, ...holdFlag(overrideHolds)]);
      return { ...rule, flags, confidence: confidenceFromFlags(flags) };
    }
    return rule;
  });
  return {
    ...result,
    rules,
    confidence: worstConfidence(rules.filter((r) => r.critical).map((r) => r.confidence)),
    flags: dedupeFlags(rules.flatMap((r) => r.flags)),
  };
}

/**
 * @param {object} rawInput  { admissionYear, enrollmentType, departmentId|departmentName, asOfDate?, trackId?, majorChange?, transfer?,
 *                             policy?: { transitionGradeBasis?: 'AT_REVISION'|'AT_AS_OF', liberalArtsCutoffTrigger? } }
 * @param {object} data      위 주석의 data 형식
 * @param {object} [opts]    { today: 'YYYY-MM-DD' } — asOfDate 기본값 고정(테스트)
 */
function resolveApplicableRules(rawInput, data, opts = {}) {
  const { ctx, errors } = normalizeInput(rawInput, { today: opts.today });
  const gradeBasis = (rawInput && rawInput.policy && rawInput.policy.transitionGradeBasis) || 'AT_REVISION';
  if (!GRADE_BASES.includes(gradeBasis)) (errors || []).push('policy.transitionGradeBasis는 AT_REVISION | AT_AS_OF 중 하나여야 해요');
  if (!ctx || !GRADE_BASES.includes(gradeBasis)) {
    const flag = makeFlag('INVALID_INPUT', { errors });
    return { input: null, department: null, confidence: CONFIDENCE.NO_DATA, confidenceLabel: CONFIDENCE_LABEL_KO.NO_DATA, rules: [], history: null, requirements: null, dataQuality: null, flags: [flag] };
  }

  const d = data || {};
  const department = d.department || null;
  const deptName = department ? department.name : null;
  const asOfYear = ctx.asOfTerm.year;
  const latest = d.latestDataYear ?? null;
  const lastYear = latest == null ? asOfYear : Math.min(asOfYear, latest);

  const topFlags = [...checkEligibility(ctx)];
  // 적용범위 행이 하나도 없으면(운영 DB에 seed:regulation-articles를 안 돌린 경우 등) rules가 빈 배열이 되는데,
  // 그대로 두면 "적용되는 경과조치 없음"처럼 보인다. 판단을 못 한 것이므로 자료없음으로 올린다(RISKS R-16).
  if ((d.rules || []).length === 0) topFlags.push(makeFlag('APPLICABILITY_DATA_MISSING'));
  if (!department) topFlags.push(makeFlag('DEPARTMENT_NOT_FOUND'));
  else if (latest != null && ctx.admissionYear > latest) topFlags.push(makeFlag('COHORT_BEYOND_LATEST_DATA', { latestDataYear: latest }));

  const prepared = prepareCourseChanges(ctx, d.courseChanges);
  const chainDepartmentIds = new Set([department && department.id, ...(d.lineage || []).flatMap((e) => [e.fromDepartmentId, e.toDepartmentId])].filter((x) => x != null));
  // 입학 후 개편: 이 학과가 출발점이거나 도착점인 간선 중 효력 학번이 입학 학번보다 늦은 것.
  const reorgEdges = department
    ? (d.lineage || []).filter((e) => (e.fromDepartmentId === department.id || e.toDepartmentId === department.id) && e.effectiveYear > ctx.admissionYear)
    : [];
  if (reorgEdges.some((e) => e.toDepartmentId === department.id && e.effectiveYear > ctx.admissionYear)) topFlags.push(makeFlag('DEPARTMENT_IS_SUCCESSOR_OF_COHORT'));

  const h = {
    ctx, data: { ...d, rules: d.rules || [] }, textVersions: d.textVersions || (d.requirements && d.requirements.textVersions) || undefined, deptName, asOfYear, gradeBasis, chainDepartmentIds, reorgEdges,
    effective: prepared.filter((c) => c.toYear <= asOfYear),
    upcoming: prepared.filter((c) => c.toYear > asOfYear),
    unverifiedYears: department ? unverifiedCourseYears(ctx, deptName, lastYear) : [],
  };

  const sched4 = d.requirements && department ? schedule4Mismatch(ctx, deptName, d.requirements.rows) : null;
  // 1단계: 규칙마다 적용 여부 판단. 2단계: 적용되는 조문에서 조문 관계를 따라가 근거 경로를 붙인다(별표 하위 표 선택에 "적용되는 조문" 집합이 필요해 두 단계).
  const judged = (d.rules || []).map((row) => {
    const handler = HANDLERS[row.conditionCode];
    if (!handler) throw new Error(`구현되지 않은 적용 조건: ${row.conditionCode} (${row.ruleCode})`);
    const since = row.article ? addendumDate(row.article.articleKey) : null;
    const result0 = since && ctx.asOfDate < since
      ? { status: 'NOT_APPLICABLE', reason: `기준일(${ctx.asOfDate})에는 아직 없던 부칙(${since})` }
      : handler({ ...h, row });
    // [별표 4]를 적용한다는 규칙에는 책자 값과 다르다는 사실을 함께 붙여, "확정"이라 말하지 않게 한다.
    const result = sched4 && isSchedule4Rule(row) && result0.status !== 'NOT_APPLICABLE'
      ? { ...result0, flags: [...(result0.flags || []), makeFlag('SCHEDULE4_CREDIT_MISMATCH', sched4)] }
      : result0;
    return { row, result };
  });
  const relationIndex = d.relations && d.relations.length ? buildRelationIndex(d.relations) : null;
  const appliedRefs = new Set(judged.filter((j) => j.result.status !== 'NOT_APPLICABLE').map((j) => j.row.articleRef));
  const rules = judged.map(({ row, result }) => buildRule(row, result, h, relationIndex && result.status !== 'NOT_APPLICABLE' ? walkRelations(row.articleRef, relationIndex, { appliedRefs }) : null));

  let requirements = null;
  if (d.requirements) requirements = annotateRequirements(ctx, evaluate(ctx, d.requirements), deptName, d.requirements);

  const counted = rules.filter((r) => r.critical && r.status !== 'NOT_APPLICABLE').map((r) => r.confidence);
  if (requirements) counted.push(requirements.confidence);
  const topConfidence = confidenceFromFlags(topFlags);
  const confidence = worstConfidence([...counted, topConfidence]);

  return {
    input: { ...ctx, policy: { ...ctx.policy, transitionGradeBasis: gradeBasis } },
    department,
    confidence,
    confidenceLabel: CONFIDENCE_LABEL_KO[confidence],
    rules,
    history: department ? buildHistory(ctx, deptName, prepared, d.requirementChanges, latest ?? asOfYear) : null,
    requirements,
    dataQuality: department ? {
      requirements: dq.dataGrade('REQUIREMENTS', ctx.admissionYear, deptName),
      majorCourses: dq.dataGrade('MAJOR_COURSES', ctx.admissionYear, deptName),
      holds: [...new Set([ctx.admissionYear, ...prepared.map((c) => c.toYear)])].flatMap((y) => dq.pendingHoldsFor(y, deptName)).map((x) => x.id),
      unverifiedCourseYears: h.unverifiedYears,
    } : null,
    flags: dedupeFlags([...topFlags, ...rules.filter((r) => r.status !== 'NOT_APPLICABLE').flatMap((r) => r.flags), ...(requirements ? requirements.flags : [])]),
  };
}

module.exports = { resolveApplicableRules, annotateRequirements, categoryAtRegistration, HANDLERS, nature, parseExistenceValue };
