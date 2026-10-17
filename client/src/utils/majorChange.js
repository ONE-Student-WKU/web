// 전과(부)로 들어갈 수 없는 학과 — 학칙시행규칙 제111조 제4호(의과대학 의예(학)과, 치과대학 치의예(학)과, 한의과대학 한의예(학)과,
// 약학대학으로의 전과 제한). 서버(regulationEngine/constants.MAJOR_CHANGE_CLOSED_DEPARTMENTS)와 같은 목록이다.
export const MAJOR_CHANGE_CLOSED_DEPARTMENTS = ['의예과', '의학과', '치의예과', '치의학과', '한의예과', '한의학과', '약학과', '한약학과'];

export function isMajorChangeClosed(departmentName) {
  return MAJOR_CHANGE_CLOSED_DEPARTMENTS.includes(departmentName);
}
