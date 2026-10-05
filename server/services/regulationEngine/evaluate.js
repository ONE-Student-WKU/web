const { LIBERAL_ARTS_FIXED_CREDITS } = require('./constants');
const { makeFlag, confidenceFromFlags, worstConfidence, dedupeFlags } = require('./flags');
const {
  checkEligibility,
  decideMajorRelaxation,
  decideLiberalArtsBasis,
  decideLiberalArtsCap,
  checkTextVersion,
  resolveBasis,
  dependsOnArticleText,
} = require('./decisions');

/**
 * server/services/regulationEngine/evaluate.js
 * 판정 파이프라인(순수 함수). DB를 읽지 않고, 호출자가 넘긴 data(학과·졸업요건 행·변경이력)만으로 계산한다.
 * 이렇게 나누는 이유: "어떤 규정이 적용되나"의 논리를 DB 없이 단위 테스트할 수 있어야(= 학과·학번·입학유형 조합을
 * 빠짐없이 검증할 수 있어야) 하기 때문이다. DB 조회는 dbProvider.js가 맡는다.
 *
 * data 형식:
 *  - department: { id, name } | null
 *  - rows: curriculum_requirements 행(그 학과 전체, 학번 필터 전)을 camelCase로 —
 *      { id, category, requiredCredits(Number), description, enrollmentType|null, minCourseCount|null,
 *        minAdmissionYear|null, maxAdmissionYear|null, requiredCourses: string[] }
 *  - latestDataYear: 시스템이 가진 가장 최신 학번/학년도(없으면 null) — 열린 범위 행의 외삽 방지용
 *  - candidates: 이 학번 자료를 가진 "개편 전후 관계 학과" 목록(NO_DATA일 때 안내용) — [{ departmentName, ... }]
 *  - history: { GRAD_TOTAL|MAJOR_TOTAL|LIBERAL_TOTAL: { earlierChanges, laterChanges } } | null
 */

const MAJOR_CATEGORIES = ['전공필수', '전공선택', '전공'];
const LIBERAL_CATEGORIES = ['교양필수', '교양선택'];
const CATEGORY_ORDER = ['교양필수', '교양선택', '전공필수', '전공선택', '전공'];

function rowAppliesToYear(row, year) {
  return (row.minAdmissionYear == null || year >= row.minAdmissionYear) && (row.maxAdmissionYear == null || year <= row.maxAdmissionYear);
}

// "이 학번 자료가 있다"의 기준. 학번 제한이 없는 보조 행(교직기본이수 0학점 등)이나 졸업인증제 행만으로는
// 졸업요건 자료가 있다고 볼 수 없다 — 그것만 보면 교양·전공 요건이 통째로 없는 학번이 "자료 있음"으로 오판된다.
const CORE_CATEGORIES = ['교양필수', '교양선택', '전공필수', '전공선택', '전공'];
function hasCoreRowsForYear(rows, year) {
  return rows.some((r) => r.enrollmentType == null && CORE_CATEGORIES.includes(r.category) && rowAppliesToYear(r, year));
}

const sum = (rows) => rows.reduce((s, r) => s + Number(r.requiredCredits), 0);

/**
 * 졸업요건 행 선택 + 갈래별 조정. 파트 3 이전 graduationService의 selectRequirementRows → applyMajorChangeLiberalArtsOverride →
 * applyMajorChangeGeneralElectiveOverride를 옮긴 것이다(지금은 졸업진단이 이 결과를 그대로 쓴다, D-32).
 * 차이 하나: 일반선택 재배분(완화로 비는 만큼 일반선택이 흡수)을 "3·4학년 전과"만이 아니라 전과생 전체에 적용한다
 * — 교양 29학점 고정만 적용되는 1·2학년 전과에서도 총량 보존 원리가 같기 때문(DECISIONS.md 참고).
 */
