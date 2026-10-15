const { normalizeCourseName, courseNameVariants } = require('./courseNameMatch');

/**
 * server/services/liberalRequiredAreas.js
 * 교양필수 "영역"(건학이념·대학생활·전공탐색과진로)을 실제로 이수했는지 판정한다(순수 함수).
 *
 * 왜 필요한가: 시드의 교양필수 행이 가진 지정 과목(requiredCourses)은 과목명이 아니라 영역 이름이다("건학이념", "대학생활").
 * 그래서 예전에는 교양필수 학점 합계만 봤고, "종교와원불교"를 듣지 않아도 다른 과목으로 학점만 채우면 충족으로 나왔다
 * (#378 결정 1-1 A: 교양필수 영역부터 판정).
 *
 * 영역 → 과목은 교육과정 책자의 교양 개설현황과 2026 책자 "교양 영역 세부정의"(31쪽)를 따른다. 2017~2026학년도 책자에서
 * 교양필수 과목명은 바뀐 적이 없다(종교와원불교 001.111/L00001, 대학생활과자기혁신 001.252/L00002). 전공탐색과진로는
 * 2025학번부터 광역단위 계열전공만 해당하며 두 과목(각 2학점, 합 4학점)을 모두 이수한다.
 * 표기 차이(띄어쓰기·가운뎃점, 끝에 붙은 괄호)는 courseNameMatch와 같은 방식으로 흡수한다(결정 1-2 A).
 */

// 영역 → { courses: 그 영역 과목, needAll: 모두 이수해야 하나(아니면 하나) }
const LIBERAL_REQUIRED_AREAS = Object.freeze({
  건학이념: { courses: ['종교와원불교'], needAll: true },
  대학생활: { courses: ['대학생활과자기혁신'], needAll: true },
  전공탐색과진로: { courses: ['전공탐색101', '전공기초세미나'], needAll: true },
});

/** 학생 과목명 → 비교용 이름들(정규화 + 끝 괄호를 뗀 이름). "종교와원불교(1분반)"처럼 적어도 같은 과목으로 본다. */
function studentNameKeys(name) {
  const full = normalizeCourseName(String(name || ''));
  const withoutParen = normalizeCourseName(String(name || '').replace(/\([^)]*\)\s*$/, ''));
  return withoutParen && withoutParen !== full ? [full, withoutParen] : [full];
}

/**
 * @param {string[]} requiredAreas  교양필수 행의 requiredCourses(영역 이름)
 * @param {string[]} passedCourseNames  이수로 인정되는 학생 과목명(F·NP 제외, 수강 중 포함)
 * @returns {Array<{ area, courses, completed: string[], missing: string[], satisfied }> | null}
 *   아는 영역이 하나도 없으면 null(약학과처럼 과목명이 직접 적힌 행 등 — 판정하지 않는다)
 */
function evaluateLiberalRequiredAreas(requiredAreas, passedCourseNames) {
  const areas = (requiredAreas || []).filter((a) => LIBERAL_REQUIRED_AREAS[a]);
  if (areas.length === 0) return null;
  const passed = new Set((passedCourseNames || []).flatMap(studentNameKeys));
  return areas.map((area) => {
    const { courses, needAll } = LIBERAL_REQUIRED_AREAS[area];
    const completed = courses.filter((c) => courseNameVariants(c).some((v) => passed.has(v)));
    const missing = courses.filter((c) => !completed.includes(c));
    return { area, courses, completed, missing, satisfied: needAll ? missing.length === 0 : completed.length > 0 };
  });
}

module.exports = { evaluateLiberalRequiredAreas, LIBERAL_REQUIRED_AREAS };
