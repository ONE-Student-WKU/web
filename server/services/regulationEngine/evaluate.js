const { LIBERAL_ARTS_FIXED_CREDITS, NON_DEGREE_DEPARTMENTS, BYLAW_MAJOR_DEPARTMENTS, REGULATION_MIN_MAJOR_BY_DEPARTMENT, GENERIC_CERTIFICATION_COURSE_SETS, LATEST_BOOKLET_YEAR } = require('./constants');
const { makeFlag, confidenceFromFlags, worstConfidence, dedupeFlags } = require('./flags');
const {
  checkEligibility,
  decideMajorRelaxation,
  decideLiberalArtsBasis,
  decideLiberalArtsCap,
  resolveBasis,
  transferRecognizedCredits,
} = require('./decisions');
const { basisTextFlags } = require('./textVersion');

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
function buildRequirementRows(ctx, allYearRows, relaxation, liberal, departmentName = null) {
  const flags = [];
  const adjustments = [];
  const basis = [];
  let resolvedTransferTotal = false;
  const generalRows = allYearRows.filter((r) => r.enrollmentType == null);
  let rows = generalRows;

  // 완화 행으로 바꿀 때는 일반 학생의 전공 행을 전부 뺀다. 건축학과(~2024)·의약계열처럼 일반 학생 전공이 "전필/전선"이 아니라
  // 통합 "전공" 행인 학과에서 그 행을 남겨 두면 "전공 127 + 전공 66"처럼 전공 요건이 두 번 잡혔다(GRADUATION_AUDIT_2026-10-12 6절).
  const withoutMajorRows = generalRows.filter((r) => !MAJOR_CATEGORIES.includes(r.category));
  if (relaxation.relaxedRows) {
    const overrideRows = allYearRows.filter((r) => r.enrollmentType === ctx.enrollmentType);
    if (overrideRows.length > 0) {
      rows = [...withoutMajorRows, ...overrideRows];
      adjustments.push('MAJOR_RELAXATION');
    } else if (relaxation.overrideMajorCredits != null) {
      rows = [...withoutMajorRows,
        { id: null, category: '전공', requiredCredits: relaxation.overrideMajorCredits, description: '4학년 편입생 최소전공 인정학점(학칙시행규칙 제6조 제3항)', enrollmentType: ctx.enrollmentType, minCourseCount: null, requiredCourses: [] }];
      adjustments.push('MAJOR_RELAXATION');
    } else if (REGULATION_MIN_MAJOR_BY_DEPARTMENT[departmentName] != null) {
      // 책자에 숫자가 없어도 조문에 학과 이름으로 적힌 최소전공이 있으면 그 값을 쓴다(2025학번 건축학과 — 2025 책자는 "교육과정
      // 전공이수학점에 따라 이수"로만 적음). 예전에는 완화 없이 전액 요구(MAJOR_RELAXATION_ROW_MISSING)로 계산했다.
      rows = [...withoutMajorRows,
        { id: null, category: '전공', requiredCredits: REGULATION_MIN_MAJOR_BY_DEPARTMENT[departmentName], description: `${departmentName} 최소전공 인정학점(학칙시행규칙 제6조 제1항 — 책자에 숫자 없음)`, enrollmentType: ctx.enrollmentType, minCourseCount: null, requiredCourses: [] }];
      flags.push(makeFlag('MAJOR_MINIMUM_FROM_REGULATION', { departmentName }));
      basis.push('ENF_ART6_1_ARCHITECTURE');
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
    // 학번표 교양이 29보다 적은 학번(2017~2021학번 다수, 23~27학점)에도 29를 요구한다 — 컴퓨터·소프트웨어공학과 졸업요건 공지가
    // 학번표 23학점인 학번의 2·3학년 전과생에게 "교양필수 5 + 교양 24"를 적고 있다(SOURCE_VERIFICATION_2026-10-12 3절). 알림(INFO)만 남긴다.
    const cohortLiberal = sum(rows.filter((r) => LIBERAL_CATEGORIES.includes(r.category)));
    const fixedLiberal = Object.values(LIBERAL_ARTS_FIXED_CREDITS).reduce((s, v) => s + v, 0);
    if (cohortLiberal < fixedLiberal) flags.push(makeFlag('LIBERAL_FIXED_29_ABOVE_COHORT', { cohortLiberal, fixedLiberal }));
    rows = rows.map((r) => (LIBERAL_ARTS_FIXED_CREDITS[r.category] === undefined ? r : { ...r, requiredCredits: LIBERAL_ARTS_FIXED_CREDITS[r.category] }));
    adjustments.push('LIBERAL_FIXED_29');
  }

  // 일반선택 재배분: "완화 = 총 졸업학점 감소"가 아니라 "전공·교양 최소 기준만 채우면 나머지는 자유"이므로,
  // 비는 만큼을 일반선택이 흡수해 총 요구학점이 일반 재학생(같은 학번)과 같게 유지된다. 편입생은 전적대학 인정학점이
  // 껴 있어 이 원리가 그대로 안 맞으므로(총량 미해결) 적용하지 않는다.
  // 교양 29학점 고정이 요구를 올려 일반선택이 모자라면(간호·작업치료·예과처럼 일반선택이 0인 학과) 음수 요건 대신 0으로 두고,
  // 그만큼 총 요구학점이 일반 재학생보다 늘어난 것으로 보인다.
  if (ctx.enrollmentType === 'MAJOR_CHANGE' && adjustments.length > 0) {
    const totalDegreeCredits = sum(generalRows);
    const adjusted = totalDegreeCredits - sum(rows.filter((r) => MAJOR_CATEGORIES.includes(r.category))) - sum(rows.filter((r) => LIBERAL_CATEGORIES.includes(r.category)));
    rows = rows.map((r) => (r.category === '일반선택' ? { ...r, requiredCredits: Math.max(0, adjusted) } : r));
    adjustments.push('GENERAL_ELECTIVE_REBALANCE');
  }

  // 3·4학년 편입생(시행규칙 제10조②): 교양 영역 기준은 충족한 것으로 보고 "종교와원불교"만 따로 확인한다. 본교에서 들은 교양 학점은
  // 일반선택(자유선택)으로 센다(graduationService.computeCreditStatus). 예전에는 일반 학생의 교양 39학점을 그대로 요구했다.
  if (liberal.mode === 'TRANSFER_DEEMED') {
    rows = [...rows.filter((r) => !LIBERAL_CATEGORIES.includes(r.category)),
      { id: null, category: '종교와원불교', requiredCredits: 0, description: '편입생 교양: "종교와원불교" 필수 이수(본교·원광보건대학교를 졸업한 편입생은 제외 — 학교 편입생 교육과정 안내, 시행규칙 제10조 제2항)', enrollmentType: ctx.enrollmentType, minCourseCount: 1, requiredCourses: ['종교와원불교'] }];
    adjustments.push('TRANSFER_LIBERAL_DEEMED');

    // 총량: 졸업학점 − 편입 인정학점 = 본교에서 이수할 학점. 그중 전공 최소학점을 뺀 나머지를 일반선택으로 둔다.
    // 전공 완화 행이 있을 때만 계산한다 — 완화 행이 없는 학과(의약계열 등)는 "학과의 전공이수학점에 따른다"라 전적대학 학점이 전공에 얼마나
    // 인정되는지 알 수 없어 총량을 단정하지 않는다.
    const graduationCredits = sum(generalRows.filter((r) => r.minCourseCount == null));
    const recognized = adjustments.includes('MAJOR_RELAXATION') ? transferRecognizedCredits(departmentName, ctx.admissionYear, graduationCredits) : null;
    if (recognized != null) {
      const majorCredits = sum(rows.filter((r) => MAJOR_CATEGORIES.includes(r.category)));
      const elective = Math.max(0, graduationCredits - recognized - majorCredits);
      const electiveRow = { id: null, category: '일반선택', requiredCredits: elective, description: `편입생 자유선택: 졸업학점 ${graduationCredits} − 편입 인정학점 ${recognized} − 전공 ${majorCredits}`, enrollmentType: ctx.enrollmentType, minCourseCount: null, requiredCourses: [] };
      rows = rows.some((r) => r.category === '일반선택') ? rows.map((r) => (r.category === '일반선택' ? electiveRow : r)) : [...rows, electiveRow];
      flags.push(makeFlag('TRANSFER_RECOGNIZED_CREDITS_ASSUMED', { graduationCredits, recognized }));
      basis.push('SITE_TRANSFER_RECOGNIZED_CREDITS');
      adjustments.push('TRANSFER_RECOGNIZED_CREDITS');
      resolvedTransferTotal = true;
    }
  }

  return { rows, adjustments, flags, basis, resolvedTransferTotal };
}

// 졸업인증제 행이 대학 공통 기본영역 묶음(constants.GENERIC_CERTIFICATION_COURSE_SETS)과 같은가. 학과 지정 과목(컴소공 기업연계프로젝트1·2 등)은 아니다.
function isGenericCertificationRow(row) {
  if (row.category !== '졸업인증제') return false;
  const key = [...(row.requiredCourses || [])].sort().join('|');
  return GENERIC_CERTIFICATION_COURSE_SETS.some((set) => [...set].sort().join('|') === key);
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
  // 조문별 판본 판단(textVersion.js, D-42): 근거로 쓴 조문마다 기준일 당시 문구를 갖고 있는지 본다. data.textVersions는 DB 판본·조문 정보(없으면 상수로 대체).
  const textFlagsFor = (basisKeys) => basisTextFlags(ctx.asOfDate, basisKeys, data && data.textVersions);

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
  // 1학년 과정만 운영하고 학과를 배정받는 단위(자율전공학부)는 시드에 1학년 이수 기준 행이 있어도 졸업요건이 아니다 —
  // 그 행으로 진단하면 46~48학점에 "졸업요건 충족"이 나왔다(GRADUATION_AUDIT_2026-10-12 3절).
  else if (NON_DEGREE_DEPARTMENTS.includes(department.name)) dataFlags.push(makeFlag('NON_DEGREE_DEPARTMENT'));
  // 상한이 열린 행(max=NULL)은 "그 이후 개편이 확인될 때까지 유효"라는 뜻이지 미래 학번에 대한 확인이 아니다. 시스템이 아는
  // 가장 최신 학년도보다 뒤의 학번에는 외삽하지 않는다.
  else if (data.latestDataYear != null && ctx.admissionYear > data.latestDataYear) {
    dataFlags.push(makeFlag('COHORT_BEYOND_LATEST_DATA', { latestDataYear: data.latestDataYear }));
  } else if (!hasCoreRowsForYear(yearRows, ctx.admissionYear)) dataFlags.push(makeFlag('NO_CURRICULUM_ROWS', { candidates: data.candidates || [] }));

  let reqFlags = [...eligibilityFlags, ...dataFlags, ...relaxation.flags, ...liberal.flags];
  let built = null;
  if (dataFlags.length === 0) {
    built = buildRequirementRows(ctx, yearRows, relaxation, liberal, department.name);
    reqFlags.push(...built.flags);
    // 편입 인정학점으로 총량을 계산했으면 "총량 미해결"은 더 이상 사실이 아니다(인정학점 가정은 TRANSFER_RECOGNIZED_CREDITS_ASSUMED가 알린다).
    if (built.resolvedTransferTotal) reqFlags = reqFlags.filter((f) => f.code !== 'TRANSFER_TOTAL_UNRESOLVED');
    const creditRows = orderCategories(built.rows.filter((r) => r.minCourseCount == null));
    const certRows = built.rows.filter((r) => r.minCourseCount != null);
    const majorRow = creditRows.filter((r) => MAJOR_CATEGORIES.includes(r.category));
    majorMinimumCredits = majorRow.length > 0 ? sum(majorRow) : null;
    requirementsValue = {
      department,
      cohortYear: ctx.admissionYear,
      categories: creditRows.map((r) => ({ category: r.category, requiredCredits: Number(r.requiredCredits), description: r.description ?? null, requiredCourses: r.requiredCourses || [] })),
      // 편입생은 인정학점을 정할 수 있을 때만 총량을 낸다(본교에서 이수할 학점). 못 정하면 null(TRANSFER_TOTAL_UNRESOLVED).
      totalRequiredCredits: ctx.enrollmentType === 'TRANSFER_ADMISSION' && !built.resolvedTransferTotal ? null : sum(creditRows),
      certifications: certRows.map((r) => ({
        category: r.category, description: r.description ?? null, minCourseCount: r.minCourseCount, requiredCourses: r.requiredCourses || [],
        // 대학 공통 기본영역 행은 학사편입학자 등이 면제다. 편입 종류(학사편입/일반편입)는 입력받지 않으므로 면제로 빼지 않고 안내만 붙인다.
        ...(ctx.enrollmentType === 'TRANSFER_ADMISSION' && isGenericCertificationRow(r) ? { conditionalExemption: 'BACHELOR_TRANSFER' } : {}),
      })),
      adjustments: built.adjustments,
    };
  }

  const reqBasis = ['BOOKLET_ROWS', ...relaxation.basis, ...liberal.basis, ...(built ? built.basis : [])];
  const certExemption = requirementsValue && requirementsValue.certifications.some((c) => c.conditionalExemption);
  if (certExemption) {
    reqBasis.push('SITE_CERTIFICATION_BACHELOR_TRANSFER_EXEMPT');
    reqFlags.push(makeFlag('CERTIFICATION_BACHELOR_TRANSFER_EXEMPT'));
  }
  if (dataFlags.some((f) => f.code === 'COHORT_BEYOND_LATEST_DATA')) reqBasis.push('ACAD_ADDENDUM_2026_04_10_ART2_REORG_2027');
  if (ctx.admissionYear < LATEST_BOOKLET_YEAR) {
    reqBasis.push('ENF_ART118_COHORT_TRANSITION', 'ACAD_ADDENDUM_2026_02_05_ART3');
    reqFlags.push(makeFlag('COHORT_TRANSITION_ADDENDUM_NOT_HELD'));
    // 2025학번 이하의 행은 "그 해 책자"가 아니라 최신 책자의 학번별 이수기준표 값이다(constants.LATEST_BOOKLET_YEAR 주석).
    // 요건을 실제로 냈을 때만 알린다 — 자료가 없으면(NO_DATA) 어느 표도 쓰지 않았다.
    if (built) {
      reqBasis.push('BOOKLET_2026_TRANSITION_ALL_COHORTS', 'BOOKLET_2026_COHORT_TABLES');
      reqFlags.push(makeFlag('LATEST_BOOKLET_COHORT_TABLE', { latestBookletYear: LATEST_BOOKLET_YEAR }));
      // 최신 책자에 학과 단위 행이 없는 학과(통폐합·개편으로 사라진 이름)는 과목 편성이 구 교육과정으로 남을 수 있다(경과조치 가 단서).
      // 학번 범위가 열린 보조 행(교직기본이수·전과/편입 완화·졸업논문)만으로 "최신 책자에 있음"으로 보지 않게 핵심 요건 행으로 판정한다.
      if (!hasCoreRowsForYear(data.rows || [], LATEST_BOOKLET_YEAR)) reqFlags.push(makeFlag('DEPARTMENT_ABSENT_IN_LATEST_BOOKLET', { latestBookletYear: LATEST_BOOKLET_YEAR }));
    }
  }
  // 학과 내규로 전공 과목을 정하는 학과(constants.BYLAW_MAJOR_DEPARTMENTS) — 숫자는 그대로 두고 학과 확인 안내만 붙인다.
  if (built && department && BYLAW_MAJOR_DEPARTMENTS.includes(department.name)) reqFlags.push(makeFlag('DEPARTMENT_BYLAW_MAJOR'));
  reqFlags.push(...textFlagsFor(reqBasis));

  const fromRegulation = built ? built.flags.filter((f) => f.code === 'MAJOR_MINIMUM_FROM_REGULATION') : [];
  const relaxBasis = [...relaxation.basis, ...(fromRegulation.length ? ['ENF_ART6_1_ARCHITECTURE'] : [])];
  const relaxFlags = [...eligibilityFlags, ...relaxation.flags, ...fromRegulation, ...dataFlags.filter((f) => f.code === 'NO_CURRICULUM_ROWS' || f.code === 'DEPARTMENT_NOT_FOUND')]
    .filter((f) => !(built && built.resolvedTransferTotal && f.code === 'TRANSFER_TOTAL_UNRESOLVED'));
  relaxFlags.push(...textFlagsFor(relaxBasis));
  if (requirementsValue && !requirementsValue.adjustments.includes('MAJOR_RELAXATION') && relaxation.relaxedRows) relaxFlags.push(makeFlag('MAJOR_RELAXATION_ROW_MISSING'));

  const libFlags = [...eligibilityFlags, ...liberal.flags];
  libFlags.push(...textFlagsFor(liberal.basis));
  const capFlags = [...eligibilityFlags, ...cap.flags];
  capFlags.push(...textFlagsFor(cap.basis));

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
