const {
  LIBERAL_ARTS_CUTOFF,
  LIBERAL_ARTS_CREDIT_CAP,
  LIBERAL_ARTS_CAP_FIRST_COHORT,
  TRANSFER_4TH_YEAR_MAJOR_MINIMUM,
  DEFAULT_TRANSFER_GRADE,
  CITATIONS,
} = require('./constants');
const { makeFlag } = require('./flags');
const { termIndex } = require('./context');

/**
 * server/services/regulationEngine/decisions.js
 * "이 학생에게 어떤 갈래의 규정이 적용되나"를 정하는 순수 판정 함수들. 각 함수는
 *   { ...판정값, flags: [가정/불확실성], basis: [근거 키(constants.CITATIONS)] }
 * 를 돌려준다. 숫자 학점은 여기서 만들지 않는다(그건 책자 행 = 데이터의 몫) — 여기서는 "어느 행을 쓸지"만 정한다.
 * 이렇게 나누는 이유: 갈래 판정(조문 해석)과 학점 수치(책자 데이터)는 바뀌는 이유가 다르다. 개정이 생기면 이 파일의
 * 해석을 고치고, 새 학번 데이터는 시드만 고치면 된다.
 */

const FIRST_TERM_OF_ADMISSION = (admissionYear) => ({ year: admissionYear, semester: 1 });

/** 전과 시점이 입학 후 몇 번째 학기(0부터)인지. 전과는 "학기초"에 이뤄지므로 휴학이 없다면 floor(n/2)+1이 곧 전과 학년이다. */
function impliedMajorChangeGrade(ctx) {
  const { year, semester } = ctx.majorChange;
  const elapsed = termIndex({ year, semester }) - termIndex(FIRST_TERM_OF_ADMISSION(ctx.admissionYear));
  return { elapsed, grade: Math.floor(elapsed / 2) + 1 };
}

/**
 * 입력한 전과 학년이 가능한 범위인지. 휴학하면 전과 학년이 달력상 계산 학년보다 늦어질 수 있지만(최대 2년) 앞설 수는 없다.
 * 이 범위는 온보딩 화면(client/src/pages/Onboarding.jsx의 getMajorChangeGradeRange)이 선택지로 허용하는 범위와 같다 —
 * 화면이 허용한 값을 엔진이 "다르다"며 경고하던 어긋남(휴학한 전과생 대부분이 걸림)을 없애려고 맞췄다.
 * students에는 누적 휴학 학기 수만 있고 그 시기를 몰라서 휴학 값으로 학년을 역산하지 않고 범위로만 본다.
 */
function majorChangeGradeRange(implied) {
  return { min: Math.max(1, implied.grade - 2), max: Math.min(4, implied.grade) };
}

/**
 * 입학유형·입력 정합성 점검. 판단 자체를 못 하게 만드는 문제(NO_DATA)를 모아 돌려준다.
 */
function checkEligibility(ctx) {
  const flags = [];
  if (!ctx.supported) flags.push(makeFlag('ADMISSION_YEAR_UNSUPPORTED'));

  // 기준일이 입학 학기보다 앞서면 "그 시점의 학생"이 존재하지 않는다.
  const admissionTerm = FIRST_TERM_OF_ADMISSION(ctx.admissionYear);
  if (termIndex(ctx.asOfTerm) < termIndex(admissionTerm)) flags.push(makeFlag('ASOF_BEFORE_ADMISSION'));

  const mc = ctx.majorChange;
  if (mc && mc.year != null && mc.semester != null) {
    const changeIdx = termIndex({ year: mc.year, semester: mc.semester });
    if (changeIdx < termIndex(admissionTerm)) flags.push(makeFlag('MAJOR_CHANGE_BEFORE_ADMISSION'));
    // 기준일에는 아직 전과 전이었다면, 그때 적용되던 건 "이전 학과"의 규정인데 입력엔 이전 학과가 없다.
    else if (changeIdx > termIndex(ctx.asOfTerm)) flags.push(makeFlag('ASOF_BEFORE_MAJOR_CHANGE'));
  }
  return flags;
}

/**
 * 전공 최소학점 완화 여부(학칙시행규칙 제6조·제8조).
 *  - relaxedRows: true면 "전공" 통합 행(최소전공 인정학점)으로 전공필수/전공선택을 대체한다.
 *  - overrideMajorCredits: 학과 행 대신 쓸 고정 학점(4학년 편입 21학점).
 */
