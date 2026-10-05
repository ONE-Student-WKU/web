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
};

function makeFlag(code, extra = {}) {
  const entry = FLAG_CATALOG[code];
  if (!entry) throw new Error(`알 수 없는 플래그 코드: ${code}`);
  return { code, level: entry[0], message: entry[1], ...extra };
}

/** 플래그 목록 → 가장 나쁜 level에 해당하는 신뢰도. 플래그가 없거나 INFO뿐이면 확정. */
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
