const { CONFIDENCE, CONFIDENCE_RANK, FLAG_LEVEL } = require('./constants');

/**
 * server/services/regulationEngine/flags.js
 * 판단 결과에 붙는 "플래그" 카탈로그와 신뢰도 도출.
 *
 * 왜 신뢰도를 직접 지정하지 않고 플래그에서 "도출"하는가: 규칙 코드가 `confidence: CONFIRMED`를 손으로 쓰게 두면,
 * 나중에 가정이 하나 추가돼도 그 줄을 고치는 걸 잊는 순간 추정이 확정처럼 나간다. 대신 규칙은 "이런 가정을 했다"는
 * 플래그만 남기고, 신뢰도는 플래그 중 가장 나쁜 level이 자동으로 정한다(플래그 없음 = 확정).
 * 모든 플래그는 아래 카탈로그에 코드·level·사용자용 한국어 문구가 있어야 한다(없는 코드를 쓰면 즉시 에러).
 */

const L = FLAG_LEVEL;

const FLAG_CATALOG = {
  // --- 입력 ---
  INVALID_INPUT: [L.NO_DATA, '입력값이 올바르지 않아 규정을 판단할 수 없어요.'],
  ASOF_BEFORE_ADMISSION: [L.NO_DATA, '기준일이 입학 이전이라 이 학생에게 적용되는 규정이 아직 없어요.'],
  ADMISSION_YEAR_UNSUPPORTED: [L.NO_DATA, '지원하는 학번 범위(2017학번~) 밖이라 확인된 자료가 없어요.'],
  DEPARTMENT_NOT_FOUND: [L.NO_DATA, '학과를 찾을 수 없어요.'],
  MAJOR_CHANGE_DATE_MISSING: [L.ESTIMATED, '전과 시점(연도·학기)이 없어 교양 이수기준을 "컷오프 이후"로 가정했어요. 시점이 2022학년도 2학기 이전이면 결과가 달라져요.'],
  MAJOR_CHANGE_GRADE_MISSING: [L.ESTIMATED, '전과한 학년이 없어 1·2학년 전과(전공 완화 없음)로 가정했어요. 3·4학년 전과라면 전공 기준이 완화돼요.'],
  MAJOR_CHANGE_BEFORE_ADMISSION: [L.NO_DATA, '전과 시점이 입학 이전으로 입력돼 판단할 수 없어요.'],
  ASOF_BEFORE_MAJOR_CHANGE: [L.NO_DATA, '기준일에는 아직 전과 전이라 그 시점의 (이전 학과) 규정은 입력 정보만으로 알 수 없어요.'],
  MAJOR_CHANGE_GRADE_VS_COHORT_MISMATCH: [L.ESTIMATED, '전과 시점으로 계산한 학년과 입력한 전과 학년이 달라요. 전과생은 "전과한 학년의 당초 입학자"와 같이 이수하므로(전과 안내), 본인 학번 기준이 맞는지 확인이 필요해요.'],
  TRANSFER_GRADE_ASSUMED: [L.ESTIMATED, '편입 학년을 몰라 3학년 편입(정원내 편입의 원칙)으로 가정했어요. 2학년 편입은 전공 완화가 없고 4학년 편입은 최소전공이 21학점이에요.'],
  TRANSFER_COHORT_YEAR_UNVERIFIED: [L.ESTIMATED, '편입생에게 어느 학번 기준 요건을 적용하는지(편입 연도 vs 편입 학년의 당초 입학자 학번)가 확인되지 않아, 입력한 학번을 그대로 사용했어요.'],
  TRANSFER_TOTAL_UNRESOLVED: [L.ESTIMATED, '편입생은 전적대학 인정학점이 있어 졸업에 필요한 총 학점을 단정할 수 없어요(전공 최소학점 등 개별 기준만 안내해요).'],
  RESTRUCTURING_DATE_MISSING: [L.NO_DATA, '"학사구조조정 시점" 해석으로 판단하려면 구조조정 시점(연도·학기)이 필요한데 입력되지 않았어요.'],

  // --- 데이터 ---
  COHORT_BEYOND_LATEST_DATA: [L.NO_DATA, '시스템이 보유한 최신 교육과정 자료(학년도) 이후의 학번이에요. 열린 범위의 행을 미래 학번에 그대로 적용하지 않았어요(2027학번부터 학과·계열 개편 예정 — 학칙 부칙 2026.04.10.).'],
  NO_CURRICULUM_ROWS: [L.NO_DATA, '이 학과·학번의 졸업요건 자료가 시스템에 없어요. 다른 학번이나 학과 자료로 대신 추정하지 않았어요.'],
  MAJOR_RELAXATION_ROW_MISSING: [L.ESTIMATED, '전공 최소학점 완화 기준이 이 학과·학번 자료에 없어, 일반 재학생 기준으로 계산했어요.'],

  // --- 규정 문서 버전(기준일) ---
  TEXT_VERSION_NOT_HELD: [L.ESTIMATED, '기준일 당시 시행 중이던 학칙·시행규칙 원문이 시스템에 없어요(보유 원문은 2026학년도 개정본 이후). 현행 조문으로 추정한 결과예요.'],
  TEXT_INTERMEDIATE_VERSION: [L.ESTIMATED, '기준일 이후에 학칙·시행규칙이 개정돼, 기준일 당시 조문이 현행 조문과 다를 수 있어요(중간 판본은 보유하지 않아요).'],
  TEXT_SNAPSHOT_MAY_BE_OLDER: [L.INFO, '보유한 학칙·시행규칙 원문은 2026-06-26 개정본이에요. 그 이후 개정이 있었는지는 확인되지 않았어요.'],

  // --- 해석 ---
  LIBERAL_CUTOFF_TRIGGER_AMBIGUOUS: [L.ESTIMATED, '교양 29학점 고정 기준은 책자에 "학사구조조정이 2022학년도 2학기 이전"으로 적혀 있는데, 앱은 이를 학생의 "전과 시점"으로 해석해요. 2022-2학기 이전 전과자에게 29학점이 적용된다는 실제 사례는 확인되지 않았어요(이후 전과자 사례만 확인).'],
  LIBERAL_CAP_PRE_2022_SINGLE_SOURCE: [L.ESTIMATED, '2021학번까지는 교양 인정 상한이 없다는 내용은 2026 책자 한 곳에서만 확인돼요(시행규칙 제10조 제1항은 학번 구분 없이 52학점 초과분 불인정). 학교 확인이 필요해요.'],
  LIBERAL_CAP_TRANSFER_EXEMPTION_UNVERIFIED: [L.ESTIMATED, '편입생에게 교양 52학점 상한이 적용되는지가 원문에서 확인되지 않아요(시행규칙 제10조 제1항에는 예외가 없고, 내부 문서는 비적용으로 추정).'],
  CURRICULUM_REVISION_AFTER_COHORT: [L.INFO, '이 학번 이후 교육과정이 개편됐어요. 개편된 신 교육과정은 재학생에게도 적용되지만 과목별 경과조치(필수→선택 변경·폐설 과목 이수 면제 등)가 있어, 개별 과목은 변경 이력과 학과 확인이 필요해요(시행규칙 제13조).'],
  COHORT_TRANSITION_ADDENDUM_NOT_HELD: [L.INFO, '학번별 경과조치의 근거인 종전(2025-08-29자) 학칙 부칙은 시스템에 없어요. 학번별 학점 기준은 해당 학년도 교육과정 책자 값을 사용했어요.'],
  TRANSFER_LIBERAL_DEEMED_MET: [L.ESTIMATED, '3·4학년 편입생은 "종교와 원불교"를 제외한 영역별 교양 이수기준을 충족한 것으로 봐요(시행규칙 제10조 제2항). 결과의 교양 학점은 일반 재학생 기준 참고값이에요.'],
  TRANSFER_4TH_YEAR_MAJOR_MINIMUM: [L.INFO, '4학년 편입생의 최소전공 인정학점은 학과와 무관하게 21학점이에요(교원양성과정 이수 편입생은 별도 기준).'],

  // --- 적용범위 판단(파트 2: resolveApplicableRules) ---
  APPLICABILITY_ESTIMATED: [L.ESTIMATED, '이 규정은 재량 규정("할 수 있다")이거나 해석이 갈려, 실제 적용 여부는 학과·학사지원과 확인이 필요해요.'],
  CURRICULUM_PROMULGATION_DATE_ASSUMED: [L.ESTIMATED, '교육과정 개편의 공포일 자료가 없어 그 학년도 시작일(3월 1일)부터 적용된다고 가정했어요. 기준일이 개편 학년도 1학기라 결과가 달라질 수 있어요.'],
  CATEGORY_NATURE_UNKNOWN: [L.ESTIMATED, '전공기초·전공심화·전공응용 같은 이수구분이 필수/선택 중 어디에 해당하는지 원문에 정의가 없어, 이 과목들에는 제13조②③을 판단하지 않았어요.'],
  TRANSITION_GRADE_BASIS_AMBIGUOUS: [L.ESTIMATED, '제13조③의 "재학 중인 학년"을 개편 시점 학년으로 볼지 기준일 학년으로 볼지에 따라 이수 여부가 갈리는 과목이 있어요(기본: 개편 시점 학년, 다른 해석은 대안으로 표시).'],
  GRADE_FROM_ADMISSION_YEAR: [L.ESTIMATED, '학년을 입학년도로 계산했어요(휴학·유급·조기졸업은 반영하지 않았어요).'],
  NEW_REQUIRED_COURSE_NOT_COVERED: [L.ESTIMATED, '입학 후 새로 생긴 필수과목은 제13조②③에 직접 규정이 없어(①은 신 교육과정을 전 학년에 적용) 이수해야 하는지 학과 확인이 필요해요.'],
  CATEGORY_YEAR_BOOK_ASSUMED: [L.ESTIMATED, '"수강신청한 학년도의 이수구분"을 그 학년도 교육과정(그 해 입학생 교육과정표)의 이수구분으로 봤어요.'],
  DEPARTMENT_REORG_CHANGE: [L.ESTIMATED, '학과 개편으로 생긴 과목 변경이 포함돼 있어요. 개편 때 기존 교육과정을 최대 4년 유지할 수 있어(시행규칙 제14조②) 실제 적용은 학과 운영에 따라 달라요.'],
  LINEAGE_NAME_MATCH: [L.ESTIMATED, '학과 개편 전후 연결이 이름 일치로 추정한 것이에요(책자·학칙에 명시된 연결이 아님).'],
  DEPARTMENT_IS_SUCCESSOR_OF_COHORT: [L.ESTIMATED, '입력한 학과는 입학 이후 개편으로 생긴 학과예요. 졸업요건은 입학 당시 학과 기준이에요(시행규칙 제5조) — 입학 당시 학과로 다시 조회하는 게 정확해요.'],
  EQUIVALENCE_LIST_NOT_HELD: [L.ESTIMATED, '동일과목 지정 목록(시행규칙 제15조) 자료가 없어, 바뀐 과목이 동일과목으로 인정되는지 확인할 수 없어요.'],
  SCHEDULE4_PRE_AMENDMENT_NOT_HELD: [L.ESTIMATED, '2026년 8월 이전에 졸업하면 개정 전 학칙 [별표 4]가 적용되는데, 개정 전 표는 시스템에 없어요.'],
  PRIOR_ADDENDUM_NOT_HELD: [L.NO_DATA, '종전(2025.08.29.자) 학칙 부칙의 경과조치 원문이 시스템에 없어 내용을 확인할 수 없어요.'],
  MAJOR_CHANGE_TARGET_NOT_ALLOWED_FOR_COHORT: [L.ESTIMATED, '이 학과로의 전과는 2026년 3월 1일 입학생부터 허용돼요(시행규칙 부칙 2026.02.05. 제2조). 입력한 학번·입학유형을 확인해 주세요.'],
  OFFERED_GRADE_FROM_NEAREST_SNAPSHOT: [L.ESTIMATED, '변경 후 교육과정에서 이 과목을 찾지 못해(학수번호 변경 등) 가장 가까운 학년도 편성표의 개설 학년을 썼어요.'],
  SCHEDULE4_CREDIT_MISMATCH: [L.ESTIMATED, '학칙 [별표 4]에 적힌 졸업학점과 교육과정 책자 기준 졸업학점이 서로 달라요. 어느 쪽이 이 학생에게 적용되는지 확인되지 않았어요(학칙은 2026.04.10. 개정, 2026년 8월 졸업자부터 적용) — 학과 또는 학사지원과 확인이 필요해요.'],
  APPLICABILITY_DATA_MISSING: [L.NO_DATA, '조문 적용범위 자료가 시스템에 없어 경과조치·적용범위를 판단하지 못했어요(관리자: seed:regulation-articles 실행 필요).'],
  REGISTRATION_CATEGORY_APPLIED: [L.ESTIMATED, '일부 과목의 이수구분을 수강한 학년도 기준으로 다시 봤어요(시행규칙 제13조④). 과목을 이름으로 찾고 그 해 입학생 교육과정표의 구분을 썼기 때문에 추정이에요 — 아래 과목은 입력한 구분과 달라 학점을 옮겨 계산했어요.'],
  REGISTRATION_CATEGORY_NOT_COMPARABLE: [L.INFO, '일부 과목은 수강한 학년도 교육과정에서 전공기초·전공심화 같은 구분으로 적혀 있어요. 이런 구분이 필수/선택 중 무엇인지 정해지지 않아 입력한 이수구분 그대로 합산했어요.'],
  OFFERED_GRADE_UNKNOWN: [L.INSUFFICIENT, '변경 후 교육과정에서 이 과목의 개설 학년을 찾지 못해 제13조③ 면제 여부를 판단하지 못했어요.'],

  // --- 데이터 검수 등급(DATA_AUDIT §4) ---
  HISTORY_NOT_VERIFIED: [L.INSUFFICIENT, '이 구간의 교육과정 자료가 검수 등급 C(미검증·오염 의심)라 "변경 없음"을 확인할 수 없어요 — 기록 없음(검증 안 됨).'],
  COURSE_DATA_GRADE_C: [L.INSUFFICIENT, '과목 판단에 쓴 교육과정 자료가 검수 등급 C(미검증·오염 의심)예요. 학과 확인이 필요해요.'],
  COURSE_DATA_GRADE_B: [L.ESTIMATED, '과목 판단에 쓴 교육과정 자료가 검수 등급 B(부분 검증)라 추정이에요.'],
  REQUIREMENT_DATA_GRADE_C: [L.INSUFFICIENT, '이 학번의 졸업요건 자료가 검수 등급 C(미검증)예요. 학과 확인이 필요해요.'],
  REQUIREMENT_DATA_GRADE_B: [L.ESTIMATED, '이 학번의 졸업요건 자료가 검수 등급 B(부분 검증)라 추정이에요.'],
  DATA_PENDING_HOLD: [L.ESTIMATED, '이 학과·학번 자료에 판단 보류 항목(이슈 #260, DATA_AUDIT)이 있어 값이 바뀔 수 있어요.'],
};

