const { categoryAtRegistration } = require('./applicability');

/**
 * server/services/regulationEngine/registrationCategory.js
 * 졸업진단용: 학생이 들은 과목의 이수구분을 "수강한 학년도 기준"(학칙시행규칙 제13조④)으로 다시 본다. 순수 함수(DB 없음).
 *
 * 왜 필요한가: 제13조④는 이수구분이 바뀐 과목은 "수강신청한 학년도·학기"의 이수구분을 따른다고 한다. 진단은 지금까지 학생이 입력(또는 PDF 가져오기)한
 * 이수구분을 그대로 합산했다 — 그 값이 현재 편성표의 구분이면, 예컨대 2023학년도에 전공선택으로 들은 과목이 지금은 전공필수라는 이유로 필수로 세어진다.
 * 계산은 applicability.categoryAtRegistration(이미 있는 순수 함수)을 그대로 쓴다.
 *
 * 한계(그래서 결과는 항상 "추정"으로 표시된다, D-46):
 *  - 과목을 학수번호가 아니라 **이름**으로 찾는다(student_courses에 학수번호가 없다). 같은 이름이 서로 다른 학수번호로 둘 이상이면(여러 학과·개편) 건너뛴다.
 *  - "수강한 학년도의 이수구분"을 그 해 입학생 교육과정표의 구분으로 본다(CATEGORY_YEAR_BOOK_ASSUMED) — 교육과정 변경 이력의 학년도 축이 입학학번이라서다.
 *  - 계산 결과가 전공기초·전공심화처럼 필수/선택 해석이 정해지지 않은 구분이면(B-50, 사람이 정할 문제) **학점을 옮기지 않고** 알리기만 한다.
 */

const COUNTABLE_CATEGORIES = new Set(['전공필수', '전공선택', '교양필수', '교양선택', '일반선택']);
const normalizeName = (name) => String(name || '').replace(/[·.,\s]/g, '');

/**
 * @param {Array<{ name, credits, category, year, semester }>} courses  진단에 합산되는 학생 수강 과목
 * @param {Array<{ subjectKey, displayName, field, toYear, oldValue, newValue }>} changes  학과 계열의 이수구분 변경(curriculum_changes COURSE/category)
 * @param {Array} [overrides]  course_category_overrides 행(camelCase: courseKey, academicYear, semester, category, basisArticleRef)
 * @returns {{ adjusted: Array, unresolved: Array }}
 *   adjusted: 학점을 옮길 과목 { name, credits, year, semester, entered, applied, source }
 *   unresolved: 수강 학년도 구분이 다르지만 필수/선택 해석이 없어 옮기지 않은 과목 { name, year, semester, entered, applied }
 */
function classifyByRegistration(courses, changes, overrides = []) {
  const keysByName = new Map();
  for (const c of changes) {
    const k = normalizeName(c.displayName);
    if (!keysByName.has(k)) keysByName.set(k, new Set());
    keysByName.get(k).add(c.subjectKey);
  }
  const adjusted = [];
  const unresolved = [];
  for (const course of courses) {
    const keys = keysByName.get(normalizeName(course.name));
    if (!keys || keys.size !== 1) continue; // 이수구분 변경이 없는 과목, 또는 같은 이름이 여러 학수번호(어느 과목인지 알 수 없음)
    const courseKey = [...keys][0];
    const ownChanges = changes.filter((c) => c.subjectKey === courseKey && c.field === 'category');
    const r = categoryAtRegistration({ courseKey, year: course.year, semester: course.semester }, ownChanges, overrides, null);
    if (!r.category || r.category === course.category) continue;
    const base = { name: course.name, year: course.year, semester: course.semester, entered: course.category, applied: r.category };
    if (COUNTABLE_CATEGORIES.has(r.category)) adjusted.push({ ...base, credits: Number(course.credits), source: r.source });
    else unresolved.push(base);
  }
  return { adjusted, unresolved };
}

/** 이수구분별 학점 맵에 adjusted를 반영한 새 맵(원본은 건드리지 않는다). */
function applyAdjustments(earnedByCategory, adjusted) {
  const out = { ...earnedByCategory };
  for (const a of adjusted) {
    out[a.entered] = Math.max(0, (out[a.entered] || 0) - a.credits);
    out[a.applied] = (out[a.applied] || 0) + a.credits;
  }
  return out;
}

module.exports = { classifyByRegistration, applyAdjustments, COUNTABLE_CATEGORIES };