function decideMajorRelaxation(ctx) {
  const flags = [];
  const basis = [];

  if (ctx.enrollmentType === 'GENERAL') {
    basis.push('ENF_ART5_COHORT_BASIS');
    return { mode: 'FULL', relaxedRows: false, overrideMajorCredits: null, flags, basis };
  }

  if (ctx.enrollmentType === 'MAJOR_CHANGE') {
    const { grade } = ctx.majorChange;
    if (grade == null) {
      flags.push(makeFlag('MAJOR_CHANGE_GRADE_MISSING'));
      basis.push('ENF_ART8_2_EXCLUDED');
      return { mode: 'FULL', relaxedRows: false, overrideMajorCredits: null, flags, basis };
    }
    if (ctx.majorChange.year != null && ctx.majorChange.semester != null) {
      const implied = impliedMajorChangeGrade(ctx);
      const allowed = majorChangeGradeRange(implied);
      if (implied.elapsed >= 0 && (grade < allowed.min || grade > allowed.max)) {
        flags.push(makeFlag('MAJOR_CHANGE_GRADE_VS_COHORT_MISMATCH', { impliedGrade: implied.grade, inputGrade: grade, allowedMinGrade: allowed.min, allowedMaxGrade: allowed.max }));
      }
    }
    if (grade <= 2) {
      basis.push('ENF_ART8_2_EXCLUDED', 'ENF_ART116_MAJOR_CHANGE');
      return { mode: 'FULL', relaxedRows: false, overrideMajorCredits: null, flags, basis };
    }
    basis.push('ENF_ART8_1_RELAXATION', 'ENF_ART6_1_MIN_MAJOR', 'ENF_ART116_MAJOR_CHANGE');
    return { mode: 'RELAXED', relaxedRows: true, overrideMajorCredits: null, flags, basis };
  }

  // TRANSFER_ADMISSION — 편입 학년은 students에 저장되지 않으므로 보통 가정이 필요하다.
  let grade = ctx.transfer.grade;
  if (grade == null) {
    grade = DEFAULT_TRANSFER_GRADE;
    flags.push(makeFlag('TRANSFER_GRADE_ASSUMED'));
    basis.push('ACAD_ART36_2_TRANSFER_GRADE');
  }
  flags.push(makeFlag('TRANSFER_COHORT_YEAR_UNVERIFIED'), makeFlag('TRANSFER_TOTAL_UNRESOLVED'));
  if (grade === 2) {
    basis.push('ENF_ART8_2_EXCLUDED');
    return { mode: 'FULL', relaxedRows: false, overrideMajorCredits: null, flags, basis, transferGrade: grade };
  }
  if (grade === 4) {
    flags.push(makeFlag('TRANSFER_4TH_YEAR_MAJOR_MINIMUM'));
    basis.push('ENF_ART6_3_TRANSFER_4TH');
    return { mode: 'TRANSFER_4TH', relaxedRows: true, overrideMajorCredits: TRANSFER_4TH_YEAR_MAJOR_MINIMUM, flags, basis, transferGrade: grade };
  }
  basis.push('ENF_ART8_1_RELAXATION', 'ENF_ART6_1_MIN_MAJOR');
  return { mode: 'RELAXED', relaxedRows: true, overrideMajorCredits: null, flags, basis, transferGrade: grade };
}

/** 학기 (year, semester)가 컷오프(2022-2) "이전"인가. 2022-2학기 자체는 이전이 아니다(파트 3 이전 graduationService와 같은 경계). */
function isBeforeLiberalArtsCutoff({ year, semester }) {
  if (year !== LIBERAL_ARTS_CUTOFF.year) return year < LIBERAL_ARTS_CUTOFF.year;
  return semester < LIBERAL_ARTS_CUTOFF.semester;
}

/**
 * 교양 이수기준의 갈래: 학번별 표(COHORT_TABLE) vs 29학점 고정(FIXED_29).
 *
 * 해석 선택(policy.liberalArtsCutoffTrigger) — 책자 문구와 학교 전과 안내가 서로 다른 "시점"을 말해서 둘 다 구조로 지원한다:
 *  - MAJOR_CHANGE_DATE(기본): 학생의 "전과 시점"이 2022-2 이전이면 29학점. 학교 전과 안내(10항)가 "2022-1학기 전과생까지
 *    교양필수 5 + 교양선택 24, 2022-2학기 전과생부터 새 기준"이라고 전과한 시점을 기준으로 적고 있어 확정이다(D-52).
 *  - RESTRUCTURING_DATE: 책자 문구 그대로 "학사구조조정이 이루어진 시점"이 2022-2 이전이면 29학점. 구조조정 시점 입력이 필요하고
 *    학교 전과 안내와 달라질 수 있어, 이 해석으로 29학점 갈래가 나올 때만 LIBERAL_CUTOFF_TRIGGER_AMBIGUOUS 플래그(추정)를 붙인다.
 */
