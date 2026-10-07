import { pickJosa } from './korean.js';

/**
 * client/src/utils/graduation.js
 * getGraduationStatus() 응답(categories/certifications)에서 "부족 요건" 문구를 조립.
 * Home.jsx의 요약 카드와 GraduationStatus.jsx의 요약 박스가 동일 로직을 공유한다.
 */
const MAJOR_REQUIRED_KEY = '전공필수';
const MAJOR_ELECTIVE_KEY = '전공선택';
const MAJOR_MERGED_KEY = '전공';

// DB category ENUM 값('전공필수' 등)은 졸업요건 계산 로직이 그대로 참조하므로 못 바꾼다.
// 다만 화면 표시는 이 진단 화면이 원래 쓰던 "기본전공"으로 앱 전체에서 통일한다 — 같은
// 값을 화면마다 "전공필수"/"기본전공"으로 다르게 불러서 헷갈린다는 실사용 피드백 반영.
// Home/GraduationStatus의 부족 요건 문구, CourseManagement의 과목 목록·입력 폼이 공유.
const CATEGORY_DISPLAY_LABEL = { [MAJOR_REQUIRED_KEY]: '기본전공' };
export const displayCategory = (category) => CATEGORY_DISPLAY_LABEL[category] || category;

// summarizeShortfalls용 — 전공필수/전공선택을 "전공" 하나로 합쳐서, 기본전공(전공필수)을
// 초과 이수했을 때 그 초과분이 전공선택 부족분을 상쇄하도록 한다(실사용 피드백: 기본전공
// 137%인데 전공선택 부족 문구는 그대로 남아있었음 — 두 카테고리를 따로 계산해서 생긴 문제).
// 카드 상세 표시(기본전공 충족 여부 등)는 buildRequirementGroups가 따로 맡는다.
export function mergeMajorCategories(categories) {
  if (!categories) return categories;
  const required = categories.find((c) => c.category === MAJOR_REQUIRED_KEY);
  const elective = categories.find((c) => c.category === MAJOR_ELECTIVE_KEY);
  if (!required || !elective) return categories;

  const merged = {
    category: MAJOR_MERGED_KEY,
    earnedCredits: required.earnedCredits + elective.earnedCredits,
    requiredCredits: required.requiredCredits + elective.requiredCredits,
  };

  return categories
    .map((c) => (c.category === MAJOR_REQUIRED_KEY ? merged : c))
    .filter((c) => c.category !== MAJOR_ELECTIVE_KEY);
}

// 졸업요건 진단 상세 화면 전용 — 전공/교양 두 그룹으로만 헤드라인 숫자를 보여준다.
// 기본전공(전공필수)·교양필수처럼 "특정 과목을 반드시 들어야 하는" 항목은 숫자 대신
// 충족 여부만 표기하고, 전공선택·교양선택처럼 "그냥 많이 채우면 되는" 항목은 이수량만
// 참고로 보여준다. 일반선택은 전공도 교양도 아니라 여기 포함하지 않음 — 실제로는 전공
// 초과이수분이 자동으로 채워지는 항목이라(graduationService.js의 generalElectiveOverflow)
// "22학점"처럼 목표로 보이는 숫자를 어느 카드에든 올리면 "이것도 따로 채워야 하나?"는
// 오해가 생긴다는 실사용 피드백 반영 — GraduationStatus.jsx가 status.categories에서 직접
// 찾아 "전체 이수학점" 카드 쪽 참고 문구로만 붙인다.
export function buildRequirementGroups(categories) {
  if (!categories) return null;
  const find = (name) => categories.find((c) => c.category === name);

  // 전과(3·4학년)/편입생은 전공필수+전공선택 대신 완화된 통합 "전공"(48학점) 행 하나로
  // 내려온다(graduationService.js의 selectRequirementRows) — 이 경우 전공필수/전공선택을
  // 찾으면 둘 다 없어서 major가 null이 되어 카드 자체가 안 보이는 문제가 있었다(실사용 확인).
  const majorRequired = find(MAJOR_REQUIRED_KEY);
  const majorElective = find(MAJOR_ELECTIVE_KEY);
  const majorMerged = find(MAJOR_MERGED_KEY);
  const major =
    majorRequired && majorElective
      ? {
          earnedCredits: majorRequired.earnedCredits + majorElective.earnedCredits,
          requiredCredits: majorRequired.requiredCredits + majorElective.requiredCredits,
          baseSatisfied: majorRequired.earnedCredits >= majorRequired.requiredCredits,
        }
      : majorMerged
        ? {
            earnedCredits: majorMerged.earnedCredits,
            requiredCredits: majorMerged.requiredCredits,
            // 완화 요건은 기본전공/전공선택 구분이 없는 통합 학점이라 별도 충족 배지를 안 둔다.
            baseSatisfied: null,
          }
        : null;

  const liberalRequired = find('교양필수');
  const liberalElective = find('교양선택');
  const liberalArts =
    liberalRequired && liberalElective
      ? {
          earnedCredits: liberalRequired.earnedCredits + liberalElective.earnedCredits,
          requiredCredits: liberalRequired.requiredCredits + liberalElective.requiredCredits,
          requiredSatisfied: liberalRequired.earnedCredits >= liberalRequired.requiredCredits,
          electiveEarnedCredits: liberalElective.earnedCredits,
        }
      : null;

  return { major, liberalArts };
}