function buildRequirementRows(ctx, allYearRows, relaxation, liberal) {
  const flags = [];
  const adjustments = [];
  const generalRows = allYearRows.filter((r) => r.enrollmentType == null);
  let rows = generalRows;

  if (relaxation.relaxedRows) {
    const overrideRows = allYearRows.filter((r) => r.enrollmentType === ctx.enrollmentType);
    if (overrideRows.length > 0) {
      rows = [...generalRows.filter((r) => r.category !== '전공필수' && r.category !== '전공선택'), ...overrideRows];
      adjustments.push('MAJOR_RELAXATION');
    } else if (relaxation.overrideMajorCredits != null) {
      rows = [...generalRows.filter((r) => r.category !== '전공필수' && r.category !== '전공선택'),
        { id: null, category: '전공', requiredCredits: relaxation.overrideMajorCredits, description: '4학년 편입생 최소전공 인정학점(학칙시행규칙 제6조 제3항)', enrollmentType: ctx.enrollmentType, minCourseCount: null, requiredCourses: [] }];
      adjustments.push('MAJOR_RELAXATION');
    } else {
      flags.push(makeFlag('MAJOR_RELAXATION_ROW_MISSING'));
    }
  }

  if (relaxation.overrideMajorCredits != null) {
    rows = rows.map((r) => (r.category === '전공' ? { ...r, requiredCredits: relaxation.overrideMajorCredits } : r));
    adjustments.push('TRANSFER_4TH_MAJOR_21');
  }

  if (liberal.mode === 'FIXED_29') {
    rows = rows.map((r) => (LIBERAL_ARTS_FIXED_CREDITS[r.category] === undefined ? r : { ...r, requiredCredits: LIBERAL_ARTS_FIXED_CREDITS[r.category] }));
    adjustments.push('LIBERAL_FIXED_29');
  }

  // 일반선택 재배분: "완화 = 총 졸업학점 감소"가 아니라 "전공·교양 최소 기준만 채우면 나머지는 자유"이므로,
  // 비는 만큼을 일반선택이 흡수해 총 요구학점이 일반 재학생(같은 학번)과 같게 유지된다. 편입생은 전적대학 인정학점이
  // 껴 있어 이 원리가 그대로 안 맞으므로(총량 미해결) 적용하지 않는다.
  if (ctx.enrollmentType === 'MAJOR_CHANGE' && adjustments.length > 0) {
    const totalDegreeCredits = sum(generalRows);
    const adjusted = totalDegreeCredits - sum(rows.filter((r) => MAJOR_CATEGORIES.includes(r.category))) - sum(rows.filter((r) => LIBERAL_CATEGORIES.includes(r.category)));
    rows = rows.map((r) => (r.category === '일반선택' ? { ...r, requiredCredits: adjusted } : r));
    adjustments.push('GENERAL_ELECTIVE_REBALANCE');
  }

  return { rows, adjustments, flags };
}

function orderCategories(creditRows) {
  const rank = (c) => {
    if (c === '일반선택') return 1000;
    const i = CATEGORY_ORDER.indexOf(c);
    return i === -1 ? 500 : i;
  };
  return [...creditRows].sort((a, b) => rank(a.category) - rank(b.category));
}

function makeRule(id, label, { value, flags, basisKeys, alternatives = [], critical = true, extra = {} }) {
  const allFlags = dedupeFlags(flags);
  return {
    id,
    label,
    critical,
    confidence: confidenceFromFlags(allFlags),
    value,
    flags: allFlags,
    basis: resolveBasis(basisKeys),
    alternatives,
    ...extra,
  };
}

const NOT_DETERMINED_BASIS = [];