function makeFlag(code, extra = {}) {
  const entry = FLAG_CATALOG[code];
  if (!entry) throw new Error(`알 수 없는 플래그 코드: ${code}`);
  return { code, level: entry[0], message: entry[1], ...extra };
}

/** 플래그 목록 → 가장 나쁜 level에 해당하는 신뢰도. 플래그가 없거나 INFO뿐이면 확정. (level 이름 = 신뢰도 이름, INSUFFICIENT 포함) */
function confidenceFromFlags(flags) {
  let worst = CONFIDENCE.CONFIRMED;
  for (const f of flags) {
    const c = f.level === FLAG_LEVEL.INFO ? CONFIDENCE.CONFIRMED : f.level;
    if (CONFIDENCE_RANK[c] > CONFIDENCE_RANK[worst]) worst = c;
  }
  return worst;
}

/** 여러 규칙의 신뢰도 중 가장 나쁜 것. */
function worstConfidence(list) {
  return list.reduce((w, c) => (CONFIDENCE_RANK[c] > CONFIDENCE_RANK[w] ? c : w), CONFIDENCE.CONFIRMED);
}

/** 같은 code의 플래그를 한 번만 남긴다(규칙 여러 곳에서 같은 가정을 반복해 올릴 때). */
function dedupeFlags(flags) {
  const seen = new Set();
  return flags.filter((f) => (seen.has(f.code) ? false : (seen.add(f.code), true)));
}

module.exports = { FLAG_CATALOG, makeFlag, confidenceFromFlags, worstConfidence, dedupeFlags };