function decideLiberalArtsBasis(ctx, triggerOverride) {
  const flags = [];
  const basis = [];
  const trigger = triggerOverride || ctx.policy.liberalArtsCutoffTrigger;

  if (ctx.enrollmentType === 'GENERAL') {
    basis.push('BOOKLET_ROWS');
    return { mode: 'COHORT_TABLE', trigger: null, flags, basis };
  }

  if (ctx.enrollmentType === 'TRANSFER_ADMISSION') {
    // 시행규칙 제10조②: 3·4학년 편입생은 영역별 교양 기준을 충족한 것으로 본다. 학점표 자체는 참고값으로만 유지.
    basis.push('BOOKLET_ROWS', 'ENF_ART10_2_TRANSFER_LIBERAL');
    flags.push(makeFlag('TRANSFER_LIBERAL_DEEMED_MET'));
    return { mode: 'COHORT_TABLE', trigger: null, flags, basis };
  }

  // MAJOR_CHANGE
  basis.push('ENF_ART116_MAJOR_CHANGE');
  let point;
  if (trigger === 'RESTRUCTURING_DATE') {
    point = ctx.restructuring;
    if (!point) {
      flags.push(makeFlag('RESTRUCTURING_DATE_MISSING'));
      return { mode: null, trigger, flags, basis };
    }
  } else {
    const { year, semester } = ctx.majorChange;
    if (year == null || semester == null) {
      flags.push(makeFlag('MAJOR_CHANGE_DATE_MISSING'));
      basis.push('BOOKLET_ROWS');
      return { mode: 'COHORT_TABLE', trigger, flags, basis };
    }
    point = { year, semester };
  }

  if (isBeforeLiberalArtsCutoff(point)) {
    basis.push('BOOKLET_2026_RESTRUCTURING_LIBERAL');
    if (trigger === 'MAJOR_CHANGE_DATE') basis.push('SITE_MAJOR_CHANGE_LIBERAL_CUTOFF');
    else flags.push(makeFlag('LIBERAL_CUTOFF_TRIGGER_AMBIGUOUS'));
    return { mode: 'FIXED_29', trigger, flags, basis };
  }
  basis.push('BOOKLET_ROWS');
  if (trigger === 'MAJOR_CHANGE_DATE') basis.push('CASE_MAJOR_CHANGE_AFTER_CUTOFF', 'SITE_MAJOR_CHANGE_LIBERAL_CUTOFF');
  else flags.push(makeFlag('LIBERAL_CUTOFF_TRIGGER_AMBIGUOUS'));
  return { mode: 'COHORT_TABLE', trigger, flags, basis };
}

/**
 * 교양 인정 상한. 학교 홈페이지(학사학위수여)와 2026 책자가 모두 "2022년 3월 1일 입학자부터 52학점 초과분 불인정(2021학번까지는
 * 제한 없음)"이라고 적는다. 시행규칙 제10조①은 학번 구분 없이 52학점 초과분 불인정이라고만 쓰여 있고 입학 시점 제한이 없지만,
 * 학교가 직접 공지하는 두 곳이 일치하므로 2021학번 이하는 상한 없음(cap: null)으로 판단한다(D-51). 이 판단은 졸업진단도
 * 그대로 따른다(예전에는 근거가 책자 한 곳이라 진단만 52를 썼다 — D-32). 조문 문언과의 차이는 INFO 플래그로 남긴다.
 */
function decideLiberalArtsCap(ctx) {
  const flags = [];
  const basis = ['ENF_ART10_1_LIBERAL_CAP'];
  let cap = LIBERAL_ARTS_CREDIT_CAP;
  const alternatives = [];

  if (ctx.admissionYear < LIBERAL_ARTS_CAP_FIRST_COHORT) {
    cap = null;
    basis.push('BOOKLET_2026_LIBERAL_CAP', 'SITE_GRADUATION_LIBERAL_CAP');
    flags.push(makeFlag('LIBERAL_CAP_PRE_2022_ARTICLE_SILENT'));
  } else {
    basis.push('BOOKLET_2026_LIBERAL_CAP', 'SITE_GRADUATION_LIBERAL_CAP');
  }
  if (ctx.enrollmentType === 'TRANSFER_ADMISSION') flags.push(makeFlag('LIBERAL_CAP_TRANSFER_EXEMPTION_UNVERIFIED'));
  return { cap, flags, basis, alternatives };
}

/** basis 키 목록 → 직렬화 가능한 근거 객체(미등록 키는 즉시 에러 — 오타로 근거가 사라지는 걸 막는다). */
function resolveBasis(keys) {
  return [...new Set(keys)].map((k) => {
    const c = CITATIONS[k];
    if (!c) throw new Error(`등록되지 않은 근거 키: ${k}`);
    const { file, quote, ...rest } = c; // eslint-disable-line no-unused-vars -- quote/file은 검증용이라 결과엔 싣지 않는다
    return { key: k, ...rest };
  });
}

module.exports = {
  checkEligibility,
  decideMajorRelaxation,
  decideLiberalArtsBasis,
  decideLiberalArtsCap,
  isBeforeLiberalArtsCutoff,
  impliedMajorChangeGrade,
  resolveBasis,
};
