import { pickJosa } from './korean.js';

/**
 * client/src/utils/graduation.js
 * getGraduationStatus() 응답(categories/certifications)에서 "부족 요건" 문구를 조립.
 * Home.jsx의 요약 카드와 GraduationStatus.jsx의 요약 박스가 동일 로직을 공유한다.
 */
const MAJOR_REQUIRED_KEY = '전공필수';
const MAJOR_ELECTIVE_KEY = '전공선택';
const MAJOR_MERGED_KEY = '전공';

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

  const majorRequired = find(MAJOR_REQUIRED_KEY);
  const majorElective = find(MAJOR_ELECTIVE_KEY);
  const major =
    majorRequired && majorElective
      ? {
          earnedCredits: majorRequired.earnedCredits + majorElective.earnedCredits,
          requiredCredits: majorRequired.requiredCredits + majorElective.requiredCredits,
          baseSatisfied: majorRequired.earnedCredits >= majorRequired.requiredCredits,
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
    if (missing > 0) items.push(`${c.category} ${missing}학점`);
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