function evaluate(ctx, data) {
  const eligibilityFlags = checkEligibility(ctx);
  const textFlags = checkTextVersion(ctx.asOfDate);

  // 판단 자체가 불가능한 입력(미지원 학번·입학 전 기준일 등)이면 규칙 값을 만들지 않는다.
  if (eligibilityFlags.some((f) => f.level === 'NO_DATA')) {
    const blocked = ['REQUIREMENTS', 'MAJOR_MINIMUM', 'LIBERAL_ARTS_BASIS', 'LIBERAL_ARTS_CAP'].map((id) =>
      makeRule(id, RULE_LABELS[id], { value: null, flags: eligibilityFlags, basisKeys: NOT_DETERMINED_BASIS })
    );
    return finalize(ctx, blocked, [makeRule('CURRICULUM_REVISIONS', RULE_LABELS.CURRICULUM_REVISIONS, { value: null, flags: [], basisKeys: [], critical: false })]);
  }

  const relaxation = decideMajorRelaxation(ctx);
  const liberal = decideLiberalArtsBasis(ctx);
  const cap = decideLiberalArtsCap(ctx);

  // 다른 해석(트리거)으로도 계산 가능하면 대안으로 함께 낸다 — 결과가 갈릴 때만.
  const liberalAlternatives = [];
  if (ctx.enrollmentType === 'MAJOR_CHANGE') {
    const otherTrigger = ctx.policy.liberalArtsCutoffTrigger === 'MAJOR_CHANGE_DATE' ? 'RESTRUCTURING_DATE' : 'MAJOR_CHANGE_DATE';
    const other = decideLiberalArtsBasis(ctx, otherTrigger);
    if (other.mode && other.mode !== liberal.mode) {
      liberalAlternatives.push({ id: otherTrigger, description: otherTrigger === 'RESTRUCTURING_DATE' ? '책자 문구대로 "학사구조조정 시점" 기준' : '학생의 "전과 시점" 기준(현재 앱 동작)', mode: other.mode });
    } else if (!other.mode && otherTrigger === 'RESTRUCTURING_DATE') {
      liberalAlternatives.push({ id: otherTrigger, description: '책자 문구대로 "학사구조조정 시점" 기준 — 구조조정 시점(연도·학기)을 입력하면 비교할 수 있어요', mode: null });
    }
  }

  // --- 졸업요건 행 ---
  const dataFlags = [];
  let requirementsValue = null;
  let majorMinimumCredits = null;
  const department = data.department || null;
  const yearRows = department ? (data.rows || []).filter((r) => rowAppliesToYear(r, ctx.admissionYear)) : [];
  if (!department) dataFlags.push(makeFlag('DEPARTMENT_NOT_FOUND'));
  // 상한이 열린 행(max=NULL)은 "그 이후 개편이 확인될 때까지 유효"라는 뜻이지 미래 학번에 대한 확인이 아니다. 시스템이 아는
  // 가장 최신 학년도보다 뒤의 학번에는 외삽하지 않는다.
  else if (data.latestDataYear != null && ctx.admissionYear > data.latestDataYear) {
    dataFlags.push(makeFlag('COHORT_BEYOND_LATEST_DATA', { latestDataYear: data.latestDataYear }));
  } else if (!hasCoreRowsForYear(yearRows, ctx.admissionYear)) dataFlags.push(makeFlag('NO_CURRICULUM_ROWS', { candidates: data.candidates || [] }));

  const reqFlags = [...eligibilityFlags, ...dataFlags, ...relaxation.flags, ...liberal.flags];
  if (dataFlags.length === 0) {
    const built = buildRequirementRows(ctx, yearRows, relaxation, liberal);
    reqFlags.push(...built.flags);
    const creditRows = orderCategories(built.rows.filter((r) => r.minCourseCount == null));
    const certRows = built.rows.filter((r) => r.minCourseCount != null);
    const majorRow = creditRows.filter((r) => MAJOR_CATEGORIES.includes(r.category));
    majorMinimumCredits = majorRow.length > 0 ? sum(majorRow) : null;
    requirementsValue = {
      department,
      cohortYear: ctx.admissionYear,
      categories: creditRows.map((r) => ({ category: r.category, requiredCredits: Number(r.requiredCredits), description: r.description ?? null, requiredCourses: r.requiredCourses || [] })),
      // 편입생은 전적대학 인정학점 때문에 총량을 단정할 수 없다(TRANSFER_TOTAL_UNRESOLVED).
      totalRequiredCredits: ctx.enrollmentType === 'TRANSFER_ADMISSION' ? null : sum(creditRows),
      certifications: certRows.map((r) => ({ category: r.category, description: r.description ?? null, minCourseCount: r.minCourseCount, requiredCourses: r.requiredCourses || [] })),
      adjustments: built.adjustments,
    };
  }

  const reqBasis = ['BOOKLET_ROWS', ...relaxation.basis, ...liberal.basis];
  if (dataFlags.some((f) => f.code === 'COHORT_BEYOND_LATEST_DATA')) reqBasis.push('ACAD_ADDENDUM_2026_04_10_ART2_REORG_2027');
  if (ctx.admissionYear < 2026) {
    reqBasis.push('ENF_ART118_COHORT_TRANSITION', 'ACAD_ADDENDUM_2026_02_05_ART3');
    reqFlags.push(makeFlag('COHORT_TRANSITION_ADDENDUM_NOT_HELD'));
  }
  if (dependsOnArticleText(reqBasis)) reqFlags.push(...textFlags);

  const relaxBasis = relaxation.basis;
  const relaxFlags = [...eligibilityFlags, ...relaxation.flags, ...dataFlags.filter((f) => f.code === 'NO_CURRICULUM_ROWS' || f.code === 'DEPARTMENT_NOT_FOUND')];
  if (dependsOnArticleText(relaxBasis)) relaxFlags.push(...textFlags);
  if (requirementsValue && requirementsValue.adjustments.length === 0 && relaxation.relaxedRows) relaxFlags.push(makeFlag('MAJOR_RELAXATION_ROW_MISSING'));

  const libFlags = [...eligibilityFlags, ...liberal.flags];
  if (dependsOnArticleText(liberal.basis)) libFlags.push(...textFlags);
  const capFlags = [...eligibilityFlags, ...cap.flags];
  if (dependsOnArticleText(cap.basis)) capFlags.push(...textFlags);

  const liberalRows = requirementsValue ? requirementsValue.categories.filter((c) => LIBERAL_CATEGORIES.includes(c.category)) : [];

  const critical = [
    makeRule('REQUIREMENTS', RULE_LABELS.REQUIREMENTS, { value: requirementsValue, flags: reqFlags, basisKeys: reqBasis }),
    makeRule('MAJOR_MINIMUM', RULE_LABELS.MAJOR_MINIMUM, {
      value: dataFlags.length ? null : { mode: relaxation.mode, minimumCredits: majorMinimumCredits, transferGrade: relaxation.transferGrade ?? null },
      flags: relaxFlags,
      basisKeys: relaxBasis,
    }),
    makeRule('LIBERAL_ARTS_BASIS', RULE_LABELS.LIBERAL_ARTS_BASIS, {
      value: liberal.mode ? { mode: liberal.mode, trigger: liberal.trigger, requiredCredits: Object.fromEntries(liberalRows.map((c) => [c.category, c.requiredCredits])) } : null,
      flags: libFlags,
      basisKeys: liberal.basis,
      alternatives: liberalAlternatives,
    }),
    makeRule('LIBERAL_ARTS_CAP', RULE_LABELS.LIBERAL_ARTS_CAP, {
      value: { cap: cap.cap },
      flags: capFlags,
      basisKeys: cap.basis,
      alternatives: cap.alternatives,
    }),
  ];

  // --- 변경 이력(참고 정보 — 신뢰도 계산에서 제외) ---
  const revFlags = [];
  const history = data.history || null;
  const later = history ? Object.values(history).some((h) => h && h.laterChanges && h.laterChanges.length > 0) : false;
  if (later) revFlags.push(makeFlag('CURRICULUM_REVISION_AFTER_COHORT'));
  const informational = [
    makeRule('CURRICULUM_REVISIONS', RULE_LABELS.CURRICULUM_REVISIONS, {
      value: history,
      flags: revFlags,
      basisKeys: later ? ['ENF_ART13_TRANSITION'] : [],
      critical: false,
    }),
  ];

  return finalize(ctx, critical, informational);
}

