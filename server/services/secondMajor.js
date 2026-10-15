/**
 * server/services/secondMajor.js
 * 다전공(복수전공·부전공) 입력 규칙(#378 G, 결정 4-1 A·4-2 A).
 *
 * 학칙 제43조의2(다전공)·시행규칙 제17조·「다전공이수에 관한 내규」. 이 서비스는 복수전공과 부전공만 받는다(연계·복합전공과
 * 마이크로디그리는 다음 단계, 4-1 A). 제2전공은 하나만 받는다(4-2 A) — students.second_department_id 한 칸과 그 구분(second_major_type).
 *  - DOUBLE: 복수전공. 주전공과 복수전공 모두 최소전공 인정학점 이상, 졸업논문 2개(복수전공.md 4절)
 *  - MINOR:  부전공. 주전공은 그대로, 부전공 21학점 이상(내규 제5조 제3항)
 * 구분 없이 학과만 저장된 옛 행은 복수전공으로 본다 — 이 칸을 처음 만들 때 "복수전공 학과"로 받았다(schema.sql).
 */

const SECOND_MAJOR_TYPES = Object.freeze(['DOUBLE', 'MINOR']);

/** 저장된 행 → 구분. 학과가 없으면 null. */
function secondMajorTypeOf(student) {
  if (!student || student.second_department_id == null) return null;
  return SECOND_MAJOR_TYPES.includes(student.second_major_type) ? student.second_major_type : 'DOUBLE';
}

/**
 * 요청 값 검증. undefined는 "보내지 않음"이다. 오류 코드 또는 null.
 * @param {{ secondDepartmentId, secondMajorType }} req
 * @param {{ departmentId, secondDepartmentId, secondMajorType }} effective 이번 요청으로 확정되는 주전공 학과와 제2전공(요청에 없으면 저장된 값)
 */
function validateSecondMajor(req, effective) {
  if (req.secondMajorType !== undefined && req.secondMajorType !== null && !SECOND_MAJOR_TYPES.includes(req.secondMajorType)) {
    return 'INVALID_SECOND_MAJOR_TYPE';
  }
  if (effective.secondDepartmentId == null) {
    // 학과 없이 구분만 보내면 무엇의 구분인지 모른다.
    return req.secondMajorType ? 'REQUIRED_SECOND_DEPARTMENT' : null;
  }
  if (String(effective.secondDepartmentId) === String(effective.departmentId)) return 'SECOND_DEPARTMENT_SAME_AS_PRIMARY';
  return null;
}

module.exports = { SECOND_MAJOR_TYPES, secondMajorTypeOf, validateSecondMajor };
