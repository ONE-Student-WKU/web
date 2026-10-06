// 온보딩에서 학과별로 고를 수 있는 입학학번 범위.
//
// 서버(studentService.listDepartments)가 범위를 두 벌 내려준다.
//  - core*: 교양·전공 요건 행이 있는 학번. 일반·편입 학생은 이 범위만 고를 수 있다 — 졸업인증제 같은
//    부가 행 때문에 넓어진 범위를 쓰면 전공 요건이 없는 학번이 선택지로 열려 졸업진단이 "진단할 수 없어요"가 된다.
//    (옛 학번 학생은 개편 전 학과 이름으로 들어 있다 — 예: 2020~2022학번 경영학과 학생은 경영학부.)
//  - min/max: 모든 요건 행 기준의 넓은 범위. 전과생용 — 전과생은 입학학번이 새 학과의 요건 시작 학번보다
//    옛날일 수 있다(예: 2021학번이 2024년에 경영학과로 전과).
// core 값이 없으면(요건 행의 학번 값이 모두 비어 있는 학과) 넓은 범위로 되돌린다.
export function getYearRange(department, enrollmentType, nowYear = new Date().getFullYear()) {
  const useCore = enrollmentType !== 'MAJOR_CHANGE';
  const minBound = (useCore ? department.coreMinAdmissionYear : null) ?? department.minAdmissionYear;
  const maxBound = (useCore ? department.coreMaxAdmissionYear : null) ?? department.maxAdmissionYear;
  const min = minBound ?? nowYear - 15;
  let max = maxBound ?? nowYear;
  // 편입생은 기존 학점을 인정받아 들어오는 전형이라 정의상 "계산상 1학년"이 되는 올해
  // 학번으로는 편입할 수 없다 — 그 해는 편입생 기준 학번 범위에서 뺀다.
  if (enrollmentType === 'TRANSFER_ADMISSION') max = Math.min(max, nowYear - 1);
  return { min, max };
}

// 개편으로 이름이 바뀐 옛 학과에 붙이는 안내 문구. 옛 학번 학생은 옛 이름을 골라야 하는데 학교 공식 소속명과
// 달라 헷갈리지 않게 "이후 학과"를 보여준다. 개편 이력이 이름 유사 추정(confirmed=false)이면 "(추정)"을 붙인다.
// 조사(으로/로)는 받침에 따라 달라 쓰지 않는다. 후속 학과가 없으면 null.
export function describeSuccessors(department) {
  const successors = department?.successors || [];
  if (successors.length === 0) return null;
  const names = successors.map((s) => s.name).join(', ');
  const confirmed = successors.every((s) => s.confirmed);
  return `이후 학과${confirmed ? '' : '(추정)'}: ${names}`;
}