const RULE_LABELS = {
  REQUIREMENTS: '졸업요건(카테고리별 이수학점)',
  MAJOR_MINIMUM: '전공 최소 이수학점',
  LIBERAL_ARTS_BASIS: '교양 이수기준 갈래',
  LIBERAL_ARTS_CAP: '교양 인정 상한',
  CURRICULUM_REVISIONS: '교육과정 변경 이력',
};

function finalize(ctx, criticalRules, informationalRules) {
  const rules = [...criticalRules, ...informationalRules];
  const flags = dedupeFlags(rules.flatMap((r) => r.flags));
  return {
    input: {
      admissionYear: ctx.admissionYear,
      enrollmentType: ctx.enrollmentType,
      departmentId: ctx.departmentId,
      departmentName: ctx.departmentName,
      trackId: ctx.trackId,
      asOfDate: ctx.asOfDate,
      asOfTerm: ctx.asOfTerm,
      majorChange: ctx.majorChange,
      transfer: ctx.transfer,
      restructuring: ctx.restructuring,
      policy: ctx.policy,
    },
    confidence: worstConfidence(criticalRules.map((r) => r.confidence)),
    rules,
    flags,
  };
}

module.exports = { evaluate, buildRequirementRows, rowAppliesToYear, hasCoreRowsForYear, RULE_LABELS };