// 진행률 바를 파랑 한 가지로만 두지 말고 퍼센트가 오를수록 색이 자연스럽게 바뀌게 해서
// 재미를 주자는 요청 — 노랑(0%)에서 초록(100%)으로 이어지게 했다(보라 시작은 어색하다는
// 피드백으로 노랑으로 교체). 100%에서 기존 "충족" 초록(--color-success, hsl(122, 39%, 59%))과
// 거의 같은 색에 자연스럽게 도달한다.
// 요구학점이 0이면 0으로 나누어 NaN%·Infinity%가 되므로 0%로 돌려준다(진행률 막대용).
export function getPercent(earned, required) {
  if (!(required > 0)) return 0;
  return Math.min(100, Math.round((earned / required) * 100));
}

export function getProgressColor(percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  const hue = 50 + (70 * clamped) / 100;
  return `hsl(${hue}, 70%, 50%)`;
}

export function summarizeShortfalls(categories, certifications) {
  const items = [];

  for (const c of categories || []) {
    // 일반선택은 전공/교양 초과 이수분이 자동으로 채워지는 항목이라(graduationService.js의
    // generalElectiveOverflow) 학생이 따로 챙겨 들어야 하는 목표가 아니다 — buildRequirementGroups
    // 카드에서 이미 제외하고 있는데 이 요약 문구에서는 빠져서 "일반선택 22학점 부족해요"처럼
    // 오해를 주는 문제가 있었다(실사용 확인).
    if (c.category === '일반선택') continue;
    const missing = c.requiredCredits - c.earnedCredits;
    if (missing > 0) items.push(`${displayCategory(c.category)} ${missing}학점`);
  }

  for (const cert of certifications || []) {
    if (!cert.satisfied) items.push(cert.category);
  }

  return items;
}

// summarizeShortfalls 결과를 "OO, OO가 부족해요." 문장으로 조립 — 마지막 항목의 받침 유무에
// 맞춰 이/가를 고른다(항상 "이"로 고정하면 "졸업인증제이 부족해요"처럼 어색해짐).
export function formatShortfallSentence(shortfalls) {
  if (!shortfalls || shortfalls.length === 0) return null;
  const last = shortfalls[shortfalls.length - 1];
  return `${shortfalls.join(', ')}${pickJosa(last, ['이', '가'])} 부족해요.`;
}

// ---------------------------------------------------------------------------
// 졸업요건 근거 신뢰도 표시 (보정 라운드 A 2-6, DECISIONS D-39)
//
// 서버(getGraduationStatus)가 규정 판단 엔진의 결과를 status.regulation으로 내려준다: confidence(확정/추정/자료 불충분/자료없음),
// flags(사유), totalDefinitive(편입생 총량 확정 여부), schedule4(학칙 [별표 4]와 책자 졸업학점이 다를 때의 두 값).
// 화면은 이 값을 "작게" 보여 주기만 한다 — 숫자를 바꾸거나 판단하지 않는다.
// ---------------------------------------------------------------------------

const TRUST_LABEL = { CONFIRMED: '확정', ESTIMATED: '추정', INSUFFICIENT: '자료 불충분', NO_DATA: '자료 없음' };
const FLAG_SEVERITY = { NO_DATA: 3, INSUFFICIENT: 2, ESTIMATED: 1 };

// 사유 한 줄: 가장 심각한 level의 플래그 하나. 학칙 [별표 4] 불일치는 학생에게 가장 쓸모 있는 정보(두 값)로 바꿔 말한다.
function pickTrustReason(regulation) {
  const s4 = regulation.schedule4;
  if (s4) return `학칙 [별표 4]는 ${s4.schedule4Credits}학점, 교육과정 책자는 ${s4.bookCredits}학점으로 서로 달라요. 학과 또는 학사지원과 확인이 필요해요.`;
  const flags = (regulation.flags || []).filter((f) => f.level !== 'INFO' && f.message);
  if (flags.length === 0) return null;
  return flags.reduce((best, f) => ((FLAG_SEVERITY[f.level] || 0) > (FLAG_SEVERITY[best.level] || 0) ? f : best)).message;
}

/**
 * status → 화면 표시용 정보.
 *  - noData: 졸업요건 자료가 없어 진단할 수 없음(총 요구학점 0 또는 자료없음) → 0/0 대신 안내
 *  - badge: { label, level('ok'|'warn'|'none') } | null (서버가 regulation을 안 줬으면 null — 예전 응답도 그대로 동작)
 *  - reason: 사유 한 줄 | null
 *  - totalEstimated: 총 요구학점을 확정으로 보이면 안 되는 경우(편입생 총량 미확정, 추정 이하)
 */
export function describeRequirementTrust(status) {
  const regulation = status && status.regulation ? status.regulation : null;
  const noData = Boolean(status) && (status.totalRequiredCredits === 0 || (regulation !== null && regulation.confidence === 'NO_DATA'));
  if (!regulation) return { noData, badge: null, reason: null, totalEstimated: false };
  const level = regulation.confidence === 'CONFIRMED' ? 'ok' : regulation.confidence === 'NO_DATA' ? 'none' : 'warn';
  return {
    noData,
    badge: { label: regulation.confidenceLabel || TRUST_LABEL[regulation.confidence] || '', level },
    reason: regulation.confidence === 'CONFIRMED' ? null : pickTrustReason(regulation),
    totalEstimated: regulation.totalDefinitive === false || (regulation.confidence !== 'CONFIRMED' && !noData),
  };
}
